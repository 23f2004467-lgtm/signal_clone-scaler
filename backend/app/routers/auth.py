"""Auth: register -> login (mocked OTP) -> verify-otp (fixed 123456) -> session."""

import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import models, queries, schemas
from app.db import get_db, utcnow_iso
from app.deps import bearer_scheme, get_current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# The whole OTP mock: no SMS is ever sent, every account verifies with this.
FIXED_OTP = "123456"


@router.post("/register", response_model=schemas.UserOut, status_code=201)
def register(body: schemas.RegisterIn, db: Session = Depends(get_db)):
    taken = db.execute(
        select(models.User).where(
            or_(models.User.phone == body.phone, models.User.username == body.username)
        )
    ).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=409, detail="Phone or username already registered")
    user = models.User(
        phone=body.phone,
        username=body.username,
        display_name=body.display_name,
        created_at=utcnow_iso(),
    )
    db.add(user)
    db.commit()
    return user


@router.post("/login", response_model=schemas.DetailOut)
def login(body: schemas.LoginIn, db: Session = Depends(get_db)):
    user = queries.user_by_phone_or_username(db, body.phone_or_username)
    if user is None:
        raise HTTPException(status_code=404, detail="No account with that phone or username")
    # A real backend would text a one-time code here; the demo skips straight
    # to verify-otp with the fixed code.
    return {"detail": "OTP sent"}


@router.post("/verify-otp", response_model=schemas.AuthOut)
def verify_otp(body: schemas.VerifyOtpIn, db: Session = Depends(get_db)):
    if body.otp != FIXED_OTP:
        raise HTTPException(status_code=401, detail="Invalid OTP")
    user = queries.user_by_phone_or_username(db, body.phone_or_username)
    if user is None:
        raise HTTPException(status_code=404, detail="No account with that phone or username")
    # A real session row: the token authenticates REST (Bearer header) and
    # the WS handshake (?token=).
    token = secrets.token_hex(32)
    db.add(models.Session(token=token, user_id=user.id, created_at=utcnow_iso()))
    db.commit()
    return {"token": token, "user": user}


@router.post("/logout", response_model=schemas.DetailOut)
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    # Idempotent: logging out an already-dead token is still a success.
    if credentials is not None:
        session = db.get(models.Session, credentials.credentials)
        if session is not None:
            db.delete(session)
            db.commit()
    return {"detail": "Logged out"}


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.User = Depends(get_current_user)):
    return user
