"""Group management: add member, remove member, rename -- all admin-only."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import models, queries, schemas
from app.db import get_db, utcnow_iso
from app.deps import get_current_user

# Presence comes from the same in-memory registry the WS layer writes: same
# process = same memory = same dict (blueprint §2.3) -- so these REST handlers
# can also PUSH live group events through the shared manager (§5).
from app.ws import manager, push_from_rest

router = APIRouter(prefix="/api/conversations", tags=["groups"])


def _require_group_admin(
    db: Session, conversation_id: int, user: models.User
) -> models.Conversation:
    """The conversation must exist, be a group, include the caller as a
    member, and the caller must be its admin."""
    conversation = db.get(models.Conversation, conversation_id)
    membership = queries.get_membership(db, conversation_id, user.id)
    if conversation is None or membership is None:
        # 404, not 403: non-members must not learn the conversation exists.
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.type != "group":
        raise HTTPException(status_code=400, detail="Not a group conversation")
    if membership.role != "admin":
        raise HTTPException(status_code=403, detail="Only a group admin can do that")
    return conversation


@router.post("/{conversation_id}/members", response_model=schemas.MemberOut, status_code=201)
def add_member(
    conversation_id: int,
    body: schemas.MemberAddIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_group_admin(db, conversation_id, user)
    target = db.get(models.User, body.user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    if queries.get_membership(db, conversation_id, body.user_id) is not None:
        raise HTTPException(status_code=409, detail="Already a member")
    member = models.ConversationMember(
        conversation_id=conversation_id, user_id=body.user_id, joined_at=utcnow_iso()
    )
    db.add(member)
    db.commit()
    member_out = schemas.MemberOut(
        id=target.id,
        username=target.username,
        display_name=target.display_name,
        role=member.role,
        is_online=target.id in manager.active,
        last_delivered_message_id=member.last_delivered_message_id,
        last_read_message_id=member.last_read_message_id,
    )
    # Live push AFTER the commit (persist first, §2.4). member_ids_of re-reads
    # the table post-commit, so the fan-out list already INCLUDES the new
    # member -- their own client learns it was added and pulls the
    # conversation into its list.
    push_from_rest(
        queries.member_ids_of(db, conversation_id),
        {
            "type": "member.added",
            "conversation_id": conversation_id,
            "user": member_out.model_dump(),
        },
    )
    return member_out


@router.delete("/{conversation_id}/members/{user_id}", response_model=schemas.DetailOut)
def remove_member(
    conversation_id: int,
    user_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_group_admin(db, conversation_id, user)
    membership = queries.get_membership(db, conversation_id, user_id)
    if membership is None:
        raise HTTPException(status_code=404, detail="Not a member of this group")
    db.delete(membership)
    db.commit()
    # Fan out AFTER the commit so member_ids_of reads CURRENT membership --
    # the list no longer contains user_id, who is appended for this ONE frame
    # only (their client drops the conversation). They receive nothing
    # further: every WS fan-out re-derives its recipients per event from the
    # membership table (queries.member_ids_of / queries.get_membership in
    # ws.py's handlers), never from a cached list, so this DELETE silences
    # them everywhere at once.
    push_from_rest(
        queries.member_ids_of(db, conversation_id) + [user_id],
        {
            "type": "member.removed",
            "conversation_id": conversation_id,
            "user_id": user_id,
        },
    )
    return {"detail": "Member removed"}


@router.patch("/{conversation_id}", response_model=schemas.RenameOut)
def rename_group(
    conversation_id: int,
    body: schemas.RenameIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = _require_group_admin(db, conversation_id, user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Group name cannot be empty")
    conversation.name = name
    db.commit()
    # Live push after the commit: every online member's header and left-pane
    # row pick up the new name without a refetch.
    push_from_rest(
        queries.member_ids_of(db, conversation_id),
        {
            "type": "conversation.updated",
            "conversation_id": conversation.id,
            "name": conversation.name,
        },
    )
    return {"id": conversation.id, "name": conversation.name}
