"""Contacts (a directed address book) + user search."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, queries, schemas
from app.db import get_db, utcnow_iso
from app.deps import get_current_user

router = APIRouter(prefix="/api", tags=["contacts"])


@router.get("/contacts", response_model=list[schemas.UserOut])
def list_contacts(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return queries.contacts_of(db, user.id)


@router.post("/contacts", response_model=schemas.UserOut, status_code=201)
def add_contact(
    body: schemas.ContactAddIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself as a contact")
    target = db.get(models.User, body.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if db.get(models.Contact, (user.id, body.user_id)) is not None:
        raise HTTPException(status_code=409, detail="Already in contacts")
    db.add(
        models.Contact(
            owner_id=user.id, contact_user_id=body.user_id, created_at=utcnow_iso()
        )
    )
    db.commit()
    return target


@router.get("/users/search", response_model=list[schemas.UserOut])
def search_users(
    q: str = Query(default=""),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not q.strip():
        return []
    return queries.search_users(db, q.strip(), exclude_user_id=user.id)
