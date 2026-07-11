"""FastAPI app wiring: lifespan (schema + seed), CORS, routers, /ws, /health."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import ws
from app.db import engine
from app.models import Base
from app.routers import auth, contacts, conversations, groups
from app.seed import seed_if_empty


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The free-tier disk is ephemeral: every cold start begins with an empty
    # filesystem, so create the schema and reseed demo data on every boot.
    # Both steps are idempotent, so a warm restart with data is a no-op.
    Base.metadata.create_all(engine)
    seed_if_empty()
    yield


app = FastAPI(title="Signal Clone API", lifespan=lifespan)

# CORS applies to the REST fetches only -- browsers never apply CORS to the
# WebSocket handshake, so /ws needs none of this.
frontend_origin = os.environ.get("FRONTEND_ORIGIN", "http://localhost:3000")
allow_origins = ["http://localhost:3000"]
if frontend_origin not in allow_origins:
    allow_origins.append(frontend_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,  # exact string match: scheme+host, no trailing slash
    # Vercel preview deploys get unique URLs; anchored at both ends so
    # "evil-vercel.app.attacker.com" can never match.
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(contacts.router)
app.include_router(conversations.router)
app.include_router(groups.router)
app.include_router(ws.router)  # the single WebSocket endpoint: /ws?token=


@app.get("/")
def root():
    """Friendly landing for anyone opening the backend URL directly."""
    return {"service": "Signal Clone API", "docs": "/docs", "health": "/health"}


@app.get("/health")
def health():
    """Unprefixed on purpose: the keep-warm pinger's target."""
    return {"ok": True}
