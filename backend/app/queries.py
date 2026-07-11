"""Every nontrivial query, each as a small named function.

Simple lookups use 2.0-style select(); the hardest queries -- the left-pane
conversation list with last-message preview and unread counts, and the bulk
delivered-pointer advance -- stay as hand-written, parameterized text() SQL
so the schema design is visible in one place (blueprint §4).
"""

from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.models import Contact, Conversation, ConversationMember, Message, User

# The left-pane query. One row per conversation the user belongs to, carrying:
#   - the newest message via LEFT JOIN on MAX(id) -- AUTOINCREMENT ids ARE the
#     ordering, so "latest" never consults timestamps
#   - unread count = messages newer than MY last_read pointer; my own sends are
#     never unread, hence the sender_id <> :user_id filter
# :conversation_id is normally NULL (all conversations); pass an id to get the
# same row shape for a single conversation (used after POST /conversations).
_CONVERSATION_LIST_SQL = text(
    """
    SELECT
        c.id          AS conversation_id,
        c.type        AS type,
        c.name        AS name,
        c.created_at  AS created_at,
        lm.id         AS last_message_id,
        lm.sender_id  AS last_message_sender_id,
        lm.body       AS last_message_body,
        lm.created_at AS last_message_created_at,
        (
            SELECT COUNT(*)
            FROM messages m
            WHERE m.conversation_id = c.id
              AND m.id > me.last_read_message_id
              AND m.sender_id <> :user_id
        )             AS unread_count
    FROM conversation_members me
    JOIN conversations c
      ON c.id = me.conversation_id
    LEFT JOIN messages lm
      ON lm.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversation_id = c.id)
    WHERE me.user_id = :user_id
      AND (:conversation_id IS NULL OR c.id = :conversation_id)
    ORDER BY COALESCE(lm.created_at, c.created_at) DESC
    """
)


def conversation_rows_for_user(
    db: Session, user_id: int, conversation_id: int | None = None
):
    """Left-pane rows (dict-like mappings), most recently active first."""
    params = {"user_id": user_id, "conversation_id": conversation_id}
    return db.execute(_CONVERSATION_LIST_SQL, params).mappings().all()


def members_of_conversations(db: Session, conversation_ids: list[int]):
    """(ConversationMember, User) pairs for every given conversation."""
    if not conversation_ids:
        return []
    stmt = (
        select(ConversationMember, User)
        .join(User, User.id == ConversationMember.user_id)
        .where(ConversationMember.conversation_id.in_(conversation_ids))
        .order_by(
            ConversationMember.conversation_id,
            ConversationMember.joined_at,
            User.id,
        )
    )
    return db.execute(stmt).all()


def get_membership(
    db: Session, conversation_id: int, user_id: int
) -> ConversationMember | None:
    """Primary-key lookup on (conversation_id, user_id)."""
    return db.get(ConversationMember, (conversation_id, user_id))


def member_ids_of(db: Session, conversation_id: int) -> list[int]:
    """Just the user ids of one conversation's members (the WS fan-out list)."""
    stmt = select(ConversationMember.user_id).where(
        ConversationMember.conversation_id == conversation_id
    )
    return list(db.execute(stmt).scalars().all())


def message_by_client_id(db: Session, sender_id: int, client_id: str) -> Message | None:
    """The idempotent-retry lookup: UNIQUE(sender_id, client_id) guarantees at
    most one row, so a resent message.send re-acks the original row."""
    stmt = select(Message).where(
        Message.sender_id == sender_id, Message.client_id == client_id
    )
    return db.execute(stmt).scalar_one_or_none()


# Connect-time delivered catch-up (blueprint §2.5/§6): everything persisted
# while a user was offline becomes "delivered" the moment their socket opens,
# so one UPDATE advances the pointer on every membership row. The outer MAX()
# is SQLite's two-argument scalar max -- it keeps the pointer monotonic (§6:
# states never move backwards); the inner MAX(m.id) is the aggregate "newest
# message in this conversation"; COALESCE covers conversations with no
# messages yet.
_ADVANCE_DELIVERED_SQL = text(
    """
    UPDATE conversation_members
    SET last_delivered_message_id = MAX(
        last_delivered_message_id,
        COALESCE(
            (
                SELECT MAX(m.id)
                FROM messages m
                WHERE m.conversation_id = conversation_members.conversation_id
            ),
            0
        )
    )
    WHERE user_id = :user_id
    """
)


def advance_delivered_pointers(db: Session, user_id: int) -> None:
    """Bulk-advance the user's delivered pointer in every conversation they
    belong to. The caller commits."""
    db.execute(_ADVANCE_DELIVERED_SQL, {"user_id": user_id})


# The snapshot taken right BEFORE the bulk advance above: which conversations
# is this user behind in, and what id will the pointer land on? The senders in
# those conversations are the ones awaiting receipt.delivered ticks, so the
# connect handler fans the (conversation_id, newest_message_id) pairs out to
# them after the UPDATE commits. The subquery is repeated in the WHERE because
# standard SQL cannot reference a result-column alias there.
_UNDELIVERED_SQL = text(
    """
    SELECT
        cm.conversation_id AS conversation_id,
        (
            SELECT MAX(m.id)
            FROM messages m
            WHERE m.conversation_id = cm.conversation_id
        )                  AS newest_message_id
    FROM conversation_members cm
    WHERE cm.user_id = :user_id
      AND (
            SELECT COALESCE(MAX(m.id), 0)
            FROM messages m
            WHERE m.conversation_id = cm.conversation_id
          ) > cm.last_delivered_message_id
    """
)


def undelivered_conversations(db: Session, user_id: int):
    """(conversation_id, newest_message_id) mappings for every conversation
    where the user's delivered pointer is behind the newest message."""
    return db.execute(_UNDELIVERED_SQL, {"user_id": user_id}).mappings().all()


# Push-time delivered advance (§6 sent->delivered): one member, one
# conversation, right after message.new was pushed to their live socket.
# MAX() is SQLite's two-argument scalar max -- the pointer never moves
# backwards, so a stale frame can never regress a tick.
_ADVANCE_MEMBER_DELIVERED_SQL = text(
    """
    UPDATE conversation_members
    SET last_delivered_message_id = MAX(last_delivered_message_id, :message_id)
    WHERE conversation_id = :conversation_id
      AND user_id = :user_id
    """
)


def advance_member_delivered(
    db: Session, conversation_id: int, user_id: int, message_id: int
) -> None:
    """Advance ONE member's delivered pointer to message_id (monotonic).
    The caller commits."""
    db.execute(
        _ADVANCE_MEMBER_DELIVERED_SQL,
        {"conversation_id": conversation_id, "user_id": user_id, "message_id": message_id},
    )


# Read advance (§6 delivered->read). Both SET clauses see the OLD column
# values (standard UPDATE semantics), and both use monotonic MAX(): reading a
# message implies it was delivered, so advancing the delivered pointer in the
# same statement preserves the last_delivered >= last_read invariant even if
# the read frame arrives before the delivered bookkeeping did.
_ADVANCE_MEMBER_READ_SQL = text(
    """
    UPDATE conversation_members
    SET last_read_message_id      = MAX(last_read_message_id, :message_id),
        last_delivered_message_id = MAX(last_delivered_message_id, :message_id)
    WHERE conversation_id = :conversation_id
      AND user_id = :user_id
    """
)


def advance_member_read(
    db: Session, conversation_id: int, user_id: int, message_id: int
) -> None:
    """Advance ONE member's read pointer (and, by implication, their delivered
    pointer) to message_id -- both monotonic. The caller commits."""
    db.execute(
        _ADVANCE_MEMBER_READ_SQL,
        {"conversation_id": conversation_id, "user_id": user_id, "message_id": message_id},
    )


def message_page(
    db: Session, conversation_id: int, before_id: int | None, limit: int
) -> list[Message]:
    """One page of history, paginated on the AUTOINCREMENT id: fetch the
    `limit` newest rows older than `before_id`, then reverse so the caller
    gets chronological order for rendering."""
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)
    stmt = stmt.order_by(Message.id.desc()).limit(limit)
    newest_first = db.execute(stmt).scalars().all()
    return list(reversed(newest_first))


def dm_key(user_a_id: int, user_b_id: int) -> str:
    """'minUserId:maxUserId' -- order-independent, so the UNIQUE constraint
    on conversations.dm_key prevents duplicate DM pairs."""
    low, high = sorted((user_a_id, user_b_id))
    return f"{low}:{high}"


def find_dm(db: Session, key: str) -> Conversation | None:
    stmt = select(Conversation).where(Conversation.dm_key == key)
    return db.execute(stmt).scalar_one_or_none()


def user_by_phone_or_username(db: Session, value: str) -> User | None:
    stmt = select(User).where(or_(User.phone == value, User.username == value))
    return db.execute(stmt).scalar_one_or_none()


def search_users(db: Session, q: str, exclude_user_id: int, limit: int = 20) -> list[User]:
    """Substring match on username / display name / phone, excluding myself.
    LIKE with a bound parameter -- the pattern is data, never SQL."""
    pattern = f"%{q}%"
    stmt = (
        select(User)
        .where(
            or_(
                User.username.like(pattern),
                User.display_name.like(pattern),
                User.phone.like(pattern),
            )
        )
        .where(User.id != exclude_user_id)
        .order_by(User.username)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all())


def contacts_of(db: Session, owner_id: int) -> list[User]:
    """The users this owner has added, as User rows (join through contacts)."""
    stmt = (
        select(User)
        .join(Contact, Contact.contact_user_id == User.id)
        .where(Contact.owner_id == owner_id)
        .order_by(User.display_name)
    )
    return list(db.execute(stmt).scalars().all())
