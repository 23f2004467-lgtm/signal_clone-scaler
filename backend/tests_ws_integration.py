"""Throwaway WS integration test for milestones M1 + M2 (documents the protocol).

Run against a live backend (a THROWAWAY database, never the dev signal.db --
and always a FRESH one: the checks assume exactly the seed data):

    cd backend
    DATABASE_URL=sqlite:////tmp/ws_verify.db .venv/bin/uvicorn app.main:app --port 8000 &
    .venv/bin/python tests_ws_integration.py

Dependencies: the `websockets` pip package (test-only; deliberately NOT in
requirements.txt) + stdlib urllib for REST. Numbered sections, one per
guarantee the realtime layer makes:

  1. REST login (fixed OTP 123456) and WS connect for two users
  2. message.send -> message.ack to the sender, message.new to the peer,
     receipt.delivered back to the sender (M2 push-time pointer advance)
  3. persist-first: the message is in REST history immediately
  4. offline delivery: recipient reconnects and catches up over REST; the
     reconnect bulk-advances their delivered pointer and the sender gets
     receipt.delivered (M2); last_seen_at is written on disconnect (M2)
  5. idempotent retry: same client_id -> same message id, no duplicate row,
     no duplicate fan-out or receipts
  6. bad token -> connection rejected with 1008 (HTTP 403 pre-accept)
  7. ping -> pong heartbeat
  8. unknown event type -> error frame, connection stays usable
  9. read -> receipt.read broadcast; pointers exposed over REST; a stale
     read never moves the pointer backwards (M2)
 10. typing -> pure relay to the other online member, no persistence (M2)
"""

import asyncio
import json
import urllib.error
import urllib.request
import uuid

import websockets

BASE = "http://localhost:8000"
WS_BASE = "ws://localhost:8000"
RECV_TIMEOUT = 5  # seconds; every expected frame must arrive well within this

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
    """The two-step mocked flow: login 'sends' the OTP, verify-otp trades the
    fixed code for a real session token."""
    rest("POST", "/api/auth/login", {"phone_or_username": username})
    return rest(
        "POST", "/api/auth/verify-otp",
        {"phone_or_username": username, "otp": "123456"},
    )


async def recv(ws) -> dict:
    return json.loads(await asyncio.wait_for(ws.recv(), timeout=RECV_TIMEOUT))


async def main() -> None:
    # --- 1. login + connect ----------------------------------------------
    print("1. REST login + WS connect (alice, bob)")
    alice = login("alice")
    bob = login("bob")
    check(alice["token"] and bob["token"], "both users got session tokens")
    bob_id = bob["user"]["id"]

    # The seeded alice<->bob DM: the direct conversation in alice's list
    # that has bob as a member.
    conversations = rest("GET", "/api/conversations", token=alice["token"])
    dm = next(
        conversation
        for conversation in conversations
        if conversation["type"] == "direct"
        and any(member["username"] == "bob" for member in conversation["members"])
    )
    dm_id = dm["id"]

    alice_ws = await websockets.connect(f"{WS_BASE}/ws?token={alice['token']}")
    bob_ws = await websockets.connect(f"{WS_BASE}/ws?token={bob['token']}")
    check(True, "both sockets connected (server accepted the upgrade)")

    # --- 2. send -> ack to sender, message.new to peer, receipt back ------
    print("2. message.send -> message.ack + message.new + receipt.delivered")
    client_id = str(uuid.uuid4())
    body = "integration test: hello bob"
    await alice_ws.send(json.dumps({
        "type": "message.send", "conversation_id": dm_id,
        "client_id": client_id, "body": body,
    }))

    ack = await recv(alice_ws)
    check(ack["type"] == "message.ack", "alice received message.ack")
    check(ack["client_id"] == client_id, "ack carries alice's client_id")
    message_id = ack["message"]["id"]
    check(isinstance(message_id, int) and message_id > 0, "ack carries the real message id")
    check(ack["message"]["body"] == body, "ack echoes the persisted body")

    # Bob is online, so the push-time delivered advance fires and the sender
    # hears about it right after the ack (grey single -> grey double).
    delivered = await recv(alice_ws)
    check(delivered["type"] == "receipt.delivered", "alice received receipt.delivered")
    check(delivered["conversation_id"] == dm_id, "receipt names the conversation")
    check(delivered["user_id"] == bob_id, "receipt names bob as the delivered-to member")
    check(delivered["up_to_message_id"] == message_id, "receipt covers the new message")

    new = await recv(bob_ws)
    check(new["type"] == "message.new", "bob received message.new")
    check(new["message"]["id"] == message_id, "same message id on bob's frame")
    check(new["message"]["body"] == body, "same body on bob's frame")

    # --- 3. persistence: the row is in REST history -----------------------
    print("3. persist-first: message visible in REST history")
    history = rest("GET", f"/api/conversations/{dm_id}/messages", token=bob["token"])
    check(any(m["id"] == message_id for m in history), "message is in GET .../messages")

    # --- 4. offline delivery ----------------------------------------------
    print("4. offline recipient catches up over REST (+ last_seen_at, bulk receipt)")
    await bob_ws.close()
    await asyncio.sleep(0.3)  # let the server run its disconnect cleanup

    me = rest("GET", "/api/auth/me", token=bob["token"])
    check(me["last_seen_at"] is not None, "bob's last_seen_at was written on disconnect")

    offline_client_id = str(uuid.uuid4())
    offline_body = "integration test: sent while bob was offline"
    await alice_ws.send(json.dumps({
        "type": "message.send", "conversation_id": dm_id,
        "client_id": offline_client_id, "body": offline_body,
    }))
    ack = await recv(alice_ws)
    check(ack["type"] == "message.ack", "alice still gets the ack with bob offline")
    check(ack["client_id"] == offline_client_id, "ack matches the offline-send client_id")
    offline_message_id = ack["message"]["id"]

    bob_ws = await websockets.connect(f"{WS_BASE}/ws?token={bob['token']}")
    history = rest("GET", f"/api/conversations/{dm_id}/messages", token=bob["token"])
    check(
        any(m["id"] == offline_message_id and m["body"] == offline_body for m in history),
        "bob reconnected and found the missed message via REST",
    )

    # Bob's reconnect bulk-advanced his delivered pointer; alice (the sender
    # awaiting a tick) hears about it without bob doing anything.
    delivered = await recv(alice_ws)
    check(delivered["type"] == "receipt.delivered", "reconnect pushed receipt.delivered to alice")
    check(
        delivered["conversation_id"] == dm_id and delivered["user_id"] == bob_id,
        "bulk receipt names the DM and bob",
    )
    check(
        delivered["up_to_message_id"] == offline_message_id,
        "bulk receipt covers the message sent while bob was offline",
    )

    # --- 5. idempotent retry ----------------------------------------------
    print("5. idempotent retry: same client_id -> same id, no duplicate")
    await alice_ws.send(json.dumps({
        "type": "message.send", "conversation_id": dm_id,
        "client_id": offline_client_id, "body": offline_body,
    }))
    ack = await recv(alice_ws)
    check(ack["type"] == "message.ack", "retry is re-acked, not errored")
    check(ack["message"]["id"] == offline_message_id, "retry ack returns the SAME message id")
    history = rest("GET", f"/api/conversations/{dm_id}/messages", token=alice["token"])
    check(
        sum(1 for m in history if m["client_id"] == offline_client_id) == 1,
        "no duplicate row for the retried client_id",
    )

    # --- 6. bad token -> 1008 ---------------------------------------------
    print("6. bad token rejected with 1008")
    # The server calls close(1008) BEFORE accept(); starlette renders a
    # close-before-accept as an HTTP 403 handshake rejection, so the client
    # sees either InvalidStatus(403) or -- if the stack completed the
    # upgrade first -- a normal close with code 1008. Both prove the same
    # thing: our pre-accept auth check rejected the connection.
    try:
        bad_ws = await websockets.connect(f"{WS_BASE}/ws?token=not-a-real-token")
        # Handshake completed: the very next event must be the 1008 close.
        try:
            await asyncio.wait_for(bad_ws.recv(), timeout=RECV_TIMEOUT)
            raise AssertionError("FAILED: bad token was allowed to stay connected")
        except websockets.ConnectionClosed as closed:
            check(closed.rcvd.code == 1008, f"closed with 1008 (got {closed.rcvd.code})")
    except websockets.exceptions.InvalidStatus as rejected:
        check(
            rejected.response.status_code == 403,
            f"handshake rejected pre-accept (HTTP {rejected.response.status_code})",
        )

    # --- 7. ping -> pong ---------------------------------------------------
    print("7. ping -> pong")
    await alice_ws.send(json.dumps({"type": "ping"}))
    pong = await recv(alice_ws)
    check(pong["type"] == "pong", "server answered the heartbeat")

    # --- 8. unknown type -> error frame, connection survives ---------------
    print("8. unknown event type -> error, socket still usable")
    await alice_ws.send(json.dumps({"type": "no.such.event"}))
    error = await recv(alice_ws)
    check(error["type"] == "error", "unknown type produced an error frame")
    check(error["code"] == "unknown_type", "error code is unknown_type")
    await alice_ws.send(json.dumps({"type": "ping"}))
    pong = await recv(alice_ws)
    check(pong["type"] == "pong", "connection still works after the error frame")

    # --- 9. read -> receipt.read + REST pointer exposure -------------------
    print("9. read -> receipt.read broadcast, pointers visible over REST")
    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": dm_id,
        "up_to_message_id": offline_message_id,
    }))
    read_receipt = await recv(alice_ws)
    check(read_receipt["type"] == "receipt.read", "alice received receipt.read")
    check(
        read_receipt["conversation_id"] == dm_id and read_receipt["user_id"] == bob_id,
        "read receipt names the DM and bob",
    )
    check(
        read_receipt["up_to_message_id"] == offline_message_id,
        "read receipt carries bob's up_to_message_id",
    )

    conversations = rest("GET", "/api/conversations", token=alice["token"])
    dm = next(c for c in conversations if c["id"] == dm_id)
    bob_member = next(m for m in dm["members"] if m["id"] == bob_id)
    check(
        bob_member["last_read_message_id"] == offline_message_id,
        "GET /api/conversations exposes bob's advanced read pointer",
    )
    check(
        bob_member["last_delivered_message_id"] >= offline_message_id,
        "delivered pointer kept >= read pointer",
    )

    # A stale read (an OLDER id) must never move the pointer backwards; the
    # broadcast carries the post-update pointer, so ticks cannot regress.
    await bob_ws.send(json.dumps({
        "type": "read", "conversation_id": dm_id,
        "up_to_message_id": message_id,  # older than offline_message_id
    }))
    read_receipt = await recv(alice_ws)
    check(
        read_receipt["type"] == "receipt.read"
        and read_receipt["up_to_message_id"] == offline_message_id,
        "stale read re-broadcasts the unmoved (monotonic) pointer",
    )

    # --- 10. typing -> pure relay ------------------------------------------
    print("10. typing -> relayed to the other online member")
    await bob_ws.send(json.dumps({"type": "typing", "conversation_id": dm_id}))
    typing = await recv(alice_ws)
    check(typing["type"] == "typing", "alice received the typing relay")
    check(
        typing["conversation_id"] == dm_id and typing["user_id"] == bob_id,
        "typing frame names the DM and bob",
    )

    await alice_ws.close()
    await bob_ws.close()
    print(f"\nALL CHECKS PASSED ({passed} asserts)")


if __name__ == "__main__":
    asyncio.run(main())
