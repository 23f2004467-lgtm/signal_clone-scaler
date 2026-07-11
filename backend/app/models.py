"""The six tables from blueprint §4, in SQLAlchemy 2.0 declarative style.

Plain FK columns only -- no relationship(), so every query in the codebase is
explicit and there is no hidden SQL at attribute-access time. All timestamps
are TEXT columns holding ISO-8601 UTC strings.
"""

from sqlalchemy import CheckConstraint, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    """Identity. Avatars are derived client-side (initials + color hash)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(unique=True)
    username: Mapped[str] = mapped_column(unique=True)
    display_name: Mapped[str]
    last_seen_at: Mapped[str | None]  # written on WS disconnect
    created_at: Mapped[str]


class Session(Base):
    """Mocked OTP still creates real sessions; one token lookup authenticates
    both REST (Authorization: Bearer) and the WS handshake (?token=)."""

    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str]


class Contact(Base):
    """A directed edge, like a phone address book -- me adding you does not
    add me to yours."""

    __tablename__ = "contacts"

    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    contact_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    created_at: Mapped[str]


class Conversation(Base):
    """Unified: a DM is just a 2-member conversation with no name. Messages FK
    one table regardless of type and every fan-out path is identical."""

    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("type IN ('direct','group')", name="ck_conversations_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str]
    name: Mapped[str | None]  # groups only; NULL for DMs
    # 'minUserId:maxUserId' for DMs; UNIQUE prevents duplicate DM pairs. NULL
    # for groups (SQLite UNIQUE ignores NULLs, so any number of groups is fine).
    dm_key: Mapped[str | None] = mapped_column(unique=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[str]


class ConversationMember(Base):
    """Membership + role, AND the entire receipts system in two integers:
    unread badge = COUNT(messages.id > last_read_message_id);
    'delivered to all' = MIN(other members' delivered pointers) >= message.id
    (same for read). No per-message receipts table."""

    __tablename__ = "conversation_members"
    __table_args__ = (
        CheckConstraint("role IN ('admin','member')", name="ck_conversation_members_role"),
    )

    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("conversations.id"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    role: Mapped[str] = mapped_column(default="member", server_default="member")
    last_delivered_message_id: Mapped[int] = mapped_column(default=0, server_default="0")  # receipt pointer #1
    last_read_message_id: Mapped[int] = mapped_column(default=0, server_default="0")  # receipt pointer #2
    joined_at: Mapped[str]


class Message(Base):
    """The source of truth. AUTOINCREMENT id + server timestamp define ordering
    -- never the client clock. UNIQUE(sender_id, client_id) makes a retry after
    reconnect idempotent (same client_id -> same row, no duplicate)."""

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("sender_id", "client_id", name="uq_messages_sender_client"),
        Index("ix_messages_conversation_id_id", "conversation_id", "id"),
        # True AUTOINCREMENT (not bare rowid): ids are monotonic and never
        # reused, which the before_id pagination cursor relies on.
        {"sqlite_autoincrement": True},
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"))
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str]
    reply_to_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id"))  # reply quotes; NULL otherwise
    client_id: Mapped[str]
    created_at: Mapped[str]
