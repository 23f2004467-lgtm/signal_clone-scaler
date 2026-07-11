"""Pydantic request/response models for the REST routes.

All *_In classes are request bodies; all *Out classes are response shapes.
Out models set from_attributes=True so ORM rows convert directly.
"""

from pydantic import BaseModel, ConfigDict, Field

# --- auth ---------------------------------------------------------------


class RegisterIn(BaseModel):
    phone: str = Field(min_length=3)
    username: str = Field(min_length=1)
    display_name: str = Field(min_length=1)


class LoginIn(BaseModel):
    phone_or_username: str = Field(min_length=1)


class VerifyOtpIn(BaseModel):
    phone_or_username: str = Field(min_length=1)
    otp: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    phone: str
    username: str
    display_name: str
    last_seen_at: str | None
    created_at: str


class AuthOut(BaseModel):
    token: str
    user: UserOut


class DetailOut(BaseModel):
    detail: str


# --- contacts -----------------------------------------------------------


class ContactAddIn(BaseModel):
    user_id: int


# --- conversations ------------------------------------------------------


class ConversationCreateIn(BaseModel):
    """Either a DM (peer_id) or a group (name + member_ids) -- the router
    rejects requests that provide neither."""

    peer_id: int | None = None
    name: str | None = None
    member_ids: list[int] | None = None


class MemberOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    # Presence is real: online <=> a live socket in ws.manager.active.
    is_online: bool
    # The two receipt pointers, exposed so the client can derive tick states.
    last_delivered_message_id: int
    last_read_message_id: int


class LastMessageOut(BaseModel):
    id: int
    sender_id: int
    body: str
    created_at: str


class ConversationOut(BaseModel):
    """One left-pane row: preview, unread badge, members, timestamps."""

    id: int
    type: str
    name: str | None
    created_at: str
    members: list[MemberOut]
    last_message: LastMessageOut | None
    unread_count: int


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    sender_id: int
    body: str
    reply_to_id: int | None
    client_id: str
    created_at: str


# --- groups -------------------------------------------------------------


class MemberAddIn(BaseModel):
    user_id: int


class RenameIn(BaseModel):
    name: str = Field(min_length=1)


class RenameOut(BaseModel):
    id: int
    name: str
