"""The realtime layer (blueprint §2): ConnectionManager + the /ws endpoint.

One socket per logged-in user; every frame is JSON `{"type": ..., ...payload}`
(§5). SQLite is the sole source of truth and the socket is only a live-push
optimization on top of it: every message is INSERTed BEFORE any socket I/O
(§2.4), so an offline recipient loses nothing -- the row is already in the
database and they catch up over REST on their next load.
"""

import json

import anyio.from_thread
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.exc import IntegrityError

from app import models, queries, schemas
from app.db import SessionLocal, utcnow_iso

router = APIRouter()


class ConnectionManager:
    """Who's online: a plain dict of user_id -> live socket (blueprint §2.3)."""

    def __init__(self):
        self.active: dict[int, WebSocket] = {}  # user_id -> live socket (this process only)

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()  # completes the HTTP 101 upgrade
        old = self.active.get(user_id)
        if old:  # new login replaces old (one socket per user)
            try:
                await old.close()
            except Exception:
                pass  # the old socket may already be dead; replacing it is the point
        self.active[user_id] = ws

    def disconnect(self, user_id: int):
        self.active.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict):
        ws = self.active.get(user_id)  # offline user -> no-op; the DB is the source
        if ws:                         # of truth, they catch up via REST on next load
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id)  # evict dead sockets so one corpse never breaks a fan-out loop


# Module-level singleton. REST handlers import this same object to read
# presence and push live events: same process = same memory = same dict --
# which is exactly why the deployment pins uvicorn to --workers 1.
manager = ConnectionManager()


def push_from_rest(user_ids: list[int], payload: dict) -> None:
    """Fan one live event out to whichever of `user_ids` are online, callable
    from a SYNC REST handler (group add/remove/rename, §5).

    FastAPI runs `def` routes on a worker thread via anyio.to_thread, so the
    event loop holding the sockets is running but unreachable by a plain
    `await`; anyio.from_thread.run is anyio's documented bridge back onto it
    from exactly such a thread. Offline users are skipped -- the caller has
    already committed the row, so they see the change over REST on next load.
    """
    for user_id in user_ids:
        if user_id in manager.active:  # saves a thread->loop hop per offline member
            anyio.from_thread.run(manager.send_to_user, user_id, payload)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str = ""):
    """A long-running coroutine (§2.1): accept once, then loop reading frames
    until the client disconnects."""
    # Auth rides the URL (?token=...) because the browser WebSocket constructor
    # cannot set an Authorization header. Validate BEFORE accept(); on failure
    # close with 1008 (policy violation) -- after the upgrade there is no HTTP
    # response to attach a 401 to. The "" default folds a missing token into
    # the same 1008 path as a bad one.
    with SessionLocal() as db:
        session = db.get(models.Session, token)
        user_id = None if session is None else session.user_id
    if user_id is None:
        await ws.close(code=1008)
        return

    await manager.connect(user_id, ws)

    # Connect-time catch-up (§2.5): everything persisted while this user was
    # away becomes "delivered" the moment their socket opens -- one bulk UPDATE
    # advances the delivered pointer on every membership row. Snapshot which
    # conversations are behind BEFORE the update so the senders awaiting ticks
    # can be told exactly how far the pointer moved. Payloads are built inside
    # the session block, socket fan-out happens after it closes (§4: never hold
    # a session across an await).
    receipts: list[tuple[list[int], dict]] = []  # ([other member ids], payload)
    with SessionLocal() as db:
        moved = queries.undelivered_conversations(db, user_id)
        queries.advance_delivered_pointers(db, user_id)
        db.commit()
        for row in moved:
            others = [
                member_id
                for member_id in queries.member_ids_of(db, row["conversation_id"])
                if member_id != user_id
            ]
            receipts.append(
                (others, {
                    "type": "receipt.delivered",
                    "conversation_id": row["conversation_id"],
                    "user_id": user_id,
                    "up_to_message_id": row["newest_message_id"],
                })
            )
    for others, payload in receipts:
        for member_id in others:  # offline members -> no-op; they re-derive
            await manager.send_to_user(member_id, payload)  # ticks from REST

    try:
        while True:
            try:
                event = await ws.receive_json()  # parks here until a frame arrives
            except (json.JSONDecodeError, KeyError):
                # Malformed frame (not JSON, or a binary frame): error the
                # offending client only; the connection stays open.
                await ws.send_json(
                    {"type": "error", "code": "invalid_json",
                     "detail": "Frames must be JSON text"}
                )
                continue
            await handle_event(user_id, ws, event)
    except WebSocketDisconnect:
        # A closed tab surfaces as an exception on the parked receive_json,
        # never as a return value. Evict only if this socket is still the
        # registered one -- a newer login may have replaced it already
        # (connect() closed us on purpose).
        if manager.active.get(user_id) is ws:
            manager.disconnect(user_id)
            # The mocked-presence story (§10): presence itself is live
            # (online <=> user_id in manager.active); last_seen_at is the one
            # timestamp written the moment the user actually goes offline.
            # Skipped when a newer socket replaced this one -- the user never left.
            with SessionLocal() as db:
                user = db.get(models.User, user_id)
                if user is not None:
                    user.last_seen_at = utcnow_iso()
                    db.commit()


async def handle_event(user_id: int, ws: WebSocket, event) -> None:
    """Plain if/elif on event["type"] (§5) -- the Python mirror of the
    client's TypeScript discriminated union."""
    if not isinstance(event, dict):
        await ws.send_json(
            {"type": "error", "code": "invalid_payload",
             "detail": "Frame must be a JSON object with a 'type' field"}
        )
        return
    event_type = event.get("type")
    if event_type == "message.send":
        await _handle_message_send(user_id, ws, event)
    elif event_type == "read":
        await _handle_read(user_id, ws, event)
    elif event_type == "typing":
        await _handle_typing(user_id, ws, event)
    elif event_type == "ping":
        # Client heartbeat (§5): defeats NAT/proxy idle timeouts and counts as
        # traffic against the free host's spin-down timer. Never touches the DB.
        await ws.send_json({"type": "pong"})
    else:
        # Unknown type: error frame to the offender; the connection stays open.
        await ws.send_json(
            {"type": "error", "code": "unknown_type",
             "detail": f"Unknown event type: {event_type!r}"}
        )


async def _handle_message_send(user_id: int, ws: WebSocket, event: dict) -> None:
    """message.send: persist FIRST, then fan out (§2.4).

    All DB work happens in one short-lived session -- a session per EVENT,
    never per connection (§4). The payloads leave the block as plain dicts and
    every socket send happens AFTER the session closes: a session held open
    across an `await` is an open transaction while the coroutine is parked,
    which is where "database is locked" comes from despite WAL.
    """
    conversation_id = event.get("conversation_id")
    client_id = event.get("client_id")
    body = event.get("body")
    reply_to_id = event.get("reply_to_id")
    if (
        not isinstance(conversation_id, int)
        or not isinstance(client_id, str)
        or not client_id
        or not isinstance(body, str)
        or not body.strip()
        or not (reply_to_id is None or isinstance(reply_to_id, int))
    ):
        await ws.send_json(
            {"type": "error", "code": "invalid_payload",
             "detail": "message.send needs conversation_id (int), client_id "
                       "(non-empty str), body (non-empty str) and optionally "
                       "reply_to_id (int)"}
        )
        return

    error: dict | None = None
    message_payload: dict | None = None
    recipient_ids: list[int] = []
    with SessionLocal() as db:
        if queries.get_membership(db, conversation_id, user_id) is None:
            # Also covers conversations that don't exist -- a non-member must
            # not learn the difference.
            error = {"type": "error", "code": "not_a_member",
                     "detail": "You are not a member of this conversation"}
        else:
            message = models.Message(
                conversation_id=conversation_id,
                sender_id=user_id,
                body=body,
                reply_to_id=reply_to_id,
                client_id=client_id,
                created_at=utcnow_iso(),
            )
            db.add(message)
            is_retry = False
            try:
                db.commit()  # persist FIRST -- no socket hears about the message before this line
            except IntegrityError:
                # Idempotent retry (§6): the same (sender_id, client_id) was
                # already inserted before a reconnect, so the UNIQUE constraint
                # fired. Re-ack with the existing row instead of erroring.
                db.rollback()
                is_retry = True
                message = queries.message_by_client_id(db, user_id, client_id)
            if message is None:
                # IntegrityError with no existing row is NOT the retry case --
                # e.g. reply_to_id pointing at a message that doesn't exist.
                error = {"type": "error", "code": "invalid_payload",
                         "detail": "Message could not be stored"}
            else:
                message_payload = _message_dict(message)
                if not is_retry:
                    # A retry re-acks the SENDER only: the others already got
                    # message.new when the row was first persisted (and anyone
                    # who missed it catches up over REST) -- fanning out again
                    # would paint duplicate bubbles.
                    recipient_ids = [
                        member_id
                        for member_id in queries.member_ids_of(db, conversation_id)
                        if member_id != user_id
                    ]

    if error is not None:
        await ws.send_json(error)
        return

    # Ack the sender first: their optimistic bubble flips sending -> sent,
    # matched by client_id. Then message.new to every OTHER member currently
    # online -- offline members already have the row in SQLite (§2.4) and get
    # their pointer advanced by the bulk catch-up on their next connect.
    await ws.send_json(
        {"type": "message.ack", "client_id": client_id, "message": message_payload}
    )
    delivered_ids: list[int] = []
    for recipient_id in recipient_ids:
        if recipient_id not in manager.active:
            continue
        await manager.send_to_user(
            recipient_id, {"type": "message.new", "message": message_payload}
        )
        if recipient_id in manager.active:  # a failed send evicts, so still-registered
            delivered_ids.append(recipient_id)  # means the push succeeded (§6 "delivered")

    # The §6 sent->delivered transition, push-time writer: advance each pushed
    # member's delivered pointer (fresh session, closed before any send), then
    # tell the sender -- their grey single tick can become a grey double. The
    # only other writer of this pointer is the bulk advance on connect; both
    # use the same monotonic MAX() update.
    if delivered_ids:
        message_id = message_payload["id"]
        with SessionLocal() as db:
            for recipient_id in delivered_ids:
                queries.advance_member_delivered(db, conversation_id, recipient_id, message_id)
            db.commit()
        for recipient_id in delivered_ids:
            await manager.send_to_user(
                user_id,
                {
                    "type": "receipt.delivered",
                    "conversation_id": conversation_id,
                    "user_id": recipient_id,
                    "up_to_message_id": message_id,
                },
            )


async def _handle_read(user_id: int, ws: WebSocket, event: dict) -> None:
    """read: the §6 delivered->read transition. The recipient's client is the
    actor (it sends this when the chat is open/visible); this handler is the
    pointer's ONE writer. Advance last_read_message_id -- never backwards --
    then broadcast receipt.read to the other online members."""
    conversation_id = event.get("conversation_id")
    up_to_message_id = event.get("up_to_message_id")
    if not isinstance(conversation_id, int) or not isinstance(up_to_message_id, int):
        await ws.send_json(
            {"type": "error", "code": "invalid_payload",
             "detail": "read needs conversation_id (int) and up_to_message_id (int)"}
        )
        return

    error: dict | None = None
    recipient_ids: list[int] = []
    with SessionLocal() as db:
        membership = queries.get_membership(db, conversation_id, user_id)
        if membership is None:
            error = {"type": "error", "code": "not_a_member",
                     "detail": "You are not a member of this conversation"}
        else:
            # Broadcast the post-update pointer value, not the raw client
            # value: a stale or reordered frame must never move another
            # client's ticks backwards (§6: strictly monotonic).
            up_to_message_id = max(membership.last_read_message_id, up_to_message_id)
            queries.advance_member_read(db, conversation_id, user_id, up_to_message_id)
            db.commit()
            recipient_ids = [
                member_id
                for member_id in queries.member_ids_of(db, conversation_id)
                if member_id != user_id
            ]

    if error is not None:
        await ws.send_json(error)
        return
    for recipient_id in recipient_ids:
        await manager.send_to_user(
            recipient_id,
            {
                "type": "receipt.read",
                "conversation_id": conversation_id,
                "user_id": user_id,
                "up_to_message_id": up_to_message_id,
            },
        )


async def _handle_typing(user_id: int, ws: WebSocket, event: dict) -> None:
    """typing: a pure relay to the other ONLINE members (§5) -- the one event
    that never persists. The session below only READS (membership gates the
    relay and names the fan-out list); nothing is ever written, because a
    typing signal is worthless ~3 seconds after it fires."""
    conversation_id = event.get("conversation_id")
    if not isinstance(conversation_id, int):
        await ws.send_json(
            {"type": "error", "code": "invalid_payload",
             "detail": "typing needs conversation_id (int)"}
        )
        return

    error: dict | None = None
    recipient_ids: list[int] = []
    with SessionLocal() as db:
        if queries.get_membership(db, conversation_id, user_id) is None:
            error = {"type": "error", "code": "not_a_member",
                     "detail": "You are not a member of this conversation"}
        else:
            recipient_ids = [
                member_id
                for member_id in queries.member_ids_of(db, conversation_id)
                if member_id != user_id
            ]

    if error is not None:
        await ws.send_json(error)
        return
    for recipient_id in recipient_ids:
        await manager.send_to_user(
            recipient_id,
            {"type": "typing", "conversation_id": conversation_id, "user_id": user_id},
        )


def _message_dict(message: models.Message) -> dict:
    """The wire shape of one message -- the same Pydantic model REST history
    returns (schemas.MessageOut), so the client parses a single message shape
    everywhere. created_at is already an ISO-8601 string in the database;
    send_json raises TypeError on a raw datetime (§5), so nothing here ever
    holds one."""
    return schemas.MessageOut.model_validate(message).model_dump()
