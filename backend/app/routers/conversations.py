"""Conversations: the left-pane list, DM/group creation, paginated history."""

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import models, queries, schemas
from app.db import get_db, utcnow_iso
from app.deps import get_current_user

# REST reads the same in-memory registry the WS layer writes: same process =
# same memory = same dict (blueprint §2.3) -- the payoff of --workers 1.
# The same singleton lets group creation PUSH to the other members' sockets.
from app.ws import manager, push_from_rest

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


def _assemble(db: Session, rows) -> list[schemas.ConversationOut]:
    """Join the SQL aggregate rows with each conversation's member list."""
    conversation_ids = [row["conversation_id"] for row in rows]
    members_by_conversation: dict[int, list[schemas.MemberOut]] = defaultdict(list)
    for member, member_user in queries.members_of_conversations(db, conversation_ids):
        members_by_conversation[member.conversation_id].append(
            schemas.MemberOut(
                id=member_user.id,
                username=member_user.username,
                display_name=member_user.display_name,
                role=member.role,
                is_online=member_user.id in manager.active,
                last_delivered_message_id=member.last_delivered_message_id,
                last_read_message_id=member.last_read_message_id,
            )
        )
    items = []
    for row in rows:
        last_message = None
        if row["last_message_id"] is not None:
            last_message = schemas.LastMessageOut(
                id=row["last_message_id"],
                sender_id=row["last_message_sender_id"],
                body=row["last_message_body"],
                created_at=row["last_message_created_at"],
            )
        items.append(
            schemas.ConversationOut(
                id=row["conversation_id"],
                type=row["type"],
                name=row["name"],
                created_at=row["created_at"],
                members=members_by_conversation[row["conversation_id"]],
                last_message=last_message,
                unread_count=row["unread_count"],
            )
        )
    return items


def _one_conversation(db: Session, user_id: int, conversation_id: int) -> schemas.ConversationOut:
    rows = queries.conversation_rows_for_user(db, user_id, conversation_id=conversation_id)
    return _assemble(db, rows)[0]


@router.get("", response_model=list[schemas.ConversationOut])
def list_conversations(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The big left-pane payload: per conversation, the last-message preview,
    unread count, members, and timestamps -- most recently active first."""
    rows = queries.conversation_rows_for_user(db, user.id)
    return _assemble(db, rows)


@router.post("", response_model=schemas.ConversationOut)
def create_conversation(
    body: schemas.ConversationCreateIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """DM when peer_id is given (deduplicated on dm_key -- creating the same
    DM twice returns the existing one); group when name + member_ids are."""
    if body.peer_id is not None:
        return _create_dm(db, user, body.peer_id)
    if body.name is not None and body.member_ids:
        return _create_group(db, user, body.name, body.member_ids)
    raise HTTPException(
        status_code=422,
        detail="Provide peer_id for a DM, or name + member_ids for a group",
    )


def _create_dm(db: Session, user: models.User, peer_id: int) -> schemas.ConversationOut:
    if peer_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot start a DM with yourself")
    peer = db.get(models.User, peer_id)
    if peer is None:
        raise HTTPException(status_code=404, detail="User not found")
    key = queries.dm_key(user.id, peer_id)
    existing = queries.find_dm(db, key)
    if existing is not None:
        return _one_conversation(db, user.id, existing.id)
    now = utcnow_iso()
    conversation = models.Conversation(
        type="direct", name=None, dm_key=key, created_by=user.id, created_at=now
    )
    db.add(conversation)
    db.flush()  # assigns conversation.id for the member rows below
    for member_id in (user.id, peer_id):
        db.add(
            models.ConversationMember(
                conversation_id=conversation.id, user_id=member_id, joined_at=now
            )
        )
    db.commit()
    payload = _one_conversation(db, user.id, conversation.id)
    # Live push AFTER the commit (persist first, §2.4): the peer's left pane
    # gains the new DM without a refetch. Without this frame an online peer
    # would silently miss the first messages — the client drops message.new
    # for a conversation it doesn't have a row for yet. The one per-user field
    # in the payload is unread_count, and a brand-new DM has no messages, so
    # it is 0 for both sides — the creator's payload is safe to send as-is.
    # (Only on CREATE: re-opening an existing DM returns early above.)
    push_from_rest(
        [peer_id],
        {"type": "conversation.created", "conversation": payload.model_dump()},
    )
    return payload


def _create_group(
    db: Session, user: models.User, name: str, member_ids: list[int]
) -> schemas.ConversationOut:
    name = name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Group name cannot be empty")
    other_ids = sorted(set(member_ids) - {user.id})
    if not other_ids:
        raise HTTPException(status_code=422, detail="A group needs at least one other member")
    for member_id in other_ids:
        if db.get(models.User, member_id) is None:
            raise HTTPException(status_code=404, detail=f"User {member_id} not found")
    now = utcnow_iso()
    conversation = models.Conversation(
        type="group", name=name, dm_key=None, created_by=user.id, created_at=now
    )
    db.add(conversation)
    db.flush()
    db.add(  # the creator is the admin
        models.ConversationMember(
            conversation_id=conversation.id, user_id=user.id, role="admin", joined_at=now
        )
    )
    for member_id in other_ids:
        db.add(
            models.ConversationMember(
                conversation_id=conversation.id, user_id=member_id, joined_at=now
            )
        )
    db.commit()
    payload = _one_conversation(db, user.id, conversation.id)
    # Live push AFTER the commit: the OTHER members' left panes gain the new
    # group without a refetch (the creator already gets it as this response).
    # The one per-user field in the payload is unread_count, and a brand-new
    # group has no messages, so it is 0 for every member -- the creator's
    # payload is safe to send to all of them.
    push_from_rest(
        other_ids,
        {"type": "conversation.created", "conversation": payload.model_dump()},
    )
    return payload


@router.get("/{conversation_id}/messages", response_model=list[schemas.MessageOut])
def get_messages(
    conversation_id: int,
    before_id: int | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Paginated history on the AUTOINCREMENT id, oldest-first within the page.
    First page: no before_id. Older pages: before_id = oldest loaded id."""
    if queries.get_membership(db, conversation_id, user.id) is None:
        # 404, not 403: non-members must not learn the conversation exists.
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = queries.message_page(db, conversation_id, before_id, limit)
    # One extra query for the whole page: the compact reply_to summaries for
    # every reply in it, so the client can render quote blocks even when the
    # quoted original falls outside this page.
    summaries = queries.reply_summaries(
        db, [m.reply_to_id for m in messages if m.reply_to_id is not None]
    )
    items = []
    for m in messages:
        item = schemas.MessageOut.model_validate(m)
        if m.reply_to_id in summaries:
            item.reply_to = schemas.ReplyToOut(**summaries[m.reply_to_id])
        items.append(item)
    return items
