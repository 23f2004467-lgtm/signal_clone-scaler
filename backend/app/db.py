"""Engine, session factory, and the per-request session dependency.

Sync SQLAlchemy 2.0 only (blueprint §4): sync `def` REST handlers run in
FastAPI's threadpool, so the event loop is never blocked.
"""

import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./signal.db")

engine = create_engine(DATABASE_URL)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_connection, connection_record):
    # SQLite does NOT enforce foreign keys by default, and the default rollback
    # journal raises "database is locked" under concurrent writers -- so every
    # new connection gets these pragmas. PRAGMAs must run outside a transaction
    # (journal_mode=WAL refuses to run inside one), hence the brief autocommit
    # toggle on the raw sqlite3 connection (SQLAlchemy SQLite-dialect recipe).
    previous_autocommit = dbapi_connection.autocommit
    dbapi_connection.autocommit = True
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()
    dbapi_connection.autocommit = previous_autocommit


# expire_on_commit=False: reading msg.id after commit must not emit a surprise
# SELECT or raise DetachedInstanceError once the object leaves the session.
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


def get_db():
    """Session-per-request dependency (the official FastAPI tutorial pattern).

    WebSocket handlers (ws.py) do NOT use this -- they open a plain
    `with SessionLocal()` per event instead, so no session is ever held open
    across an `await`.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def utcnow_iso() -> str:
    """Every timestamp in the database is an ISO-8601 UTC string, generated
    server-side -- the client clock is never trusted."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
