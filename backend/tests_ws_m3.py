"""Throwaway WS integration test for milestone M3: group live-push over REST.

Run against a live backend on a FRESH throwaway database (the checks assume
exactly the seed state -- never the dev signal.db, never a DB another test
already mutated):

    cd backend
    rm -f /tmp/ws_m3.db*
    DATABASE_URL=sqlite:////tmp/ws_m3.db .venv/bin/uvicorn app.main:app --port 8000 &
    .venv/bin/python tests_ws_m3.py

Dependencies: the `websockets` pip package (test-only; deliberately NOT in
requirements.txt) + stdlib urllib for REST. Numbered sections, one per M3
guarantee -- every group event here is pushed by a sync REST handler through
the same in-process ConnectionManager the /ws endpoint writes (blueprint §5):

  1. POST /api/conversations (group with bob AND carol) -> conversation.created
     with the full ConversationOut payload to BOTH online members; the
     creator's socket stays silent (they already hold the REST response)
  2. a group send fans message.new out to EVERY other online member, and the
     sender gets one receipt.delivered PER member as each push lands
  3. group MIN semantics (§6): the sender's derived status only becomes
     "read" once EVERY other member's last_read pointer passed the message --
     asserted on the pointers in the REST conversation payload after bob
     reads (min still behind -> not read) and again after carol reads
  4. admin adds david (online) -> member.added with the MemberOut payload to
     ALL online members INCLUDING david; david's next GET /api/conversations
     includes the group; the next send fans out to david too
  5. non-admin add/remove attempts -> HTTP 403 and NO WS push to anyone
  6. PATCH rename -> conversation.updated to every online member
  7. admin removes bob -> member.removed to everyone INCLUDING bob (their one
     final frame); after that the ex-member's socket hears NOTHING further
     (fan-out lists are re-read from current membership per event), their own
     sends are rejected with not_a_member, and their conversation list no
     longer contains the group
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


def rest_status(method: str, path: str, body: dict | None = None,
                token: str | None = None) -> int:
    """Like rest() but for requests EXPECTED to fail: returns the HTTP status."""
    try:
        rest(method, path, body, token)
        return 200
    except urllib.error.HTTPError as error:
        return error.code


def login(username: str) -> dict:
    """The two-step mocked flow: login 'sends' the OTP, verify-otp trades the
    fixed code for a real session token."""
    rest("POST", "/api/auth/login", {"phone_or_username": username})
    return rest(
        "POST", "/api/auth/verify-otp",
        {"phone_or_username": username, "otp": "123456"},
    )


def group_members(token: str, group_id: int) -> dict[int, dict]:
    """The group's MemberOut rows from GET /api/conversations, keyed by user
    id -- the REST payload the client derives tick states from."""
    conversations = rest("GET", "/api/conversations", token=token)
    matches = [c for c in conversations if c["id"] == group_id]
    assert matches, f"FAILED: conversation {group_id} missing from the list"
    return {member["id"]: member for member in matches[0]["members"]}


async def recv(ws) -> dict:
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=RECV_TIMEOUT))


async def assert_silent(ws, label: str) -> None:
    """Prove a NON-event: the socket must produce nothing for SILENCE_TIMEOUT."""
    try:
        frame = await asyncio.wait_for(ws.recv(), timeout=SILENCE_TIMEOUT)
        raise AssertionError(f"FAILED: {label} (got {frame})")
    except asyncio.TimeoutError:
        check(True, label)


async def drain(ws) -> None:
    """Swallow whatever is queued (connect-time bulk receipts from the seed
    data) so the numbered checks start from a quiet socket."""
    try:
        while True:
            await asyncio.wait_for(ws.recv(), timeout=0.3)
    except asyncio.TimeoutError:
        pass


async def send_message(sender_ws, conversation_id: int, body: str) -> dict:
    """message.send over the socket; returns the acked message payload."""
    await sender_ws.send(json.dumps({
        "type": "message.send", "conversation_id": conversation_id,
        "client_id": str(uuid.uuid4()), "body": body,
    }))
    ack = json.loads(await asyncio.wait_for(sender_ws.recv(), timeout=RECV_TIMEOUT))
    assert ack["type"] == "message.ack", f"FAILED: expected message.ack, got {ack}"
    return ack["message"]


async def collect_delivered(sender_ws, count: int, message_id: int) -> set[int]:
    """Read `count` receipt.delivered frames off the sender's socket and
    return WHO they were for -- push order follows the fan-out loop, so the
    caller compares sets, not sequences."""
    user_ids: set[int] = set()
    for _ in range(count):
        frame = await recv(sender_ws)
        assert (
            frame["type"] == "receipt.delivered"
            and frame["up_to_message_id"] == message_id
        ), f"FAILED: expected receipt.delivered up to {message_id}, got {frame}"
        user_ids.add(frame["user_id"])
    return user_ids


async def main() -> None:
    alice, bob, carol, david = login("alice"), login("bob"), login("carol"), login("david")
    erin = login("erin")  # REST-only: stays OFFLINE (no socket) for the 403 check
    alice_id = alice["user"]["id"]
    bob_id = bob["user"]["id"]
    carol_id = carol["user"]["id"]
    david_id = david["user"]["id"]
    alice_ws = await websockets.connect(f"{WS_BASE}/ws?token={alice['token']}")
    bob_ws = await websockets.connect(f"{WS_BASE}/ws?token={bob['token']}")
    carol_ws = await websockets.connect(f"{WS_BASE}/ws?token={carol['token']}")
    david_ws = await websockets.connect(f"{WS_BASE}/ws?token={david['token']}")
    everyone = (
        ("alice", alice_ws), ("bob", bob_ws), ("carol", carol_ws), ("david", david_ws),
    )
    await asyncio.sleep(1.0)  # let connect-time catch-up receipts land first
    for _, ws in everyone:
        await drain(ws)

    # --- 1. group create -> conversation.created ---------------------------
    print("1. group create (bob + carol) -> conversation.created to both online members")
    created = rest(
        "POST", "/api/conversations",
        {"name": "M3 Live", "member_ids": [bob_id, carol_id]},
        token=alice["token"],
    )
    group_id = created["id"]
    for name, ws in (("bob", bob_ws), ("carol", carol_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "conversation.created"
            and frame["conversation"]["id"] == group_id
            and frame["conversation"]["name"] == "M3 Live",
            f"{name} received conversation.created for the new group",
        )
        check(
            {m["id"] for m in frame["conversation"]["members"]}
            == {alice_id, bob_id, carol_id},
            f"{name}'s frame carries the full member list",
        )
        check(frame["conversation"]["unread_count"] == 0,
              f"{name}'s unread_count is 0 for a brand-new group")
    await assert_silent(alice_ws, "creator's socket stays silent (they have the REST response)")
    await assert_silent(david_ws, "non-member david hears nothing")

    # --- 2. group send -> message.new + per-member delivered receipts ------
    print("2. group send -> message.new to bob AND carol, receipt.delivered per member")
    message_1 = await send_message(alice_ws, group_id, "does everyone see this?")
    for name, ws in (("bob", bob_ws), ("carol", carol_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "message.new"
            and frame["message"]["id"] == message_1["id"],
            f"{name} received message.new",
        )
    delivered_to = await collect_delivered(alice_ws, 2, message_1["id"])
    check(delivered_to == {bob_id, carol_id},
          "alice got one receipt.delivered per online member (bob and carol)")

    # --- 3. MIN semantics: read needs EVERY member's pointer past the id ---
    print("3. MIN semantics: derived status is read only after BOTH bob and carol read")
    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": group_id,
        "up_to_message_id": message_1["id"],
    }))
    for name, ws in (("alice", alice_ws), ("carol", carol_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "receipt.read" and frame["user_id"] == bob_id,
            f"{name} received bob's receipt.read",
        )
    members = group_members(alice["token"], group_id)
    check(members[bob_id]["last_read_message_id"] >= message_1["id"],
          "REST pointers: bob's last_read passed the message")
    check(members[carol_id]["last_read_message_id"] < message_1["id"],
          "REST pointers: carol's last_read is still behind")
    others_min = min(
        m["last_read_message_id"] for uid, m in members.items() if uid != alice_id
    )
    check(others_min < message_1["id"],
          "MIN over the other members is still behind -> derived status NOT read")

    await carol_ws.send(json.dumps({
        "type": "read", "conversation_id": group_id,
        "up_to_message_id": message_1["id"],
    }))
    for name, ws in (("alice", alice_ws), ("bob", bob_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "receipt.read" and frame["user_id"] == carol_id,
            f"{name} received carol's receipt.read",
        )
    members = group_members(alice["token"], group_id)
    others_min = min(
        m["last_read_message_id"] for uid, m in members.items() if uid != alice_id
    )
    check(others_min >= message_1["id"],
          "MIN over the other members passed the message -> derived status read")

    # --- 4. admin adds david -> member.added, list refetch, wider fan-out --
    print("4. admin adds david -> member.added to ALL incl. david; sends now reach him")
    member_out = rest(
        "POST", f"/api/conversations/{group_id}/members",
        {"user_id": david_id}, token=alice["token"],
    )
    check(member_out["id"] == david_id, "REST response is the MemberOut payload")
    for name, ws in everyone:
        frame = await recv(ws)
        check(
            frame["type"] == "member.added"
            and frame["conversation_id"] == group_id
            and frame["user"]["id"] == david_id
            and frame["user"]["is_online"] is True
            and frame["user"]["last_read_message_id"] == 0,
            f"{name} received member.added with the member payload (pointers + is_online)",
        )
    david_conversations = rest("GET", "/api/conversations", token=david["token"])
    check(any(c["id"] == group_id for c in david_conversations),
          "david's next conversations fetch includes the group")

    message_2 = await send_message(alice_ws, group_id, "welcome david")
    for name, ws in (("bob", bob_ws), ("carol", carol_ws), ("david", david_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "message.new"
            and frame["message"]["id"] == message_2["id"],
            f"{name} received message.new after the add",
        )
    delivered_to = await collect_delivered(alice_ws, 3, message_2["id"])
    check(delivered_to == {bob_id, carol_id, david_id},
          "delivered receipts now cover david too")

    # --- 5. non-admin add/remove -> 403, and NOBODY hears a push -----------
    print("5. non-admin bob add/remove -> 403 and no WS push")
    status = rest_status(
        "POST", f"/api/conversations/{group_id}/members",
        {"user_id": erin["user"]["id"]}, token=bob["token"],
    )
    check(status == 403, "non-admin add attempt -> HTTP 403")
    status = rest_status(
        "DELETE", f"/api/conversations/{group_id}/members/{carol_id}",
        token=bob["token"],
    )
    check(status == 403, "non-admin remove attempt -> HTTP 403")
    for name, ws in everyone:
        await assert_silent(ws, f"{name}'s socket stays silent after the rejected attempts")

    # --- 6. rename -> conversation.updated ---------------------------------
    print("6. rename -> conversation.updated to every online member")
    rest("PATCH", f"/api/conversations/{group_id}", {"name": "M3 Renamed"},
         token=alice["token"])
    for name, ws in everyone:
        frame = await recv(ws)
        check(
            frame["type"] == "conversation.updated"
            and frame["conversation_id"] == group_id
            and frame["name"] == "M3 Renamed",
            f"{name} received conversation.updated with the new name",
        )

    # --- 7. remove bob -> member.removed, then total silence for bob -------
    print("7. admin removes bob -> member.removed incl. bob, then bob is silenced")
    rest("DELETE", f"/api/conversations/{group_id}/members/{bob_id}",
         token=alice["token"])
    for name, ws in everyone:
        frame = await recv(ws)
        check(
            frame["type"] == "member.removed"
            and frame["conversation_id"] == group_id
            and frame["user_id"] == bob_id,
            f"{name} received member.removed naming bob",
        )

    message_3 = await send_message(alice_ws, group_id, "after bob left")
    for name, ws in (("carol", carol_ws), ("david", david_ws)):
        frame = await recv(ws)
        check(
            frame["type"] == "message.new"
            and frame["message"]["id"] == message_3["id"],
            f"{name} (still a member) received message.new",
        )
    delivered_to = await collect_delivered(alice_ws, 2, message_3["id"])
    check(delivered_to == {carol_id, david_id},
          "delivered receipts exclude the removed member")
    await assert_silent(bob_ws, "bob's socket stays SILENT for the group message")
    bob_conversations = rest("GET", "/api/conversations", token=bob["token"])
    check(all(c["id"] != group_id for c in bob_conversations),
          "bob's conversations no longer include the group")
    await bob_ws.send(json.dumps({
        "type": "message.send", "conversation_id": group_id,
        "client_id": str(uuid.uuid4()), "body": "am I still here?",
    }))
    frame = await recv(bob_ws)
    check(
        frame["type"] == "error" and frame["code"] == "not_a_member",
        "bob's own send into the group is rejected with not_a_member",
    )

    for _, ws in everyone:
        await ws.close()
    print(f"\nALL CHECKS PASSED ({passed} asserts)")


if __name__ == "__main__":
    asyncio.run(main())
