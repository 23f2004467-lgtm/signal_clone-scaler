"""Idempotent demo seed: 6 users, several DMs, one group, staggered history.

Runs on EVERY startup (from the lifespan handler) because the free-tier disk
is ephemeral -- a cold start must boot into a demo-ready state, not an empty
one. seed_if_empty checks the users count first, so a warm restart with data
already present is a no-op.

Every user logs in with the fixed OTP 123456. The receipt pointers are set to
different depths per member so unread badges and tick states differ visibly
across conversations from the first login.
"""

import itertools
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import queries
from app.db import SessionLocal
from app.models import Contact, Conversation, ConversationMember, Message, User

_client_ids = itertools.count(1)  # seed messages need unique (sender, client_id)


def _ago(days: int = 0, hours: int = 0, minutes: int = 0) -> str:
    """ISO-8601 UTC string this long before 'now' -- always in the past, so
    previews look like a lived-in app no matter when the server booted."""
    moment = datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=minutes)
    return moment.isoformat(timespec="seconds")


def _user(db: Session, phone: str, username: str, display_name: str, created: str) -> User:
    user = User(phone=phone, username=username, display_name=display_name, created_at=created)
    db.add(user)
    db.flush()  # flush assigns the AUTOINCREMENT id without committing
    return user


def _dm(db: Session, a: User, b: User, created: str) -> Conversation:
    conversation = Conversation(
        type="direct",
        name=None,
        dm_key=queries.dm_key(a.id, b.id),  # the one canonical derivation
        created_by=a.id,
        created_at=created,
    )
    db.add(conversation)
    db.flush()
    for user in (a, b):
        db.add(
            ConversationMember(
                conversation_id=conversation.id, user_id=user.id, joined_at=created
            )
        )
    return conversation


def _group(db: Session, name: str, admin: User, members: list[User], created: str) -> Conversation:
    conversation = Conversation(
        type="group", name=name, dm_key=None, created_by=admin.id, created_at=created
    )
    db.add(conversation)
    db.flush()
    db.add(
        ConversationMember(
            conversation_id=conversation.id, user_id=admin.id, role="admin", joined_at=created
        )
    )
    for user in members:
        db.add(
            ConversationMember(
                conversation_id=conversation.id, user_id=user.id, joined_at=created
            )
        )
    return conversation


def _say(db: Session, conversation: Conversation, sender: User, body: str, when: str) -> Message:
    message = Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=body,
        client_id=f"seed-{next(_client_ids)}",
        created_at=when,
    )
    db.add(message)
    db.flush()
    return message


def _pointers(db: Session, conversation: Conversation, user: User, delivered: Message, read: Message) -> None:
    """Set one member's two receipt pointers to specific messages."""
    membership = db.get(ConversationMember, (conversation.id, user.id))
    membership.last_delivered_message_id = delivered.id
    membership.last_read_message_id = read.id


def seed_if_empty() -> None:
    with SessionLocal() as db:
        user_count = db.execute(select(func.count()).select_from(User)).scalar_one()
        if user_count > 0:
            return
        _seed(db)
        db.commit()


def _seed(db: Session) -> None:
    # --- users (all log in with OTP 123456) -----------------------------
    alice = _user(db, "+15550000001", "alice", "Alice Chen", _ago(days=45))
    bob = _user(db, "+15550000002", "bob", "Bob Martinez", _ago(days=44))
    carol = _user(db, "+15550000003", "carol", "Carol Okafor", _ago(days=40))
    david = _user(db, "+15550000004", "david", "David Kim", _ago(days=38))
    erin = _user(db, "+15550000005", "erin", "Erin Patel", _ago(days=30))
    frank = _user(db, "+15550000006", "frank", "Frank Nguyen", _ago(days=21))

    # --- contacts (directed edges, like a phone address book) -----------
    address_books = {
        alice: [bob, carol, david, erin],
        bob: [alice, david, frank],
        carol: [alice, erin],
        david: [alice, bob],
        erin: [alice, carol],
        frank: [bob],
    }
    for owner, entries in address_books.items():
        for entry in entries:
            db.add(
                Contact(
                    owner_id=owner.id,
                    contact_user_id=entry.id,
                    created_at=_ago(days=20),
                )
            )

    # --- DM: Alice <-> Bob -- Alice has 2 unread; her sends are fully read
    ab = _dm(db, alice, bob, _ago(days=3, hours=4))
    _say(db, ab, alice, "Hey Bob! Did you end up trying that ramen place?", _ago(days=3, hours=3))
    _say(db, ab, bob, "Yes!! The tonkotsu was unreal. Going back Friday if you want in", _ago(days=3, hours=2, minutes=40))
    _say(db, ab, alice, "Count me in", _ago(days=3, hours=2, minutes=35))
    _say(db, ab, bob, "Reminder: Friday 7pm. Booking's under my name", _ago(days=1, hours=6))
    ab5 = _say(db, ab, alice, "Perfect, see you there", _ago(days=1, hours=5, minutes=50))
    _say(db, ab, bob, "Running 10 min late, grab the table if you're first", _ago(hours=2))
    ab7 = _say(db, ab, bob, "Also they moved us to 7:30, just checked the app", _ago(hours=1, minutes=45))
    _pointers(db, ab, bob, delivered=ab7, read=ab7)    # Bob is caught up -> Alice's ticks are blue
    _pointers(db, ab, alice, delivered=ab7, read=ab5)  # Alice hasn't read Bob's last 2 -> badge: 2

    # --- DM: Alice <-> Carol -- delivered-but-unread: grey double tick ---
    ac = _dm(db, alice, carol, _ago(days=2, hours=9))
    _say(db, ac, carol, "Alice do you still have my copy of Project Hail Mary?", _ago(days=2, hours=8))
    _say(db, ac, alice, "Guilty. Bringing it Saturday, promise", _ago(days=2, hours=7, minutes=30))
    ac3 = _say(db, ac, carol, "No rush! Just lining up my next read", _ago(days=2, hours=7))
    ac4 = _say(db, ac, alice, "Found it! It was under a pile of conference swag", _ago(hours=5))
    _pointers(db, ac, alice, delivered=ac4, read=ac4)  # Alice caught up -> badge: 0
    _pointers(db, ac, carol, delivered=ac4, read=ac3)  # Carol got but hasn't read ac4 -> grey double

    # --- DM: Bob <-> David -- undelivered latest: single grey tick -------
    bd = _dm(db, bob, david, _ago(days=4, hours=8))
    _say(db, bd, bob, "Yo, fantasy draft is Sunday 6pm", _ago(days=4, hours=7))
    _say(db, bd, david, "I'll be there. Drafting kickers early again", _ago(days=4, hours=6, minutes=30))
    bd3 = _say(db, bd, bob, "That was ONE year. One!", _ago(days=4, hours=6))
    bd4 = _say(db, bd, david, "Have you set your keeper list yet?", _ago(minutes=30))
    _pointers(db, bd, david, delivered=bd4, read=bd4)  # David caught up
    _pointers(db, bd, bob, delivered=bd3, read=bd3)    # bd4 not yet delivered to Bob -> single grey; badge: 1

    # --- DM: Alice <-> Erin -- old, fully read, sorts to the bottom ------
    ae = _dm(db, alice, erin, _ago(days=6, hours=10))
    _say(db, ae, erin, "It was so good to catch up at Priya's wedding!", _ago(days=6, hours=9))
    _say(db, ae, alice, "Right?? Let's not wait another two years this time", _ago(days=6, hours=8, minutes=45))
    _say(db, ae, erin, "Deal. Coffee when you're back from Denver?", _ago(days=6, hours=8, minutes=30))
    ae4 = _say(db, ae, alice, "Deal", _ago(days=6, hours=8))
    _pointers(db, ae, alice, delivered=ae4, read=ae4)
    _pointers(db, ae, erin, delivered=ae4, read=ae4)

    # --- Group: Weekend Trip (Alice admin) -- every member at a different
    # depth, so the group shows mixed ticks and different badges per login
    wt = _group(db, "Weekend Trip", alice, [bob, carol, david], _ago(days=5, hours=6))
    _say(db, wt, alice, "Ok! Cabin is booked for the 26th-28th", _ago(days=5, hours=5))
    _say(db, wt, bob, "Legend. I'll cover firewood and snacks", _ago(days=5, hours=4, minutes=30))
    _say(db, wt, carol, "Calling the window bed now, sorry not sorry", _ago(days=5, hours=4))
    _say(db, wt, david, "I can drive up to 4 people, leaving Friday 4pm", _ago(days=4, hours=9))
    _say(db, wt, alice, "David you're a hero. Carol, you riding with him?", _ago(days=4, hours=8, minutes=30))
    wt6 = _say(db, wt, carol, "Yep works for me", _ago(days=4, hours=8))
    wt7 = _say(db, wt, bob, "Weather says clear skies all weekend", _ago(hours=3))
    wt8 = _say(db, wt, alice, "Don't forget headlamps, the trail back gets dark", _ago(minutes=20))
    _pointers(db, wt, alice, delivered=wt8, read=wt8)  # sender of the latest; badge: 0
    _pointers(db, wt, bob, delivered=wt8, read=wt7)    # has wt8, hasn't read it; badge: 1
    _pointers(db, wt, carol, delivered=wt7, read=wt6)  # two behind on reads; badge: 2
    _pointers(db, wt, david, delivered=wt6, read=wt6)  # offline since wt6; badge: 2
