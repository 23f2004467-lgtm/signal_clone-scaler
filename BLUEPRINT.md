# Signal Clone — Final Build Blueprint

**Stack (fixed by assignment):** Next.js (TypeScript, App Router) · FastAPI (Python) · SQLite · plain WebSockets
**Deliverables:** public GitHub repo (`frontend/` + `backend/`), README with schema + architecture, hosted demo — **Next.js on Vercel (free Hobby) + FastAPI on Render (free web service), $0 total, no credit card** (the assignment names "Vercel … Render" explicitly)
**Budget:** ~24 hours

---

## 1. Guiding principle

Boring, explainable architecture wins this interview. The evaluation explicitly grades "ability to explain every line," so every pattern in this blueprint is either verbatim from an official doc (FastAPI's WebSockets tutorial, react.dev's chat-server useEffect example, SQLAlchemy's own dialect docs) or a one-step obvious adaptation of one. Zero real-time libraries, zero ORM magic, zero Redis, zero clever abstractions. Every deliberate simplification (single uvicorn worker, one socket per user, token in the query string, single-file SQLite) is written down in the README with a one-sentence "here's how I'd do it at scale" answer — which turns each limitation into interview material instead of a weakness.

---

## 2. How the WebSocket talks to the Python backend

This is the whole mental model, top to bottom. Read this section until you can say it without notes.

### 2.1 The endpoint is just an async function that never returns

A REST handler runs once and returns a response. A WebSocket handler is a **long-running coroutine**: it accepts the connection, then loops forever reading frames, until the client disconnects.

```python
@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, token: str):   # token from ?token=...
    user_id = lookup_session(token)                        # sessions table in SQLite
    if user_id is None:
        await ws.close(code=1008)                          # policy violation; no HTTP 401 exists here
        return
    await manager.connect(user_id, ws)                     # accept() + register in dict
    try:
        while True:
            event = await ws.receive_json()                # coroutine PARKS here until a frame arrives
            await handle_event(user_id, event)             # if/elif on event["type"]
    except WebSocketDisconnect:                            # closed tab = exception, not return value
        manager.disconnect(user_id)
```

Four facts about this function:

1. **The upgrade handshake.** The browser sends a normal HTTP GET with an `Upgrade: websocket` header. `await ws.accept()` (inside `manager.connect`) sends back HTTP **101 Switching Protocols**, and from that moment the TCP connection is a persistent two-way pipe. This is why plain WSGI (classic Flask) can't do WebSockets — WSGI is strictly one-request-one-response — and ASGI (uvicorn) can.
2. **Disconnect is an exception.** When the user closes the tab, the pending `await ws.receive_json()` raises `WebSocketDisconnect`. Cleanup goes in the `except` block. If you forget this, every closed tab leaves a dead socket in the manager and a stack trace in the logs.
3. **No HTTP errors after the upgrade.** Inside a WS endpoint you never `raise HTTPException` — there is no HTTP response to attach a 401 to. You call `ws.close(code=1008)`.
4. **Auth rides the URL.** The browser's `WebSocket` constructor cannot set an `Authorization` header. So the session token goes in the query string (`wss://host/ws?token=...`), validated *before* accept. This is the pattern FastAPI's own docs demonstrate.

### 2.2 How one Python process serves hundreds of sockets

uvicorn runs a **single-threaded asyncio event loop**. Every `await` is a yield point: "pause me, run someone else, wake me when my data arrives." 500 open WebSockets are just 500 parked coroutines, each suspended at its `await receive_json()` line, costing nearly nothing while idle. There is **no thread per connection** — this is cooperative concurrency, not parallelism (FastAPI's docs explain it with the "concurrent burgers" analogy).

The corollary: **never block the loop.** `time.sleep()`, the sync `requests` library, or heavy CPU work inside a handler freezes *every* socket at once. Sub-millisecond SQLite writes are fine at this scale; anything heavier would go through `asyncio.to_thread`.

### 2.3 The ConnectionManager: a dict of who's online

A module-level singleton — a plain Python class holding `dict[user_id, WebSocket]`. Because REST routes and the WS route live on the **same app object in the same process**, a REST handler (e.g. "admin removes a group member") can import this same manager and push events to live sockets. Same process = same memory = shared dict.

```python
class ConnectionManager:
    def __init__(self):
        self.active: dict[int, WebSocket] = {}     # user_id -> live socket (this process only)

    async def connect(self, user_id: int, ws: WebSocket):
        await ws.accept()                          # completes the HTTP 101 upgrade
        old = self.active.get(user_id)
        if old:                                    # new login replaces old (one socket per user)
            await old.close()
        self.active[user_id] = ws

    def disconnect(self, user_id: int):
        self.active.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict):
        ws = self.active.get(user_id)              # offline user -> no-op; DB is source of truth,
        if ws:                                     # they catch up via REST on next load
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id)           # evict dead sockets so fan-out never crashes

manager = ConnectionManager()                      # module-level singleton; requires --workers 1
```

This dict is **process-local memory**, which is exactly why the deployment runs one uvicorn worker (see §3).

### 2.4 The golden rule: persist first, then fan out

SQLite is the **sole source of truth**. The WebSocket is only a live-push optimization on top of it. Every message is INSERTed before any socket I/O. If the recipient is offline, nothing more happens — the message is already in the database, and "offline delivery" is just a REST GET on their next load. No queues, no replay buffers, no sequence numbers.

### 2.5 End-to-end trace: User A sends "hi" to User B

```
A's browser              FastAPI (one process, one event loop)           SQLite        B's browser
    |                                   |                                   |               |
    |-- render bubble "sending" --------|  (client-only optimistic state,   |               |
    |   client_id = crypto.randomUUID() |   never stored server-side)       |               |
    |                                   |                                   |               |
    |== WS frame ======================>|                                   |               |
    |   {type:"message.send",           |                                   |               |
    |    client_id, conversation_id,    |-- validate A is a member -------->|               |
    |    body:"hi"}                     |-- INSERT message row ------------>|  (persist     |
    |                                   |<-- real id + server timestamp ----|   FIRST)      |
    |                                   |                                   |               |
    |<== {type:"message.ack",==========-|                                   |               |
    |     client_id, message}           |                                   |               |
    |   bubble flips "sending"->"sent"  |                                   |               |
    |   (matched by client_id,          |-- look up B in manager.active ----|               |
    |    updated IN PLACE)              |                                   |               |
    |                                   |   B online? --------------------- |==============>|
    |                                   |   {type:"message.new", message}   |   bubble      |
    |                                   |                                   |   appears     |
    |                                   |-- UPDATE B's last_delivered ----->|               |
    |<== {type:"receipt.delivered"} ====|   pointer on membership row       |               |
    |   A's tick: one grey -> two grey  |                                   |               |
    |                                   |                                   |               |
    |                                   |   (B opens/views the chat)        |               |
    |                                   |<== {type:"read", conversation_id,=|===============|
    |                                   |     up_to_message_id}             |               |
    |                                   |-- UPDATE B's last_read pointer -->|               |
    |<== {type:"receipt.read"} =========|                                   |               |
    |   two grey -> two blue            |                                   |               |
```

**If B is offline:** the INSERT still happens, `send_to_user(B)` is a no-op, and A sees a single grey tick. When B's socket next connects, the server bulk-advances B's delivered pointer, pushes `receipt.delivered` to A if A is online, and B's client refetches history over REST. Receipt state is always **derivable from the stored pointers**, so ticks are correct even if the live events were missed.

---

## 3. Architecture overview

Two free platforms, two origins. **Vercel** (free Hobby) serves the Next.js frontend; **Render** (free web service, built from `backend/Dockerfile`) runs the FastAPI backend. Vercel cannot host — or even proxy — the WebSocket: it runs Python only as serverless functions, which cannot hold a persistent connection. So the browser connects **directly** to Render over `wss://`. The cross-origin split brings CORS back for the REST calls (**only** — CORS never applied to the WebSocket handshake), and the backend URLs reach the client as `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`, baked into the JS bundle at build time.

```
┌─────────────────────────┐
│  Vercel (Hobby, $0)     │   serves the page + JS bundle (the two
│  Next.js frontend       │   NEXT_PUBLIC_* URLs baked in at build time)
└──────────┬──────────────┘
           │ page load
           ▼
   Browser (Alice / Bob)
           │
           │  HTTPS  https://<api>.onrender.com/api/*      (REST — CORS applies)
           │  wss:// wss://<api>.onrender.com/ws?token=…   (live events — CORS does NOT)
           ▼
┌────────────────────────────────────────────────────────────────┐
│  Render free web service ($0, no credit card)                  │
│  built from backend/Dockerfile · Render's edge terminates TLS  │
│  on *.onrender.com and forwards plain HTTP/WS to the container │
│  on $PORT — ONE public port carries REST *and* the WS Upgrade  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  FastAPI — ONE uvicorn worker                            │  │
│  │  ┌────────────────────────┐                              │  │
│  │  │ ConnectionManager      │        SQLite (WAL)          │  │
│  │  │ dict[uid, socket]      │        source of truth — on  │  │
│  │  └────────────────────────┘        an EPHEMERAL disk:    │  │
│  │                                    wiped on every deploy │  │
│  │                                    /restart/spin-down →  │  │
│  │                                    create_all + seed-if- │  │
│  │                                    empty at startup      │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

Three consequences of this shape:

1. **The browser talks straight to Render for the socket.** Vercel's serverless functions can't hold persistent connections and Vercel doesn't proxy WS to external origins — so `new WebSocket(process.env.NEXT_PUBLIC_WS_URL + "/ws?token=" + token)`, always `wss://` (the https page blocks `ws://` as mixed content with no useful error, and Render answers `ws://` handshakes with a 301 that breaks most clients).
2. **CORS returns to `main.py` — for REST only.** Exact Vercel origin + `http://localhost:3000` in `allow_origins`, plus an anchored `allow_origin_regex` for Vercel preview URLs (§11). Keep the interview aside: CORS never applied to the WebSocket handshake, so never "debug" `/ws` by fiddling with CORS — the real culprits are ws-vs-wss scheme mismatches.
3. **The free tier runs exactly ONE instance** — which is not a compromise but a perfect match for the process-local ConnectionManager: no accidental horizontal scaling can ever split the dict.

**The single-server-process rule stands, front and center:** the container CMD is `uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers 1` — the same plain uvicorn in dev and prod, never `gunicorn -w N` (ruling in §4a and §11), and never set `WEB_CONCURRENCY` on Render.

**The one-paragraph interview answer for why one worker:** "My connection registry is a process-local dict; with 4 workers, user A's socket could land on worker 1 and user B's on worker 3, and worker 1's dict has no idea B exists — delivery breaks silently. One async worker holds thousands of idle sockets since each is just a parked coroutine, which is orders of magnitude beyond a demo. To scale horizontally I'd keep the same per-process manager and add Redis pub/sub: each worker subscribes, publishes inbound messages, and relays to its own local sockets — exactly what FastAPI's docs recommend."

**The REST vs WS split rule:** *if the client asks, it's REST; if the server tells you something you didn't just ask for, it's WS.* REST handles everything request/response-shaped (login, contacts, conversation list, paginated history, group CRUD) and gets HTTP semantics for free — status codes, curl-testability, the auto-generated `/docs` page. The WebSocket carries only live events. One deliberate exception: **message send goes over WS, not REST POST**, so the ack round-trip that drives `sending → sent` shares one channel with the push. REST handlers import the same `manager` singleton to push live notifications (e.g. group membership changes).

---

## 4. Database schema

Adopting the **dual-pointer receipt design** (Explainability Advocate + Interviewer consensus): no per-message receipts table. Two integer pointers per membership row power ticks, unread badges, and offline catch-up with one mechanism. The per-message receipts table becomes the "how I'd get Signal-exact per-member group ticks" README note, and the pointer design is the answer that survives "group of 5 — who has the double check?"

**Six tables. Conversations are unified: a DM is just a 2-member conversation with no name.**

```sql
users (
  id            INTEGER PRIMARY KEY,
  phone         TEXT UNIQUE NOT NULL,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  last_seen_at  TEXT,                -- written on WS disconnect
  created_at    TEXT NOT NULL
)
-- Why: identity. Avatars are derived (initials + color hash), no upload column needed.

sessions (
  token       TEXT PRIMARY KEY,      -- random token; doubles as the ?token= WS credential
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
)
-- Why: mocked auth still needs real sessions; one lookup authenticates both REST and WS.

contacts (
  owner_id         INTEGER NOT NULL REFERENCES users(id),
  contact_user_id  INTEGER NOT NULL REFERENCES users(id),
  created_at       TEXT NOT NULL,
  PRIMARY KEY (owner_id, contact_user_id)
)
-- Why: a directed edge, like a phone address book — me adding you doesn't add me to yours.

conversations (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('direct','group')),
  name        TEXT,                  -- groups only; NULL for DMs
  dm_key      TEXT UNIQUE,           -- 'minUserId:maxUserId' for DMs; prevents duplicate DM pairs
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
)
-- Why unified: messages FK one table regardless of type, the conversation list is one
-- query, and every WS fan-out path is identical for 1:1 and groups — no special cases.

conversation_members (
  conversation_id            INTEGER NOT NULL REFERENCES conversations(id),
  user_id                    INTEGER NOT NULL REFERENCES users(id),
  role                       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  last_delivered_message_id  INTEGER NOT NULL DEFAULT 0,   -- receipt pointer #1
  last_read_message_id       INTEGER NOT NULL DEFAULT 0,   -- receipt pointer #2
  joined_at                  TEXT NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
)
-- Why: membership + role for group admin, AND the entire receipts system in two integers.
-- Unread badge = COUNT(messages.id > last_read_message_id).
-- "Delivered to all" = MIN(other members' delivered pointers) >= message.id. Same for read.

messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,     -- monotonic id = ordering + cursor
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id),
  sender_id        INTEGER NOT NULL REFERENCES users(id),
  body             TEXT NOT NULL,
  reply_to_id      INTEGER REFERENCES messages(id),       -- nullable; bonus replies, costs nothing now
  client_id        TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (sender_id, client_id)                           -- makes retry-after-reconnect idempotent
)
-- Why: the source of truth. Server timestamp and AUTOINCREMENT id define ordering — never the client clock.

-- Indexes: messages(conversation_id, id). PRAGMAs on every connection:
-- foreign_keys=ON (SQLite does NOT enforce FKs by default — say this in the interview)
-- journal_mode=WAL (avoids 'database is locked' under concurrent writes)
```

**DB access:** **Sync SQLAlchemy 2.0 — the explainable subset only.** (This replaces the earlier stdlib-`sqlite3` ruling at the developer's request; the honest trade: typed models that double as the README schema section and injection safety by construction, in exchange for five rehearsable concepts — Session/identity map, flush vs commit, expire_on_commit, engine + pool, the pragma listener. If you cannot define a Session in one sentence by build day, raw `sqlite3` remains the fallback.) The subset is a set of hard constraints:

- **Sync only, forever.** Never `create_async_engine`/`AsyncSession` — the async extension's `MissingGreenlet` lazy-load failure is exclusive to asyncio SQLAlchemy and is exactly the unexplainable trap this blueprint avoids. Sync `def` REST handlers run in FastAPI's threadpool, so the event loop is never blocked. Session-per-request via a `get_db` yield dependency is the official FastAPI tutorial pattern — citable line-for-line (including `check_same_thread=False`, which SQLAlchemy 2.0's pysqlite dialect already defaults to for file databases).
- **2.0 style only:** `DeclarativeBase` + `Mapped[]`/`mapped_column()` + explicit `select()`. Grep the codebase for `session.query` and `declarative_base` before submitting — mixed 1.x style is an instant interview smell.
- **No `relationship()` at all:** plain FK columns + explicit queries, matching the query shapes above. Lazy loading is hidden SQL at attribute-access time — the single most indefensible line in a line-by-line interview.
- **One `db.py` (~25 lines) owns the whole lifecycle:** the engine; a `@event.listens_for(engine, "connect")` PRAGMA listener setting `foreign_keys=ON`, `journal_mode=WAL`, `busy_timeout=5000` (copy the official SQLite-dialect docs recipe exactly, including the brief `dbapi_connection.autocommit = True` toggle the sqlite3 driver needs for the FK pragma); `sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)` — `expire_on_commit=False` so reading `msg.id` after commit doesn't emit a surprise SELECT or raise `DetachedInstanceError`; and the `get_db` yield dependency for REST.
- **WS handlers use sessions per EVENT, never per connection:** `Depends` only for connect-time auth; inside the receive loop, a short-lived `with SessionLocal() as session:` per event. Build the outgoing payload (real id, timestamp) INSIDE the block, do socket fan-out OUTSIDE it — never hold a session across an `await` (that open transaction while the coroutine is parked is where "database is locked" comes from despite WAL).
- **The hardest SQL stays hand-written:** the unread-count correlated subquery and the `MIN()`-across-members receipt aggregation run as `session.execute(text("SELECT ..."), params)` — parameterized, through the same session/transaction — so the strongest schema-design interview material survives the ORM intact.
- **No Alembic; pin SQLAlchemy 2.0.x** (2.1 is beta as of Jan 2026 — never ship a beta into an interview) **and skip SQLModel** (a second library to explain). `Base.metadata.create_all(engine)` at startup replaces `schema.sql`; the DDL above stays in the README verbatim as the schema documentation.

---

## 4a. Infrastructure decisions (rulings on the developer's proposals — re-ruled under the FREE constraint)

| # | Proposal | Ruling | One-line reason |
|---|---|---|---|
| 1 | Caddy reverse proxy (with explicit WebSocket handling) | **NOT DEPLOYED — the paid VPS it rode on is rejected for cost; survives as the "how I'd self-host" README paragraph** | Vercel's and Render's edges already terminate TLS and proxy the WS Upgrade for free, so there is nothing left for Caddy to do in this deployment — the researched Caddy/wss knowledge is kept as interview depth (§11, §12) |
| 2 | gunicorn in production, uvicorn in dev | **REJECT gunicorn — plain `uvicorn --workers 1` in BOTH (unchanged)** | gunicorn's entire value is multi-process management, which the process-local ConnectionManager forbids; Render itself restarts a crashed service, and the classic `-k uvicorn.workers.UvicornWorker` path is deprecated since uvicorn 0.30 |
| 3 | SSL + Docker | **SSL: provided automatically by both platforms. Docker: KEEP `backend/Dockerfile` — Render's free tier builds it straight from the repo** | `*.vercel.app` and `*.onrender.com` ship TLS out of the box so `wss://` needs zero certificate work (browser wss → Render's edge terminates TLS → plain HTTP Upgrade to the container); Render's Docker runtime is fully available on the Free instance type, so the developer keeps the Docker story at $0 |
| 4 | Next.js file-based routing with `app/` (App Router) | **ADOPT (already locked)** | It's the assignment-fixed stack and the blueprint's §8 already uses it — file-based routes, `(chat)` group layout hosting the ChatProvider, `'use client'` where interactivity lives |
| 5 | WebSockets | **LOCKED (unchanged)** | Assignment-mandated; the entire ack/receipt protocol and reconnect loop are WS-native |
| 6 | SQLite with SQLAlchemy ("sequalise") | **ADOPT-WITH-CONSTRAINTS** | Legitimate middle ground *only* as the sync-2.0 explainable subset (§4): the official FastAPI tutorial pattern, no async engine (MissingGreenlet trap), no `relationship()`, hardest queries stay hand-written `text()` SQL |
| 7 | WebTransport ("will have to decide") | **REJECT as transport; KEEP as a README/interview talking point** | uvicorn has no HTTP/3/QUIC and WebTransport isn't even in the ASGI spec — it cannot plug into the locked stack, and the assignment fixes plain WebSockets anyway |
| 8 | Free hosting (new hard constraint: $0, assignment names Vercel) | **ADOPT Vercel (frontend) + Render free web service (backend); fallback: Hugging Face Docker Space** | Render is the only mainstream 2026 PaaS left with a permanent, card-free free tier that officially documents WebSocket support with no imposed connection timeout — and "Render" is literally on the assignment's platform list (Koyeb closed free signups post-Mistral acquisition, Fly requires a card, Railway's trial credit expires, PythonAnywhere can't run ASGI/WS) |

**The WebTransport paragraph (rehearse it — it's free depth):** "I considered WebTransport and chose WebSockets for three concrete reasons. First, my mandated backend can't speak it: uvicorn has no HTTP/3/QUIC support at all, WebTransport isn't even part of the ASGI spec — the asgiref proposal has been open since 2021 — and the only Python paths today are hand-rolling an aioquic event loop or an unmerged Hypercorn draft PR, none of which plugs into FastAPI in a production-shaped way. Second, WebTransport solves problems a chat app doesn't have: its wins are unreliable datagrams and multiple independent streams to avoid head-of-line blocking, which matter for games and live media; chat needs exactly one ordered, reliable, bidirectional stream, which is precisely what WebSocket — RFC 6455, boring and universally proxied — already is. Third, it's operationally immature even in 2026: Safari only shipped it in 26.4 this March so every older iOS device needs a WebSocket fallback anyway, no mainstream proxy edge passes WebTransport sessions upstream today — even Caddy, the proxy I'd use if self-hosting, has only an unmerged experimental passthrough PR, and Render's proxy doesn't speak it at all — and the IETF drafts still aren't RFCs. Since I'd have to build the WebSocket path regardless, WebTransport would only add a second transport to explain and debug, for zero user-visible gain in a text chat." Bonus aside: "The boring transport is also what makes free hosting possible: the WebSocket rides a normal HTTP/1.1 Upgrade through Render's proxy on the single public port — no special edge support needed."

---

## 5. WS event protocol

One socket per logged-in user. Every frame is JSON: `{"type": "...", ...payload}`. Defined once as a TypeScript discriminated union (`lib/types.ts`) mirrored by the Python `if/elif` dispatch. All datetimes are ISO-8601 strings (raw `datetime` raises `TypeError` inside `send_json`).

### Client → Server (3 events)

| Type | Payload | Trigger | Server action |
|---|---|---|---|
| `message.send` | `conversation_id, client_id, body, reply_to_id?` | User hits send (bubble already rendered as "sending") | Validate membership → INSERT → `message.ack` to sender → `message.new` to other online members → advance their delivered pointers → `receipt.delivered` back |
| `typing` | `conversation_id` | Keystroke, throttled to ~1 per 2–3 s | Pure relay to other **online** members. Never touches the DB |
| `read` | `conversation_id, up_to_message_id` | Conversation open/visible | UPDATE `last_read_message_id` → broadcast `receipt.read` to other online members |

### Server → Client (6 events)

| Type | Payload | Sent to | Client action |
|---|---|---|---|
| `message.ack` | `client_id, message` (real id, server timestamp) | Sender only | Find bubble **by client_id**, update **in place**: `sending → sent` |
| `message.new` | `message` | Other conversation members online | Append bubble; bump conversation preview + unread badge |
| `receipt.delivered` | `conversation_id, user_id, up_to_message_id` | Online senders | Grey single → grey double when all members' pointers pass the message id |
| `receipt.read` | `conversation_id, user_id, up_to_message_id` | Other online members | Grey double → blue double when all read pointers pass |
| `typing` | `conversation_id, user_id` | Other online members | Show "typing…", clear on 3 s timeout |
| `error` | `code, detail` | Offending client | Log / toast on malformed frames |

Group membership changes (`member.added` / `member.removed`) are pushed through the same manager **by REST handlers** — same process, same dict.

A note on the client heartbeat (new with the free host): the ChatProvider sends `{"type":"ping"}` every ~25 s while connected; the server replies `{"type":"pong"}` (or simply ignores it). This defeats NAT/proxy idle timeouts *and* counts as inbound traffic that holds off Render's 15-minute spin-down while a chat tab is open (§11). It is the one event type that exists purely for infrastructure.

---

## 6. Message status state machine

Strictly monotonic: `sending → sent → delivered → read`. **Each state has exactly one writer.**

| Transition | Actor | Mechanism |
|---|---|---|
| *(start)* → `sending` | **Sender's client only** | Optimistic bubble keyed by `crypto.randomUUID()` client_id. Never exists server-side |
| `sending → sent` | **Server**, at INSERT commit | `message.ack` carries real id + server timestamp; client reconciles by client_id, in place (never delete-and-reinsert — bubbles visibly jump) |
| `sent → delivered` | **Server**, at push time | Successful `send_to_user` on a live socket, **or** bulk pointer advance when the recipient's socket next connects. The actor is the recipient's *connection*, not any user action |
| `delivered → read` | **Recipient's client** | Sends `read` when the chat is open/visible; server advances the read pointer and broadcasts |
| `sending → failed` (client-only edge) | Sender's client | No ack before socket close → "failed, tap to retry"; retry reuses the **same client_id**, and `UNIQUE(sender_id, client_id)` makes it idempotent |

Ticks: spinner = sending · single circled check = sent · double circled checks = delivered by **all** other members · double **filled** circled checks = read by **all** (`MIN()`-across-members semantics; noted in README). Glyph geometry per DESIGN.md — Signal's real v3 status icons are checks inside circles, and read state is *filled*, never blue.

---

## 7. API surface

All REST, prefixed `/api`, session token in `Authorization: Bearer <token>` (REST can set headers; only WS can't).

| Method + Path | Purpose |
|---|---|
| `POST /api/auth/register` | Create user (phone + username + display name) |
| `POST /api/auth/verify-otp` | Fixed OTP `123456` → creates session, returns token |
| `POST /api/auth/login` | Phone/username → "OTP sent" (mocked) |
| `POST /api/auth/logout` | Delete session row |
| `GET  /api/auth/me` | Current user from token |
| `GET  /api/users/search?q=` | Find users to add as contacts |
| `GET  /api/contacts` · `POST /api/contacts` | List / add contacts (list search is client-side filtering) |
| `GET  /api/conversations` | **The left-pane query**: each row carries last-message preview, unread count (`COUNT(id > last_read)`), members, online flags (derived from `manager.active`) |
| `POST /api/conversations` | Create DM (`peer_id`, dm_key dedupe) or group (`name` + `member_ids`, creator = admin) |
| `GET  /api/conversations/{id}/messages?before_id=&limit=50` | Paginated history on the AUTOINCREMENT id |
| `POST /api/conversations/{id}/members` | Admin adds member → also pushes `member.added` via manager |
| `DELETE /api/conversations/{id}/members/{user_id}` | Admin removes member → pushes `member.removed` |
| `PATCH /api/conversations/{id}` | Rename group |

Plus `GET /health → {"ok": true}` (unprefixed — the keep-warm pinger's target, §11) and `wss://…/ws?token=` — the single WebSocket endpoint. The auto-generated `/docs` page is free evaluator candy.

---

## 8. Folder structure

```
render.yaml            # the whole host config in ~10 committed lines: type web, runtime docker,
                       #   plan free, rootDir backend, FRONTEND_ORIGIN env var (dashboard
                       #   click-ops works too — the file just makes it reviewable)

backend/
  Dockerfile           # python:3.12-slim; pip install -r requirements.txt; COPY app;
                       #   CMD ["sh","-c","exec uvicorn app.main:app --host 0.0.0.0 \
                       #        --port ${PORT:-10000} --workers 1"]
                       #   'exec' so SIGTERM reaches uvicorn; ${PORT} because Render injects it.
                       #   Render's free tier builds this straight from the repo — the Docker
                       #   story survives the move off the VPS at $0
  app/
    main.py            # FastAPI app wiring: CORSMiddleware (exact Vercel origin + localhost +
                       #   anchored preview regex — REST only), routers, GET /health,
                       #   lifespan: create_all + seed-if-empty (MANDATORY: disk is ephemeral)
    db.py              # SQLAlchemy engine; PRAGMA event listener (foreign_keys, WAL,
                       #   busy_timeout); sessionmaker(expire_on_commit=False); get_db dependency
    models.py          # 2.0 declarative models (DeclarativeBase, Mapped, mapped_column);
                       #   Base.metadata.create_all replaces schema.sql; DDL lives in README
    queries.py         # every query as a small named function — select() for the simple ones,
                       #   hand-written text() SQL for unread counts + MIN-pointer receipts
    ws.py              # THE realtime layer (~120 lines): ConnectionManager + /ws endpoint
                       #   + if/elif dispatch for message.send / typing / read / ping. Rehearse hardest.
    schemas.py         # Pydantic request/response models for the REST routes
    deps.py            # get_current_user dependency (token -> sessions lookup)
    routers/
      auth.py          # register / verify-otp / login / logout / me
      contacts.py      # contact list + add + user search
      conversations.py # list (the big left-pane query), create, history
      groups.py        # member add/remove/rename; pushes WS events via the shared manager
    seed.py            # seed-if-empty: 6 users, DMs + 'Weekend Trip' group, staggered history,
                       #   varied receipt states, unread badges — runs on EVERY cold start,
                       #   so the demo always wakes into a ready state
  requirements.txt     # fastapi, uvicorn[standard], pydantic, sqlalchemy — that's it

frontend/
  app/
    layout.tsx         # root layout, theme (CSS variables for dark mode)
    login/page.tsx     # phone + OTP form, one-click 'Login as Alice/Bob' demo buttons
    (chat)/
      layout.tsx       # authenticated layout — ChatProvider mounts HERE so switching
                       #   conversations never tears down the socket
      page.tsx         # two-pane shell: ConversationList | ChatPane
  lib/
    types.ts           # the WS event envelope as a TS discriminated union + model types
    api.ts             # one fetch wrapper attaching the session token; base = NEXT_PUBLIC_API_URL
  state/
    ChatProvider.tsx   # 'use client'. Socket in useRef; useEffect connect/cleanup;
                       #   exponential-backoff reconnect (retry >=90s to outlast a cold start);
                       #   onopen refetch; 25s heartbeat ping. WS URL = literal
                       #   process.env.NEXT_PUBLIC_WS_URL (dynamic lookups aren't inlined).
                       #   Rehearse hardest.
    chatReducer.ts     # single switch, one case per event type — server events ARE actions
  components/
    ConversationList.tsx  # left pane: search filter, unread badges, previews, timestamps
    ChatPane.tsx          # header (name, online/typing), message scroll, composer
    MessageBubble.tsx     # bubble + tick glyphs (clock / ✓ / ✓✓ grey / ✓✓ blue) + reply quote
    Composer.tsx          # input; disabled when socket not OPEN; Enter to send
    NewChatModal.tsx      # start DM from contacts
    NewGroupModal.tsx     # name + member picker
    GroupInfoPanel.tsx    # members, roles, admin add/remove
    SettingsModal.tsx     # placeholders: privacy / notifications / appearance / 'Coming Soon'
    Avatar.tsx            # initials + deterministic color hash
    ReconnectBanner.tsx   # 'Reconnecting…' when socket is down
  .env.local             # local dev values: NEXT_PUBLIC_API_URL=http://localhost:8000,
                         #   NEXT_PUBLIC_WS_URL=ws://localhost:8000. Production values live in
                         #   Vercel project settings and are BAKED INTO THE BUNDLE at build
                         #   time — changing them requires a redeploy, not a dashboard edit
```

(No Caddyfile, no docker-compose.yml, no frontend Dockerfile — Vercel builds the frontend natively; the backend Dockerfile is the one container artifact and doubles as the local-dev runner.)

The two files that **are** the interview: `backend/app/ws.py` and `frontend/state/ChatProvider.tsx` (+ `chatReducer.ts`). Walk them aloud top to bottom twice before the evaluation.

---

## 9. Build order (each milestone ends demoable)

| # | Hours | Deliverable at the end | Contents |
|---|---|---|---|
| **M0** | 0–3 | Login + seeded conversation list, **already live on Vercel + Render** | Scaffold both apps **plus `backend/Dockerfile` and `render.yaml` from hour zero**; full schema in `models.py` up front (incl. pointers, `reply_to_id`, `dm_key`); mocked OTP + sessions; seed-if-empty; `/health`; conversation-list REST. **Create the Render service (sign up with GitHub OAuth EARLY — scattered reports of accounts asked for card verification as abuse prevention; don't discover this the night before) and import the repo into Vercel NOW** — CORS, NEXT_PUBLIC env vars, wss, single worker, cold-start behavior sorted while surface area is tiny. **The moment the service is live, enable BOTH keep-warm pingers (cron-job.org + UptimeRobot, §11) — from this point the backend never sleeps for the life of the project** |
| **M1** | 3–9 | Two browser windows chatting in real time | Straight to WebSockets, no polling detour: ConnectionManager, `/ws?token=`, `message.send/ack/new`, persist-first; ChatProvider with useRef socket, reducer, optimistic send, backoff reconnect. Test against the **deployed** backend before closing the milestone |
| **M2** | 9–13 | Full single/double/blue-check experience | Delivered pointers (push-time + bulk on connect), read events, unread badges, typing relay with throttle + 3 s clear |
| **M3** | 13–16 | 3-user group chat with admin controls | Nearly free — fan-out already loops over members. Create-group modal, info panel, admin add/remove via REST that pushes through the shared manager (best interview moment). Seed a group |
| **M4** | 16–20 | **Looks like Signal** (timeboxed — hard stop) | Clone Signal Desktop literally, following **DESIGN.md** (researched from Signal-Desktop's open-source stylesheets — accent is #2c6bed ultramarine, NOT the older #3A76F0) and **DESIGN_BRIEF.md** (phone/tablet/laptop responsive contract): two panes, bubble shapes, tick glyphs (checks-in-circles per DESIGN.md), initials avatars, "end-to-end encrypted" lock banner (the whole encryption mock), settings placeholders, "Coming Soon" modals. Built on CSS variables |
| **M5** | 20–24 | Hardened + documented + bonuses | Reconnect banner; 25 s heartbeat ping; verify both keep-warm pingers (enabled back in M0) are green and the UptimeRobot dashboard shows continuous uptime; restart drill (Manual Deploy on Render → data reseeds, sockets reconnect); README (schema DDL, WS event table, state machine, deliberate-limitations section incl. **"data resets on redeploy/restart/spin-down — free-tier ephemeral disk, by design"**, the how-I'd-self-host Caddy paragraph, the WebTransport why-not paragraph — it's a graded deliverable, budget 2 h); then **freeze deploys for the evaluation window** (any push = data wipe + socket churn). Bonuses strictly in order: dark mode (~30 min on the CSS variables) → replies (column exists; quoted bubble) → reactions only if time truly remains. **Stop there**. *Outcome (as shipped): reconnect banner, heartbeat, README, and the first two bonuses landed — dark mode (Light/Dark/System, persisted, no-flash) and reply quotes (server-validated `reply_to_id` + quote-block UI); reactions were not built. Three WS integration suites (`tests_ws_integration.py`, `tests_ws_m2.py`, `tests_ws_m3.py`) document and verify the protocol* |

Real-time messaging works end-to-end by hour 10; everything after degrades gracefully.

---

## 10. Mock vs real ledger

| REAL (fully implemented) | MOCKED (with the honest story) |
|---|---|
| Message persistence — SQLite, source of truth | **OTP** — fixed `123456`, no SMS; sessions themselves are real rows |
| Real-time delivery over WebSockets | **Encryption** — lock banner + README paragraph: "clients would encrypt before `ws.send`; the server stores/forwards opaque ciphertext — my persist-then-fan-out path is unchanged, which is why mocking is honest" |
| Delivery/read receipts — derived from stored pointers, correct even offline | **Last seen** — one timestamp written on disconnect; presence itself is real (5 lines: online ⇔ `user_id in manager.active`) |
| Typing indicators (real relay, deliberately never persisted) | **Avatars** — initials + color hash, no upload |
| Unread counts — computed in SQL | **Calls / stories / linked devices / disappearing messages** — "Coming Soon" placeholders, as the assignment invites |
| Groups with roles + admin add/remove | **Search** — conversation-list search is a client-side filter of the already-fetched list (user search for adding contacts is a real REST query, `GET /api/users/search`) |
| Sessions, reconnect + catch-up, optimistic send with idempotent retry | **Multi-tab** — one socket per user; new login replaces old (documented) |
| Dark mode (shipped bonus) — Light/Dark/System, persisted, no-flash inline script | |
| Reply quotes (shipped bonus) — server-validated `reply_to_id`, compact `reply_to` summary on the wire, quote-block UI | |
| Responsive layout — phone/tablet/desktop per DESIGN_BRIEF.md | |
| **Cut entirely:** attachments (worst cost/value for a 24-hour budget), reactions, Redis/broadcaster, async ORM, message edit/delete, cursor-pagination machinery beyond `before_id` | |

---

## 11. Deployment plan (Vercel + Render, both free)

**Host choice — Render free web service, deployed from `backend/Dockerfile`.** It is the only remaining mainstream PaaS in 2026 with a permanent, no-credit-card free tier that *officially documents* WebSocket support — Render imposes no fixed/maximum WS connection duration and no idle proxy timeout of its own — and "Render" is on the assignment's named platform list. 750 free instance hours per workspace per month (enough for exactly ONE service always-on: ~744 h), 512 MB RAM / 0.1 CPU, suspend-not-bill if limits hit. The eliminated alternatives, for the README's honesty section: **Koyeb** (Mistral acquired it 2026-02-17; free Starter tier closed to new signups), **Fly.io** (free tier dead for new accounts; card or $25 prepaid required), **Railway** ($5 one-time 30-day trial then a $1/mo credit that barely covers one tiny service — too fragile to bet an assignment on, plus trial volumes get deleted), **PythonAnywhere** (WSGI-only in practice; ASGI still experimental — cannot run WS), **Glitch/Deta** (shut down), **Leapcell** (free tier is per-request serverless — a 900 s invocation timeout cannot hold a long-lived socket).

**Backend on Render (the steps).**
1. Keep `backend/Dockerfile`: `FROM python:3.12-slim` → `pip install -r requirements.txt` → `COPY app` → `CMD ["sh","-c","exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000} --workers 1"]`. `exec` so SIGTERM from the platform reaches uvicorn; `${PORT}` because Render injects it (default 10000). Slim base matters twice: fast deploys and the 512 MB ceiling. Docker deploys are fully supported on the Free instance type, and **building from the repo Dockerfile keeps push-to-deploy** (a prebuilt registry image would disable auto-deploy).
2. New Web Service → connect the GitHub repo → runtime auto-detects Docker → Instance type: **Free** → env var `FRONTEND_ORIGIN=https://<app>.vercel.app` (or commit `render.yaml` with the same). URL: `https://<name>.onrender.com`.
3. **One worker, enforced twice:** the CMD pins `--workers 1`, and never set `WEB_CONCURRENCY` in the dashboard — uvicorn silently reads it, and 2+ workers break cross-user delivery with no error. The free tier's single instance means horizontal scaling can't sneak in either.
4. **Everything through one port.** Render exposes exactly one public port; REST and the WS Upgrade both ride it. Custom ports (`wss://app.onrender.com:5000`) are not reachable externally.

**The ephemeral disk — data does NOT survive. Design for it, don't fight it.** Render's own docs: local filesystem changes — *explicitly including SQLite databases* — are lost on **every redeploy, restart, or spin-down**. Persistent disks are paid-only. So:
- `Base.metadata.create_all(engine)` + **idempotent seed-if-empty** (check `SELECT count(*) FROM users` first) in the FastAPI lifespan handler is **mandatory** — every cold start boots into a fresh, demo-ready state instead of an empty one.
- The README states plainly: "data resets on redeploy/restart/spin-down — free-tier ephemeral disk, by design." Never promise persistence.
- **Freeze deploys during the evaluation window**: a git push = fresh filesystem (total data wipe) + SIGTERM to uvicorn (all sockets drop with a 30 s grace window; clients reconnect).
- Do NOT be tempted by Render's free Postgres instead: it **expires 30 days after creation** (14-day grace) — a time bomb if the evaluation slips.

**Spin-down, cold starts, and the reconnect loop.** Free services spin down after **15 minutes** without inbound traffic (tightened from 30 min effective 2025-09-01) and wake on the next HTTP request *or new WebSocket connection attempt*, taking ~30–60 s. When a live service spins down or redeploys, open sockets die abnormally — community reports show **close code 1006** — and one report shows sockets killed at ~15 min even *with* 30 s in-band pings, so in-band WS pings cannot be fully trusted to keep the instance warm (external HTTP pings can; Render does document that WS messages on existing connections count as traffic — belt and braces: keep both). Defenses, all client-side and already in the blueprint (this is literally Render's officially recommended pattern):
- **Exponential-backoff reconnect:** `min(1000 * 2**attempts, 30000)` + jitter, reset on open, `closedOnPurpose` guard so logout never loops — and **keep retrying for ≥90 s** so the loop outlasts a cold start (each attempt itself triggers/continues the wake; one eventually succeeds).
- **`onopen` refetch** of conversations + open-chat history — doubles as offline-message delivery and papers over anything missed during a restart (clients aren't guaranteed the same instance state).
- **25 s heartbeat** (`{"type":"ping"}`) while connected — defeats NAT/proxy idle timeouts and holds off spin-down while a chat tab is open. An open-but-*silent* connection does NOT count as activity; only messages do.

**Keep-warm pinger (MANDATORY, set up in M0 the moment the service is live — this is what makes "no sleep windows" true).** Spin-down only triggers after 15 idle minutes; a 5-minute external ping means the service **never idles long enough to sleep**, so an evaluator opening the link at any hour gets a warm app instantly. Run TWO independent free pingers so one failing never exposes a sleep window: cron-job.org (fully free, no card) + UptimeRobot free, both GET `https://<name>.onrender.com/health` every 5 minutes. Details that bite:
- Ping a **real route** — Render intercepts `/robots.txt` while spun down, so pinging it never wakes anything.
- A cold wake (~60 s) exceeds cron-job.org's 30 s timeout, so the wake-up ping logs as "failed" while still working; at 5-min cadence failures never accumulate to its 15-consecutive-failures auto-disable — but **enable the pinger only after the service is live**.
- UptimeRobot free as the second pinger (50 monitors, fixed 5-min interval; ToS restricts free plans to personal/non-commercial use since Dec 2024 — an assignment qualifies) — also gives an uptime dashboard as evidence the demo stayed up.
- **Skip GitHub Actions cron** as a pinger: 5-min floor but routinely fires 5–30+ min late, auto-disables after 60 days without commits, and it's a ToS gray area.
- The math: one always-warm service ≈ 744 of the 750 monthly hours. **Run only this ONE backend service in the free workspace** — a second always-on free service exhausts the shared pool around day 16 and Render suspends ALL free services until the next month.
- Honesty note for the README/interview: pinging is a tolerated workaround, not a feature — Render's sanctioned fix is the $7/mo Starter instance, and Render may restart a free service at any time regardless (refetch-on-open absorbs this). The real demo-day defense is the warm-up in the checklist below.

**wss:// and TLS — zero backend involvement.** Render serves TLS on `*.onrender.com` by default: the browser opens `wss://<name>.onrender.com/ws?token=…` → Render's edge terminates TLS → forwards a plain-HTTP `Upgrade` to the container on `$PORT` → uvicorn accepts with 101 → the edge tunnels bytes both ways. The app never touches a certificate. **Always `wss://`, never `ws://`:** the https Vercel page blocks `ws://` as mixed content with no useful error, and Render answers `ws://` handshakes with a 301 that breaks most clients.

**CORS — for REST only, precisely configured:**

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ["FRONTEND_ORIGIN"],      # https://<app>.vercel.app — EXACT string
                   "http://localhost:3000"],           #   match: scheme+host, NO trailing slash
    allow_origin_regex=r"https://<project>-[a-z0-9]+-<team>\.vercel\.app$",  # preview deploys:
    allow_credentials=True,                            #   escape dots, ANCHOR it (an unanchored
    allow_methods=["*"], allow_headers=["*"],          #   .*vercel.app matches evil domains)
)
```

`allow_credentials=True` cannot combine with `allow_origins=["*"]`. And the standing aside: **browsers do not enforce CORS on WebSocket handshakes at all** — `/ws` will connect cross-origin even with CORS misconfigured; CORS errors only ever affect the REST fetches. Optionally validate the `Origin` header manually inside the WS endpoint (CWE-1385) — a nice explainability talking point, not required for the demo.

**Frontend on Vercel.** Import the repo, root directory `frontend/`, set `NEXT_PUBLIC_API_URL=https://<name>.onrender.com` and `NEXT_PUBLIC_WS_URL=wss://<name>.onrender.com` for Production *and* Preview, deploy. `NEXT_PUBLIC_*` values are **inlined into the client bundle at `next build` time** — changing one later requires a redeploy (fresh build), not just a dashboard edit — and only full literal references (`process.env.NEXT_PUBLIC_WS_URL`) are inlined; dynamic `process.env[name]` lookups are not. Tip: derive the WS URL from the API URL (`https` → `wss`) in one line to keep a single source of truth. Demo from the **production** URL: preview deployments get unique URLs (hence the regex) and Vercel Deployment Protection on previews can 401 the CORS preflight.

**Dev vs prod — the same plain uvicorn.**
- **Dev:** `uvicorn app.main:app --reload --port 8000` + `next dev` (with `.env.local` pointing at localhost). Every file save restarts the process and drops live sockets with abnormal close 1006 plus some transient ASGI noise — expected behavior (starlette #986, uvicorn #1344); the client backoff reconnects. Never `--reload` in prod. The Dockerfile doubles as the local runner (`docker build && docker run -p 8000:10000 …`) if you want prod parity.
- **Prod:** the Dockerfile CMD above. No gunicorn (§4a ruling): its value is multi-process management, which the process-local manager forbids; the one thing left — restarting a crashed process — **Render itself does** for a managed service.

**Fallback host (only if Render blocks the account): Hugging Face Docker Space.** Also free, no card, and generous where Render is tight: 2 vCPU / 16 GB RAM on free `cpu-basic`, sleeps only after **48 hours** of inactivity (wakes in ~1 min on visit). The cost is HF-specific Dockerfile quirks: the container runs as **UID 1000** (create a non-root user and set a writable `WORKDIR` *before* COPY; the SQLite file must live in that UID-1000-writable directory), and the app must listen on **port 7860** or declare `app_port` in the README YAML front-matter. Public URL: `https://<user>-<space>.hf.space`, sockets at `wss://…` (the classic HF forum "WebSocket 404" is someone using `ws://`). Same ephemeral-disk caveat; same seed-if-empty answer.

**How I'd self-host this (keep as a README paragraph — it was the previous revision of this blueprint, rejected purely on cost):** "One small VPS, three containers under Docker Compose, Caddy as the only public entry point. The domain alone in the Caddyfile site address is the entire TLS setup — Caddy provisions and renews Let's Encrypt certificates and redirects 80→443 automatically — and WebSockets need *zero* proxy configuration: the official `reverse_proxy` docs say it 'performs the HTTP upgrade request then transitions the connection to a bidirectional tunnel' (where nginx needs the `proxy_set_header Upgrade/Connection` dance; adding those nginx-style lines to Caddy actually *breaks* its WS handling). `handle /api/*` and `handle /ws` route to the backend container, a fallback `handle` to the Next.js standalone server — one origin, so CORS and the `NEXT_PUBLIC_*` URLs disappear entirely — and SQLite lives on a bind-mounted volume, so data finally survives redeploys. That shape costs ~€4/month; the assignment required free, so the platform edges do Caddy's job instead."

**Gotchas ledger (each one is a one-liner in the README):**
- The disk is ephemeral on BOTH Render free and HF Spaces free — the SQLite file is wiped on every deploy, restart, or spin-down; seed-if-empty is the documented mitigation, and keep-warm pinging doubles as data persistence.
- Only external HTTP requests reliably reset Render's idle timer — don't rely on in-band WS pings alone to keep the instance warm (community report: sockets killed at ~15 min despite 30 s pings, close 1006).
- `wss://` on port 443 only — `ws://` gets a 301, custom ports are unreachable, and the https page blocks `ws://` as mixed content anyway.
- Every deploy drops all sockets (SIGTERM, 30 s grace) — reconnect logic is not optional; handle SIGTERM so SQLite closes cleanly (moot for data, tidy for logs).
- CORS: trailing slash or scheme mismatch in `allow_origins` fails silently (exact string compare); unanchored `allow_origin_regex` matches attacker domains; and CORS never affects `/ws` — don't debug the socket there.
- `NEXT_PUBLIC_*` is frozen at build time — a wrong URL is a redeploy, not a dashboard edit.
- One free service per workspace, one uvicorn worker, no `WEB_CONCURRENCY` — the 750 h pool, the 512 MB ceiling, and the in-memory manager all point the same direction.
- Sign up for Render with GitHub OAuth early — scattered reports of card-verification prompts as abuse prevention; don't discover this the night before the deadline.

**Pre-interview checklist:** T-24 h: Render service live, cron-job.org pinger green, Vercel production deploy current → two-browser (Alice/Bob) smoke test of message → ticks → typing → group add/remove **on the real URLs** (`https://<app>.vercel.app` against Render), not localhost → devtools Network tab shows the socket as `wss://` with **101 Switching Protocols** → `/docs` renders on the Render URL → then **freeze deploys until the evaluation is over**. T-5 min before the interview: open the production URL, click through once, send one message — this guarantees a warm instance and seeded data regardless of what the pinger is doing — and leave the tab open (the 25 s heartbeat counts as traffic and holds it awake).

---

## 12. Interview cheat sheet

**Q: Why WebSockets over polling or SSE?**
Bidirectional real-time: server-push for messages/receipts *and* client-push for typing without per-event HTTP overhead. Polling adds latency and waste; SSE is server→client only, so sends would still need HTTP round-trips.

**Q: How does one Python thread serve hundreds of sockets?**
uvicorn runs one asyncio event loop; each connection is a coroutine parked at `await receive_json()`, costing nothing while idle. Every `await` is a yield point — cooperative concurrency, not parallelism. That's also why no handler may block: `time.sleep` freezes every socket at once.

**Q: Why exactly one uvicorn worker?**
The manager dict is process-local; with 4 workers, A and B can land in different processes and delivery silently fails. One async worker holds thousands of idle sockets. Scaling = Redis pub/sub between workers, per FastAPI's own docs. (The Render free tier runs one instance anyway — the platform and the architecture agree.)

**Q: Walk me through sending to an OFFLINE user.**
Optimistic bubble with a UUID client_id → WS frame → server validates membership, INSERTs first, acks the sender (→ "sent") → looks up the recipient in the dict, finds nothing, does nothing more. The recipient gets it via a REST history fetch on next load; at their connect the server bulk-advances their delivered pointer and pushes `receipt.delivered` to the sender. **Offline delivery is just the database plus a GET.**

**Q: Group of 5 — when does the sender see delivered vs read?**
Each membership row carries its own delivered and read pointer. "Delivered" when all other members' delivered pointers pass the message id; "read" when all read pointers do — one aggregate `MIN()` query, zero per-message receipt rows. The per-message receipts table is the design I'd switch to for Signal-exact per-member ticks.

**Q: How do you authenticate `/ws` if browsers can't set headers?**
Token in the query param, validated before `accept()`, closed with 1008 on failure — FastAPI's documented pattern. Query strings can leak into logs; fine for mocked auth over wss, and in production I'd mint a short-lived one-time ticket over REST.

**Q: Client closes the tab mid-session? Socket dies mid-group-broadcast?**
The parked `receive_json` raises `WebSocketDisconnect`; the except block pops the dict entry. Each fan-out `send_json` is individually try/except-ed with on-the-spot eviction, so one corpse can't break delivery to the rest.

**Q: Map sending/sent/delivered/read to owners.**
Sending: client-only optimistic state, temp UUID, never server-side. Sent: server's ack after INSERT, reconciled in place by client_id. Delivered: recipient's *connection* advancing their pointer (live push or bulk on reconnect). Read: recipient's client viewing the chat. One writer per state.

**Q: Why aren't typing indicators in the database?**
Ephemeral presence, worthless after ~3 seconds — pure relay to online members, throttled client-side, cleared on timeout. A lost typing event costs nothing. It's the one event that never touches the DB.

**Q: Sync SQLite inside async handlers — doesn't that block the loop?**
Yes, for the sub-millisecond duration of an indexed write — negligible here. At scale: `asyncio.to_thread` or aiosqlite. I deliberately avoided the async ORM because its MissingGreenlet lazy-load failure modes are far harder to explain than the microseconds saved.

**Q: Admin removes a member over REST — how does the removed user's screen update live?**
REST and WS routes are on the same app in the same process, so the handler imports the same manager singleton and pushes `member.removed` after the DB write. Same process = same memory = shared dict — the concrete payoff of the single-worker decision.

**Q: The demo took ~40 s to wake up — and what happens to data on the free tier?**
Render's free tier spins the service down after 15 idle minutes; the next request — including the reconnect loop's own WS attempt — wakes it in ~30–60 s. The client's exponential backoff keeps retrying past that window, and `onopen` refetches everything, so the UI self-heals with no user action. Data: the free disk is ephemeral, so every cold start wipes SQLite — by design the lifespan handler runs `create_all` + an idempotent seed, so the app always wakes into a demo-ready state; a keep-warm pinger on `/health` plus a T-5-minute manual warm-up keeps that from ever happening mid-interview. In production this whole class of problem is one paid tier (or the self-hosted VPS) away — I documented it instead of paying for it.

**Q: Why raw WebSocket and not Socket.IO?**
Socket.IO is a different wire protocol layered on WS — its client cannot connect to FastAPI's plain endpoint. Raw `new WebSocket()` is what FastAPI's docs demo: zero black boxes.

**Q: Where would real E2E encryption sit?**
Clients encrypt before `ws.send`; the server stores and forwards opaque ciphertext. My persist-then-fan-out path is unchanged — which is exactly why mocking it is honest.

**Q: Two DMs between the same pair?**
`dm_key = 'minUserId:maxUserId'` with a UNIQUE constraint; group rows leave it NULL.

**Q: How would you self-host this?**
One small VPS, three containers under Docker Compose, Caddy as the sole public entry point — that was a full revision of this plan before the free-hosting constraint landed. Two things make Caddy the right edge, both about deletable config. Automatic HTTPS: the domain in the site address is the entire TLS setup — Caddy provisions and renews Let's Encrypt certificates and redirects 80→443 by itself. And WebSockets need *zero* configuration: the official reverse_proxy docs say it "performs the HTTP upgrade request then transitions the connection to a bidirectional tunnel" — where nginx needs the `proxy_set_header Upgrade/Connection` dance; in fact, adding those nginx-style lines to Caddy *breaks* its WS handling. `handle /api/*` and `handle /ws` proxy to the backend container, a fallback `handle` to the Next.js standalone server — one origin, so CORS and the baked `NEXT_PUBLIC_*` URLs disappear — and SQLite on a bind-mounted volume finally survives redeploys. The whole edge is a ~12-line Caddyfile where every line has a one-sentence explanation. It costs ~€4/month; the assignment required free, so Vercel's and Render's edges do that job today.

**Q: Why not gunicorn in production — and what restarts the process if it crashes?**
Gunicorn's value is multi-process management: pre-fork N workers, restart dead ones, recycle leaky ones. My app is architecturally pinned to exactly one process — the WS registry is process-local memory — so that value proposition evaporates. The one thing left, restarting a crashed process, the platform already does: Render supervises and restarts a crashed managed service (on the self-hosted variant, Docker's `restart: unless-stopped` plays the same role); a gunicorn master inside the container would be a redundant second supervisor. It also adds a real footgun: gunicorn's `--timeout` heartbeat SIGKILLs the worker if the event loop ever blocks, dropping every socket at once. And the classic `-k uvicorn.workers.UvicornWorker` is deprecated since uvicorn 0.30 — the current official guidance from both FastAPI and uvicorn is a single uvicorn process per container, orchestrator supervises. So: plain `uvicorn --workers 1`, dev and prod.

**Q: How does SSL/wss work end to end?**
The browser opens `wss://<name>.onrender.com/ws?token=…`. Render's edge terminates TLS with the platform certificate for `*.onrender.com` and forwards a plain-HTTP Upgrade request to my container on `$PORT`; uvicorn replies 101 and the edge tunnels bytes both ways. Same shape for REST: https at the edge, plain http inside — and everything shares the single public port. The app never touches a certificate. It must be `wss://`: the https Vercel page blocks `ws://` as mixed content, and Render answers `ws://` handshakes with a 301 most clients can't follow. (Self-hosted, Caddy plays exactly the same terminate-and-tunnel role.)

**Q: Why sync SQLAlchemy, not async — and what is a Session?**
Async SQLAlchemy's signature failure is `MissingGreenlet` — a lazy load under asyncio blowing up in a way that's genuinely hard to explain, and per the official error docs it's exclusive to the asyncio extension. Sync sessions never enter greenlet code. My sync `def` REST handlers run in FastAPI's threadpool — the official tutorial pattern — so the event loop is never blocked; WS handlers open a short `with SessionLocal():` per event, serialize inside it, and fan out after it closes. A Session is a unit of work plus an identity map — one Python object per primary key per session; `flush` writes pending INSERTs (that's what assigns the AUTOINCREMENT message id) without ending the transaction, and `commit` is flush + COMMIT. I set `expire_on_commit=False` so reading `msg.id` after commit doesn't fire a surprise SELECT. And my two hardest queries — unread counts and the MIN-pointer receipt aggregate — stay hand-written parameterized SQL via `text()`.

**Q: Why WebSockets over WebTransport?**
Three concrete reasons. First, my mandated backend can't speak it: uvicorn has no HTTP/3/QUIC support, WebTransport isn't in the ASGI spec (the asgiref proposal has been open since 2021), and the only Python paths are hand-rolled aioquic or an unmerged Hypercorn draft PR. Second, it solves problems chat doesn't have — unreliable datagrams and independent streams matter for games and live media; chat needs exactly one ordered, reliable, bidirectional stream, which is precisely WebSocket (RFC 6455). Third, it's operationally immature even in 2026: Safari only shipped it in 26.4 this March so older iOS needs a WS fallback anyway, and no mainstream edge — Caddy included — passes WebTransport upstream yet; Render's proxy certainly doesn't. Since I'd build the WebSocket path regardless, WebTransport is a second transport to debug for zero user-visible gain — and the boring transport is exactly what lets the whole thing ride a free host's proxy unmodified.

**Also rehearse:** the FK pragma ("SQLite doesn't enforce foreign keys by default — I enable `PRAGMA foreign_keys=ON` on every connection"), and StrictMode's dev-only double connect ("proof my effect cleanup is correct; production connects once").

---

## 13. Sources

**Official docs (the backbone — cite these in the interview)**
- FastAPI — WebSockets (endpoint pattern, ConnectionManager, WebSocketDisconnect, token/cookie auth, single-process caveat): https://fastapi.tiangolo.com/advanced/websockets/
- FastAPI — Concurrency and async/await (event loop, "concurrent burgers"): https://fastapi.tiangolo.com/async/
- FastAPI — CORS (allow_origins exact match, allow_origin_regex, credentials caveat): https://fastapi.tiangolo.com/tutorial/cors/
- Uvicorn — WebSockets (ASGI connect/accept/receive/send/disconnect flow): https://uvicorn.dev/concepts/websockets/
- Uvicorn — Settings (workers, ws tuning): https://www.uvicorn.org/settings/
- React — Synchronizing with Effects (the canonical chat-connection useEffect example): https://react.dev/learn/synchronizing-with-effects
- Socket.IO — Troubleshooting (a Socket.IO client cannot connect to a plain WS server): https://socket.io/docs/v4/troubleshooting-connection-issues/

**Guides**
- websocket.org — FastAPI (scaling, multi-worker caveat, ~10K conns/worker): https://websocket.org/guides/frameworks/fastapi/
- websocket.org — React (useRef vs useState, StrictMode, backoff): https://websocket.org/guides/frameworks/react/
- websocket.org — Next.js (App Router, 'use client', external WS backend): https://websocket.org/guides/frameworks/nextjs/
- websocket.org — Authentication: https://websocket.org/guides/authentication/
- websocket.org — Reconnection (state sync and recovery): https://websocket.org/guides/reconnection/
- websocket.org — CORS (why WS doesn't use it): https://websocket.org/guides/troubleshooting/cors/
- websocket.org — wss vs ws: https://websocket.org/reference/wss-vs-ws/
- Better Stack — FastAPI WebSockets: https://betterstack.com/community/guides/scaling-python/fastapi-websockets/
- TestDriven.io — FastAPI + Postgres + WebSockets dashboards: https://testdriven.io/blog/fastapi-postgres-websockets/
- DEV — WebSocket auth in FastAPI (REST + one-time ticket pattern): https://dev.to/hamurda/how-i-solved-websocket-authentication-in-fastapi-and-why-depends-wasnt-enough-1b68
- DEV — FastAPI chat with rooms in 20 minutes: https://dev.to/amverum/websockets-on-fastapi-implementing-a-simple-chat-with-rooms-in-20-minutes-26hj
- Medium — Scaling WebSockets with Redis pub/sub + FastAPI: https://medium.com/@nandagopal05/scaling-websockets-with-pub-sub-using-python-redis-fastapi-b16392ffe291

**Reference implementations (patterns only — write every line yourself; plagiarism = disqualification)**
- notarious2/fastapi-chat (last-read pointer receipts, typed WS handlers, REST history): https://github.com/notarious2/fastapi-chat
- khfix/FastAPI-Chat-App-with-WebSockets (SQLite + JWT): https://github.com/khfix/FastAPI-Chat-App-with-WebSockets
- encode/broadcaster (archived Aug 2025 — the reason to avoid it): https://github.com/encode/broadcaster

**The deployed free stack (Vercel + Render)**
- Render Docs — Deploy for Free (750 h, 15-min spin-down, ephemeral filesystem/SQLite warning, no disks, robots.txt interception, no card): https://render.com/docs/free
- Render Docs — WebSockets on Render (no imposed timeout, wss:// requirement, keepalives, exponential-backoff reconnect guidance, single port, SIGTERM/30 s window): https://render.com/docs/websocket
- Render Docs — Docker on Render (Dockerfile builds on any instance type incl. Free, BuildKit, env vars as build args): https://render.com/docs/docker
- Render — Platforms with a real free tier for developers in 2026 (no credit card; Railway/Fly/Vercel comparison): https://render.com/articles/platforms-with-a-real-free-tier-for-developers-in-2026
- Render — Persistent Disks (ephemeral filesystem; disks are paid): https://render.com/docs/disks
- Render — FastAPI production best practices: https://render.com/articles/fastapi-production-deployment-best-practices
- Render forum — wss redirect issue (ws:// gets a 301): https://render.discourse.group/t/websocket-redirected-to-https-scheme-instead-of-wss-for-python-backend/16164
- Render community — free-tier WebSocket disconnects (close code 1006 at ~15 min despite in-band pings): https://community.render.com/t/render-free-node-js-websocket-disconnects-for-no-reason/21750
- Vercel KB — serverless functions and WebSockets: https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections
- Ably — why serverless can't host WebSockets: https://ably.com/topic/ai-stack/websockets-on-vercel-why-serverless-functions-cant-host-them
- Kuberns — Python on Vercel limitations: https://kuberns.com/blogs/vercel-python/
- Next.js Docs — Environment Variables (NEXT_PUBLIC_ inlined at build time): https://nextjs.org/docs/pages/guides/environment-variables
- Vercel Docs — Managing environment variables (changes require redeploy): https://vercel.com/docs/environment-variables/managing-environment-variables
- CWE-1385 — Missing Origin Validation in WebSockets: https://cwe.mitre.org/data/definitions/1385.html

**Free-tier landscape 2026 (the eliminations)**
- TechCrunch — Mistral AI buys Koyeb in first acquisition (free Starter tier closed to new users): https://techcrunch.com/2026/02/17/mistral-ai-buys-koyeb-in-first-acquisition-to-back-its-cloud-ambitions/
- Koyeb blog — Koyeb is Joining Mistral AI: https://www.koyeb.com/blog/koyeb-is-joining-mistral-ai-to-build-the-future-of-ai-infrastructure
- Koyeb Docs — Scale-to-Zero (WebSocket held connections and sleep behavior): https://www.koyeb.com/docs/run-and-scale/scale-to-zero
- srvrlss.io — Koyeb Free Tier 2026 (post-acquisition status): https://www.srvrlss.io/provider/koyeb/
- Fly.io Docs — Resource Pricing (plans closed to new customers, legacy free allowances only): https://fly.io/docs/about/pricing/
- Fly.io Docs — Billing (credit card requirement, $25 minimum prepaid credits): https://fly.io/docs/about/billing/
- Fly.io Docs — Free Trial (free tier discontinued for new users): https://fly.io/docs/about/free-trial/
- Railway Docs — Free Trial ($5 one-time credit, $1/mo Free plan afterward, volume deletion): https://docs.railway.com/pricing/free-trial
- PythonAnywhere Help — Deploying ASGI sites (beta/experimental; no free WS story): https://help.pythonanywhere.com/pages/ASGICommandLine/
- BleepingComputer — Glitch to end app hosting July 8, 2025: https://www.bleepingcomputer.com/news/security/glitch-to-end-app-hosting-and-user-profiles-on-july-8/
- Leapcell (free serverless tier; WS-capable persistent servers are paid): https://leapcell.io/
- TECHSY — Railway vs Render vs Fly.io 2026: https://techsy.io/en/blog/railway-vs-render-vs-fly-io
- hostim.dev — Render vs Railway vs Fly pricing 2026: https://hostim.dev/blog/render-vs-railway-vs-fly-pricing/

**Fallback host (Hugging Face Spaces)**
- Hugging Face Docs — Docker Spaces (Dockerfile deploy, app_port 7860, UID 1000, ephemeral data): https://huggingface.co/docs/hub/spaces-sdks-docker
- Hugging Face Docs — Spaces sleep behavior (48 h sleep on free cpu-basic): https://huggingface.co/docs/hub/en/spaces-gpus
- HF Forums — FastAPI WebSocket returns HTTP 404 on Spaces (wss:// fix): https://discuss.huggingface.co/t/fastapi-websocket-returns-http-404-on-spaces/159865

**Keep-warm pingers**
- UptimeRobot Pricing (free: 50 monitors, 5-min interval, no card): https://uptimerobot.com/pricing/
- UptimeRobot Free Plan in 2026 — non-commercial ToS restriction and limits: https://dev.to/r0tten0x/uptimerobot-free-plan-in-2026-the-limits-thatll-actually-bite-you-445g
- cron-job.org FAQ (free, up to 1-min frequency, 30 s timeout, 15-failure auto-disable): https://cron-job.org/en/faq/
- GitHub Community — Unexpected delay in scheduled GitHub Actions workflows (routine 5–30+ min delays): https://github.com/orgs/community/discussions/156282
- How to prevent GitHub from suspending your cronjob triggers (60-day auto-disable, ToS note): https://dev.to/gautamkrishnar/how-to-prevent-github-from-suspending-your-cronjob-based-triggers-knf

**Caddy + reverse proxy (backs the "how I'd self-host" paragraph)**
- Caddy docs — reverse_proxy directive (WebSocket auto-upgrade quote, flush_interval, stream_timeout, stream_close_delay): https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Caddy docs — Automatic HTTPS (activation from domain name, Let's Encrypt/ZeroSSL, renewal, redirects, requirements): https://caddyserver.com/docs/automatic-https
- Caddy docs — Keep Caddy Running (official docker-compose with caddy_data/caddy_config volumes): https://caddyserver.com/docs/running
- Caddy docs — Common Caddyfile Patterns (handle /api/* + fallback handle for SPA/frontend): https://caddyserver.com/docs/caddyfile/patterns
- Caddy docs — Global options (default server timeouts; idle 5 min, others off): https://caddyserver.com/docs/caddyfile/options
- Caddy docs — Reverse proxy quick-start: https://caddyserver.com/docs/quick-starts/reverse-proxy
- Caddy Community — Caddy Websockets Timing Out (manual Upgrade/Connection headers break WS): https://caddy.community/t/caddy-websockets-timing-out/30215
- caddyserver/caddy #5471 — WebSockets closed on config reload (rationale for stream_close_delay): https://github.com/caddyserver/caddy/issues/5471
- OneUptime — Docker with Caddy for Automatic HTTPS (caddy_data volume, rate limits): https://oneuptime.com/blog/post/2026-01-16-docker-caddy-automatic-https/view

**Serving FastAPI (uvicorn vs gunicorn)**
- Uvicorn — Deployment (gunicorn deprecation note, --workers process manager, proxy headers): https://uvicorn.dev/deployment/
- uvicorn-worker on PyPI (replacement package: uvicorn_worker.UvicornWorker): https://pypi.org/project/uvicorn-worker/
- Kludex/uvicorn-worker (callback_notify heartbeat, timeout/max_requests mapping): https://github.com/Kludex/uvicorn-worker
- uvicorn PR #2302 — Deprecate the uvicorn.workers module: https://github.com/Kludex/uvicorn/pull/2302
- FastAPI — Server Workers (uvicorn --workers only; gunicorn removed from docs): https://fastapi.tiangolo.com/deployment/server-workers/
- FastAPI — FastAPI in Containers: Docker (single process per container; exec-form CMD; tiangolo/uvicorn-gunicorn-fastapi deprecated): https://fastapi.tiangolo.com/deployment/docker/
- tiangolo/uvicorn-gunicorn-fastapi-docker — DEPRECATED: https://github.com/tiangolo/uvicorn-gunicorn-fastapi-docker
- Gunicorn — Settings (timeout is a heartbeat for non-sync workers; max_requests; graceful_timeout): https://docs.gunicorn.org/en/stable/settings.html
- starlette #986 — Errors during restart due to open websocket connections (--reload behavior): https://github.com/Kludex/starlette/issues/986
- uvicorn #1344 — Incorrect websocket close code (1006) on server shutdown/reload: https://github.com/Kludex/uvicorn/issues/1344
- fastapi/fastapi Discussion #8684 — WebSockets with multiple workers: https://github.com/fastapi/fastapi/discussions/8684

**Docker + Next.js + SQLite (local-dev / self-host reference)**
- Docker Docs — Containerize a Next.js application: https://docs.docker.com/guides/nextjs/
- vercel/next.js official with-docker example Dockerfile: https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile
- next.js Discussion #17641 — Docker image with NEXT_PUBLIC_ env variables (build-time inlining): https://github.com/vercel/next.js/discussions/17641
- Runtime environment variables in Next.js — reusable Docker images: https://nemanjamitic.com/blog/2025-12-13-nextjs-runtime-environment-variables/
- Simon Willison — SQLite WAL Mode Across Docker Containers Sharing a Volume: https://simonwillison.net/2026/Apr/7/sqlite-wal-docker-containers/
- OneUptime — How to Run SQLite in Docker (When and How): https://oneuptime.com/blog/post/2026-02-08-how-to-run-sqlite-in-docker-when-and-how/view
- OneUptime — SQLite production PRAGMA baseline (WAL + busy_timeout): https://oneuptime.com/blog/post/2026-02-02-sqlite-production-setup/view

**SQLAlchemy (sync 2.0 subset)**
- FastAPI — SQL (Relational) Databases tutorial (sync session-per-request, check_same_thread=False): https://fastapi.tiangolo.com/tutorial/sql-databases/
- SQLAlchemy 2.0 — SQLite dialect (foreign_keys event-listener recipe, pooling, check_same_thread): https://docs.sqlalchemy.org/en/20/dialects/sqlite.html
- SQLAlchemy 2.0 — Session Basics (identity map, flush vs commit, expire_on_commit): https://docs.sqlalchemy.org/en/20/orm/session_basics.html
- SQLAlchemy 2.0 — Error reference: MissingGreenlet (asyncio-extension-only): https://docs.sqlalchemy.org/en/20/errors.html
- SQLAlchemy 2.0 — ORM Quick Start (DeclarativeBase, Mapped[], mapped_column, select()): https://docs.sqlalchemy.org/en/20/orm/quickstart.html
- SQLAlchemy 2.0 — Relationship Loading Techniques (lazy default, selectinload, raiseload): https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html
- SQLAlchemy blog — 2.1.0b1 released (greenlet now optional; sync usage greenlet-free): https://www.sqlalchemy.org/blog/2026/01/21/sqlalchemy-2.1.0b1-released/
- FastAPI Discussion #6628 — DI-injected session pitfalls; context-manager-in-endpoint workaround: https://github.com/fastapi/fastapi/discussions/6628
- FastAPI Issue #3205 — sync session via Depends deadlock; per-message contextmanager pattern: https://github.com/fastapi/fastapi/issues/3205

**WebTransport (the why-not file)**
- caniuse — WebTransport (Baseline after Safari 26.4, ~88% global): https://caniuse.com/webtransport
- WebKit blog — WebKit Features for Safari 26.4 (WebTransport ships in Safari, March 2026): https://webkit.org/blog/17862/webkit-features-for-safari-26-4/
- django/asgiref issue #280 — Spec for WebTransport in ASGI (open since 2021): https://github.com/django/asgiref/issues/280
- Hypercorn — only Python ASGI server with HTTP/3 via aioquic; WebTransport still a draft PR: https://hypercorn.readthedocs.io/
- pgjones/hypercorn — draft PR #341 'Add WebTransport over HTTP/3 support' (unmerged): https://github.com/pgjones/hypercorn/pulls
- caddyserver/caddy PR #7669 — experimental WebTransport passthrough (open, targeted v2.12.0): https://github.com/caddyserver/caddy/pull/7669
- caddyserver/caddy issue #5421 — WebTransport via quic-go (ERR_METHOD_NOT_SUPPORTED through reverse_proxy): https://github.com/caddyserver/caddy/issues/5421
- caddyserver/caddy issue #5452 — HTTP/3 to upstreams (experimental, exclusive): https://github.com/caddyserver/caddy/issues/5452
- websocket.org — WebSocket vs WebTransport: When to Use Which: https://websocket.org/comparisons/webtransport/
- Ably — What is WebTransport and can it replace WebSockets?: https://ably.com/blog/can-webtransport-replace-websockets
- MDN — WebTransport API (streams, datagrams, browser compat): https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API
- W3C — WebTransport specification (Working Draft; CR expected 2026): https://www.w3.org/TR/webtransport/
- IETF — draft-ietf-webtrans-overview (still an Internet-Draft): https://datatracker.ietf.org/doc/draft-ietf-webtrans-overview/

**VPS hosting (kept — backs the "how I'd self-host" cost figure)**
- Hetzner CX22 Pricing 2026 (vpsfor.dev): https://vpsfor.dev/posts/hetzner-cx22-pricing-2026/
- Hetzner Docs — Price Adjustment 15 June 2026: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/
- DigitalOcean Droplet Pricing: https://www.digitalocean.com/pricing/droplets
