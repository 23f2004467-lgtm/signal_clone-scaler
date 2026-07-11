"""Shared dependencies: Bearer token -> current user."""

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app import models
from app.db import get_db

# auto_error=False so a missing header reaches our own 401 below (HTTPBearer's
# default is 403, which is the wrong status for "not authenticated").
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Resolve `Authorization: Bearer <token>` to a User via the sessions
    table, or 401. The WS endpoint (ws.py) reuses the same sessions table but
    reads the token from the query string instead."""
    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    session = db.get(models.Session, credentials.credentials)
    if session is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = db.get(models.User, session.user_id)
    if user is None:  # FK guarantees this never happens, but never return None
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user
