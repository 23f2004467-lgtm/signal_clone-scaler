"""Throwaway WS integration test for milestone M2: receipts, read, typing.

Run against a live backend on a FRESH throwaway database (the checks assume
exactly the seed state -- never the dev signal.db, never a DB another test
already mutated):

    cd backend
    rm -f /tmp/ws_m2.db*
    DATABASE_URL=sqlite:////tmp/ws_m2.db .venv/bin/uvicorn app.main:app --port 8000 &
    .venv/bin/python tests_ws_m2.py

Dependencies: the `websockets` pip package (test-only; deliberately NOT in
requirements.txt) + stdlib urllib for REST. Numbered sections, one per M2
guarantee:

  1. live delivered: with both DM members online, a send yields message.new
     to the recipient AND receipt.delivered back to the sender, and REST shows
     the recipient's advanced delivered pointer
  2. offline -> connect delivered: a send to an offline recipient produces NO
     receipt (single grey tick); the recipient's next connect bulk-advances
     the pointer and pushes receipt.delivered to the waiting sender
  3. read: the recipient's `read` frame broadcasts receipt.read, persists
     last_read (visible over REST), and zeroes the reader's unread_count
  4. monotonic read: a stale (older) up_to_message_id never moves the pointer
     backwards -- on the wire or in the database
  5. typing: relayed live to the other online member and persists NOTHING
     (both users' full REST conversation payloads are byte-identical
     before and after, and history length is unchanged)
  6. non-member read/typing on a foreign conversation -> not_a_member error
     frame, no crash, the socket stays usable
  7. group MIN semantics: in the seeded 4-member 'Weekend Trip' group with
     only 2 members online, a send yields exactly ONE receipt.delivered (the
     one online recipient); REST shows the offline members' pointers still
     behind, so the sender's UI derives a single tick overall
"""

import asyncio
import json
import urllib.error
import urllib.request
import uuid

import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"
RECV_TIMEOUT = 5    # seconds; every expected frame must arrive well within this
SILENCE_TIMEOUT = 1.0  # seconds a socket must stay silent to prove a non-event

passed = 0


def check(condition: bool, label: str) -> None:
    global passed
    assert condition, f"FAILED: {label}"
    passed += 1
    print(f"  ok: {label}")


# --- tiny REST helpers (stdlib only) -------------------------------------

def rest(method: str, path: str, body: dict | None = None, token: str | None = None):
    request = urllib.request.Request(BASE + path, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    data = json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(request, data=data) as response:
        return json.loads(response.read())


def login(username: str) -> dict:
    rest("POST", "/api/auth/login", {"phone_or_username": username})
    return rest(
        "POST", "/api/auth/verify-otp",
        {"phone_or_username": username, "otp": "123456"},
    )


def conversation_where(conversations: list, *, type: str, member: str | None = None,
                       name: str | None = None) -> dict:
    """Pick one conversation out of a GET /api/conversations payload."""
    return next(
        c for c in conversations
        if c["type"] == type
        and (member is None or any(m["username"] == member for m in c["members"]))
        and (name is None or c["name"] == name)
    )


def member_of(conversation: dict, user_id: int) -> dict:
    return next(m for m in conversation["members"] if m["id"] == user_id)


async def recv(ws) -> dict:
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=RECV_TIMEOUT))


async def assert_silent(ws, label: str) -> None:
    """The frame that must NOT arrive: prove the socket stays quiet."""
    try:
        frame = await asyncio.wait_for(ws.recv(), timeout=SILENCE_TIMEOUT)
        raise AssertionError(f"FAILED: {label} (got unexpected frame: {frame})")
    except asyncio.TimeoutError:
        check(True, label)


async def send_message(ws, conversation_id: int, body: str) -> dict:
    """message.send and the ack that flips sending -> sent; returns the
    persisted message payload."""
    client_id = str(uuid.uuid4())
    await ws.send(json.dumps({
        "type": "message.send", "conversation_id": conversation_id,
        "client_id": client_id, "body": body,
    }))
    ack = await recv(ws)
    assert ack["type"] == "message.ack" and ack["client_id"] == client_id, ack
    return ack["message"]


async def main() -> None:
    # --- setup: login + connect (alice first, then bob) --------------------
    # Per the seed, alice's delivered pointers are all current and bob is
    # behind only in the bob<->david DM -- so neither connect-time bulk
    # advance pushes any receipt to the other (david is offline throughout).
    print("setup: REST login + WS connect (alice, bob)")
    alice = login("alice")
    bob = login("bob")
    alice_id = alice["user"]["id"]
    bob_id = bob["user"]["id"]

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    dm_id = conversation_where(conversations, type="direct", member="bob")["id"]
    foreign_dm_id = conversation_where(conversations, type="direct", member="carol")["id"]
    group = conversation_where(conversations, type="group", name="Weekend Trip")
    group_id = group["id"]
    check(len(group["members"]) == 4, "seeded group has 4 members (alice, bob, carol, david)")

    alice_ws = await websockets.connect(f"{WS_BASE}/ws?token={alice['token']}")
    bob_ws = await websockets.connect(f"{WS_BASE}/ws?token={bob['token']}")

    # --- 1. live delivered --------------------------------------------------
    print("1. both online: send -> message.new + receipt.delivered + REST pointer")
    message = await send_message(alice_ws, dm_id, "m2 test: live delivery")
    check(True, "alice got message.ack for the live send")

    new = await recv(bob_ws)
    check(new["type"] == "message.new" and new["message"]["id"] == message["id"],
          "bob (online) received message.new")

    delivered = await recv(alice_ws)
    check(delivered["type"] == "receipt.delivered", "alice received receipt.delivered")
    check(delivered["conversation_id"] == dm_id and delivered["user_id"] == bob_id,
          "receipt names the DM and bob as the delivered-to member")
    check(delivered["up_to_message_id"] == message["id"], "receipt covers the new message id")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    bob_member = member_of(conversation_where(conversations, type="direct", member="bob"), bob_id)
    check(bob_member["last_delivered_message_id"] == message["id"],
          "REST shows bob's delivered pointer advanced to the new message")

    # --- 2. offline -> connect delivered ------------------------------------
    print("2. offline recipient: no receipt at send time; receipt on reconnect")
    await bob_ws.close()
    await asyncio.sleep(0.3)  # let the server run its disconnect cleanup

    offline_message = await send_message(alice_ws, dm_id, "m2 test: sent while bob offline")
    await assert_silent(alice_ws, "no receipt.delivered while bob is offline (single grey tick)")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    bob_member = member_of(conversation_where(conversations, type="direct", member="bob"), bob_id)
    check(bob_member["last_delivered_message_id"] < offline_message["id"],
          "REST shows bob's delivered pointer still behind the offline send")

    bob_ws = await websockets.connect(f"{WS_BASE}/ws?token={bob['token']}")
    delivered = await recv(alice_ws)
    check(delivered["type"] == "receipt.delivered", "bob's reconnect pushed receipt.delivered to alice")
    check(delivered["conversation_id"] == dm_id and delivered["user_id"] == bob_id,
          "bulk receipt names the DM and bob")
    check(delivered["up_to_message_id"] == offline_message["id"],
          "bulk receipt covers the message sent while bob was offline")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    bob_member = member_of(conversation_where(conversations, type="direct", member="bob"), bob_id)
    check(bob_member["last_delivered_message_id"] == offline_message["id"],
          "REST shows the bulk-advanced pointer after reconnect")

    # --- 3. read -> receipt.read + persisted pointer + unread drops to 0 ----
    print("3. read -> receipt.read, REST-persisted pointer, unread_count -> 0")
    bob_view = rest("GET", "/api/conversations", token=bob["token"])
    unread_before = conversation_where(bob_view, type="direct", member="alice")["unread_count"]
    check(unread_before == 2, "bob has 2 unread (the two messages alice just sent)")

    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": dm_id,
        "up_to_message_id": offline_message["id"],
    }))
    read_receipt = await recv(alice_ws)
    check(read_receipt["type"] == "receipt.read", "alice received receipt.read")
    check(read_receipt["conversation_id"] == dm_id and read_receipt["user_id"] == bob_id,
          "read receipt names the DM and bob as the reader")
    check(read_receipt["up_to_message_id"] == offline_message["id"],
          "read receipt covers everything bob read")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    bob_member = member_of(conversation_where(conversations, type="direct", member="bob"), bob_id)
    check(bob_member["last_read_message_id"] == offline_message["id"],
          "REST shows bob's read pointer persisted")
    check(bob_member["last_delivered_message_id"] >= bob_member["last_read_message_id"],
          "invariant: delivered pointer >= read pointer")

    bob_view = rest("GET", "/api/conversations", token=bob["token"])
    check(conversation_where(bob_view, type="direct", member="alice")["unread_count"] == 0,
          "bob's unread_count for the DM dropped to 0")

    # --- 4. read never moves backwards --------------------------------------
    print("4. stale read: pointer unchanged on the wire and in the database")
    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": dm_id,
        "up_to_message_id": message["id"],  # older than offline_message
    }))
    read_receipt = await recv(alice_ws)
    check(read_receipt["type"] == "receipt.read"
          and read_receipt["up_to_message_id"] == offline_message["id"],
          "stale read broadcasts the unmoved (post-update) pointer")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    bob_member = member_of(conversation_where(conversations, type="direct", member="bob"), bob_id)
    check(bob_member["last_read_message_id"] == offline_message["id"],
          "REST confirms the read pointer did not move backwards")

    # --- 5. typing: pure relay, zero persistence -----------------------------
    print("5. typing -> relayed live, and NOTHING persisted")
    alice_before = rest("GET", "/api/conversations", token=alice["token"])
    bob_before = rest("GET", "/api/conversations", token=bob["token"])
    history_before = rest("GET", f"/api/conversations/{dm_id}/messages", token=alice["token"])

    await alice_ws.send(json.dumps({"type": "typing", "conversation_id": dm_id}))
    typing = await recv(bob_ws)
    check(typing["type"] == "typing", "bob received the typing relay")
    check(typing["conversation_id"] == dm_id and typing["user_id"] == alice_id,
          "typing frame names the DM and alice")

    alice_after = rest("GET", "/api/conversations", token=alice["token"])
    bob_after = rest("GET", "/api/conversations", token=bob["token"])
    history_after = rest("GET", f"/api/conversations/{dm_id}/messages", token=alice["token"])
    check(alice_before == alice_after and bob_before == bob_after,
          "typing changed nothing in either user's REST payload (pointers, unread, previews)")
    check(history_before == history_after, "typing added no message rows")

    # --- 6. non-member read/typing on a foreign conversation -----------------
    print("6. non-member frames -> not_a_member error, socket survives")
    # bob is NOT a member of the alice<->carol DM
    await bob_ws.send(json.dumps({"type": "typing", "conversation_id": foreign_dm_id}))
    error = await recv(bob_ws)
    check(error["type"] == "error" and error["code"] == "not_a_member",
          "non-member typing rejected with not_a_member")

    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": foreign_dm_id, "up_to_message_id": 999999,
    }))
    error = await recv(bob_ws)
    check(error["type"] == "error" and error["code"] == "not_a_member",
          "non-member read rejected with not_a_member")

    await bob_ws.send(json.dumps({"type": "ping"}))
    pong = await recv(bob_ws)
    check(pong["type"] == "pong", "bob's socket is still usable after the rejections")
    await assert_silent(alice_ws, "alice (the real member) heard nothing about the rejected frames")

    # --- 7. group MIN semantics: receipts from online members only -----------
    print("7. group send with 2 of 4 online -> exactly one receipt; others behind")
    group_message = await send_message(alice_ws, group_id, "m2 test: group delivery")
    new = await recv(bob_ws)
    check(new["type"] == "message.new" and new["message"]["id"] == group_message["id"],
          "bob (the only other online member) received message.new")

    delivered = await recv(alice_ws)
    check(delivered["type"] == "receipt.delivered"
          and delivered["conversation_id"] == group_id
          and delivered["user_id"] == bob_id
          and delivered["up_to_message_id"] == group_message["id"],
          "alice received receipt.delivered for bob only")
    await assert_silent(alice_ws, "no receipt for carol or david (both offline)")

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    group_after = conversation_where(conversations, type="group", name="Weekend Trip")
    others = [m for m in group_after["members"] if m["id"] != alice_id]
    online_delivered = [m for m in others if m["last_delivered_message_id"] >= group_message["id"]]
    behind = [m for m in others if m["last_delivered_message_id"] < group_message["id"]]
    check([m["id"] for m in online_delivered] == [bob_id],
          "REST: bob is the only member whose pointer covers the group message")
    check(len(behind) == 2, "REST: carol and david (offline) are still behind")
    # MIN-across-members (blueprint §6): the sender's tick is driven by the
    # SLOWEST pointer, so with two members behind the UI derives a single tick.
    slowest = min(m["last_delivered_message_id"] for m in others)
    check(slowest < group_message["id"],
          "MIN(other members' delivered) < message id -> sender still shows a single tick")

    await alice_ws.close()
    await bob_ws.close()
    print(f"\nALL CHECKS PASSED ({passed} asserts)")


if __name__ == "__main__":
    asyncio.run(main())
