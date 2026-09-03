"""Iteration 14: Splits/Groups feature — settled_through cutoff + friend history endpoint.

Scope (backend only):
A) Settled-through mechanics
   - Split expense $100 → A owes 50; POST settlement $50 → 0.00 AND friends.find_one has
     settled_through populated (ISO timestamp).
   - Post-settlement split $60 → A owes 30 (not 80). Earlier $100 stays closed.
   - Directly insert a pre-settlement expense (10s before cutoff) → excluded from balances.
   - Settlement itself (created_at == settled_through) does NOT double-count against balance.

B) Friend history endpoint /api/friends/{friend_id}/history
   - Timeline contains BOTH pre-settlement expenses (settled=True) and post-settlement (settled=False).
   - Settlement appears as type="settlement" with correct home_amount.
   - net_home matches GET /api/balances amount for the friend.
   - Unknown friend_id → 404.
   - Friend belonging to a different user → 404.
   - Timeline is sorted newest-first.
   - friend object contains {friend_id, name, email, settled_through}.
   - currency == user's home currency.
"""
from __future__ import annotations

import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests


# ------------------- helpers -------------------
def _cleanup_user_data(mongo, uid):
    mongo.expenses.delete_many({"user_id": uid})
    mongo.friends.delete_many({"user_id": uid})
    mongo.groups.delete_many({"user_id": uid})
    mongo.settlements.delete_many({"user_id": uid})
    mongo.recurring.delete_many({"user_id": uid})


@pytest.fixture(scope="class")
def iso_user(mongo, request):
    tag = request.cls.__name__ if request.cls else "anon"
    uid = f"user_test_{tag[:8]}_{uuid.uuid4().hex[:8]}"
    tok = f"tok_{tag[:8]}_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@example.com",
        "name": f"TEST {tag}", "currency": "USD",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    yield s, uid
    _cleanup_user_data(mongo, uid)
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})


@pytest.fixture
def fresh_iso_user(mongo):
    """Function-scoped fully isolated user to avoid cross-test state within class."""
    uid = f"user_test_fr_{uuid.uuid4().hex[:8]}"
    tok = f"tok_fr_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@example.com",
        "name": "TEST Fresh", "currency": "USD",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    yield s, uid
    _cleanup_user_data(mongo, uid)
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})


# ======================================================
# A) Settled-through mechanics
# ======================================================
class TestSettledThroughMechanics:
    def test_settlement_populates_settled_through_and_zeroes_balance(self, fresh_iso_user, base_url, mongo):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_A"}).json()["friend_id"]
        # Split $100 with A → A owes 50
        r = client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        assert r.status_code == 200
        b = client.get(f"{base_url}/api/balances").json()
        row = next(f for f in b["friends"] if f["friend_id"] == fid)
        assert row["amount"] == 50.0

        # Settle $50 → balance 0.0
        s = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD",
        })
        assert s.status_code == 200, s.text
        b2 = client.get(f"{base_url}/api/balances").json()
        row2 = next(f for f in b2["friends"] if f["friend_id"] == fid)
        assert row2["amount"] == 0.0

        # Direct DB check — friend.settled_through populated
        friend_doc = mongo.friends.find_one({"friend_id": fid, "user_id": uid})
        assert friend_doc is not None
        st = friend_doc.get("settled_through")
        assert st is not None and isinstance(st, str) and len(st) > 0
        # ISO parseable
        parsed = datetime.fromisoformat(st)
        assert parsed is not None

    def test_post_settlement_expense_still_counts(self, fresh_iso_user, base_url):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_A2"}).json()["friend_id"]
        # Pre-settlement expense $100 (A owes 50)
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        # Settle $50 (closes at now)
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD",
        })
        # Sleep 1s so post-settlement expense created_at > settled_through
        time.sleep(1.1)
        # New expense $60 AFTER settlement → A owes 30
        client.post(f"{base_url}/api/expenses", json={
            "amount": 60.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        b = client.get(f"{base_url}/api/balances").json()
        row = next(f for f in b["friends"] if f["friend_id"] == fid)
        assert row["amount"] == 30.0, (
            f"expected 30.0 (only post-settlement expense counts), got {row['amount']}"
        )

    def test_pre_settlement_expense_excluded_from_balance(self, fresh_iso_user, base_url, mongo):
        """Directly insert an expense dated 10s BEFORE the cutoff and confirm it's excluded."""
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_A3"}).json()["friend_id"]
        # Baseline: $100 split → A owes 50, settle 50 → 0
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        s = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD",
        }).json()
        cutoff_iso = s["created_at"]
        cutoff_dt = datetime.fromisoformat(cutoff_iso)
        # Direct insert of an expense dated BEFORE cutoff — should be excluded
        older_dt = cutoff_dt - timedelta(seconds=10)
        older_iso = older_dt.isoformat()
        mongo.expenses.insert_one({
            "expense_id": f"exp_fake_{uuid.uuid4().hex[:8]}",
            "user_id": uid,
            "amount": 200.0,
            "currency": "USD",
            "category": "Food",
            "merchant": "TEST_Old",
            "notes": None,
            "date": older_iso,
            "created_at": older_iso,
            "is_split": True,
            "split_with": [fid],
            "shares": None,
            "group_id": None,
            "has_receipt": False,
        })
        b = client.get(f"{base_url}/api/balances").json()
        row = next(f for f in b["friends"] if f["friend_id"] == fid)
        # Balance must still be 0.0 — old expense excluded by cutoff
        assert row["amount"] == 0.0, (
            f"expected 0.0 (pre-cutoff expense excluded), got {row['amount']}"
        )

    def test_settlement_itself_not_double_counted(self, fresh_iso_user, base_url):
        """The settlement (created_at == settled_through) must NOT subtract from balance
        (otherwise A would go negative). Its own settlement doc should be filtered by
        the cutoff (s_dt <= cutoff) in /api/balances."""
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_A4"}).json()["friend_id"]
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD",
        })
        # After settlement, add another split $40 (A owes 20)
        time.sleep(1.1)
        client.post(f"{base_url}/api/expenses", json={
            "amount": 40.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        b = client.get(f"{base_url}/api/balances").json()
        row = next(f for f in b["friends"] if f["friend_id"] == fid)
        # If settlement were double-counted (subtracted again), we'd see -30 (20-50).
        # If pre-cutoff expense were double-counted, we'd see 70. Correct is 20.
        assert row["amount"] == 20.0, f"expected 20.0, got {row['amount']}"


# ======================================================
# B) Friend history endpoint
# ======================================================
class TestFriendHistory:
    def test_unknown_friend_404(self, iso_user, base_url):
        client, uid = iso_user
        r = client.get(f"{base_url}/api/friends/frd_does_not_exist/history")
        assert r.status_code == 404

    def test_cross_user_friend_404(self, mongo, base_url):
        # user1 owns friend
        uid1 = f"user_test_x1_{uuid.uuid4().hex[:8]}"
        tok1 = f"tok_x1_{uuid.uuid4().hex}"
        uid2 = f"user_test_x2_{uuid.uuid4().hex[:8]}"
        tok2 = f"tok_x2_{uuid.uuid4().hex}"
        try:
            for uid, tok in [(uid1, tok1), (uid2, tok2)]:
                mongo.users.insert_one({
                    "user_id": uid, "email": f"TEST_{uid}@example.com",
                    "name": "X", "currency": "USD",
                    "created_at": datetime.now(timezone.utc).isoformat(),
                })
                mongo.user_sessions.insert_one({
                    "session_token": tok, "user_id": uid,
                    "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                    "created_at": datetime.now(timezone.utc),
                })
            s1 = requests.Session()
            s1.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok1}"})
            s2 = requests.Session()
            s2.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok2}"})
            fid = s1.post(f"{base_url}/api/friends", json={"name": "TEST_Cross"}).json()["friend_id"]
            # user2 tries to read user1's friend history
            r = s2.get(f"{base_url}/api/friends/{fid}/history")
            assert r.status_code == 404
        finally:
            for uid in (uid1, uid2):
                _cleanup_user_data(mongo, uid)
                mongo.users.delete_many({"user_id": uid})
                mongo.user_sessions.delete_many({"user_id": uid})

    def test_history_end_to_end(self, fresh_iso_user, base_url):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={
            "name": "TEST_Hist", "email": "hist@e.co",
        }).json()["friend_id"]

        # Pre-settlement expense $100
        e1 = client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food",
            "merchant": "TEST_Merch1", "notes": "n1", "split_with": [fid],
        }).json()
        # Settle $50 (closes)
        s1 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD", "note": "TEST_note",
        }).json()
        # Post-settlement expense $60
        time.sleep(1.1)
        e2 = client.post(f"{base_url}/api/expenses", json={
            "amount": 60.0, "currency": "USD", "category": "Food",
            "merchant": "TEST_Merch2", "split_with": [fid],
        }).json()

        r = client.get(f"{base_url}/api/friends/{fid}/history")
        assert r.status_code == 200, r.text
        d = r.json()

        # friend object
        assert d["friend"]["friend_id"] == fid
        assert d["friend"]["name"] == "TEST_Hist"
        assert d["friend"]["email"] == "hist@e.co"
        assert d["friend"]["settled_through"] is not None

        # currency
        assert d["currency"] == "USD"

        # net_home matches /api/balances
        b = client.get(f"{base_url}/api/balances").json()
        row = next(f for f in b["friends"] if f["friend_id"] == fid)
        assert d["net_home"] == row["amount"], (
            f"net_home {d['net_home']} != balances amount {row['amount']}"
        )
        # Sanity: only e2 counts (30) since e1 and s1 are before cutoff
        assert d["net_home"] == 30.0

        # timeline: 3 items (e1, s1, e2), sorted newest first
        tl = d["timeline"]
        assert len(tl) == 3
        ids = [x["id"] for x in tl]
        assert ids[0] == e2["expense_id"], "newest first ordering broken"
        # s1 and e1 are older; make sure they appear
        assert s1["settlement_id"] in ids
        assert e1["expense_id"] in ids

        # Types & flags
        by_id = {x["id"]: x for x in tl}
        assert by_id[e1["expense_id"]]["type"] == "expense"
        assert by_id[e1["expense_id"]]["settled"] is True
        assert by_id[e1["expense_id"]]["friend_share"] == 50.0
        assert by_id[e1["expense_id"]]["home_amount"] == 50.0
        assert by_id[e1["expense_id"]]["merchant"] == "TEST_Merch1"
        assert by_id[e1["expense_id"]]["category"] == "Food"
        assert by_id[e1["expense_id"]]["notes"] == "n1"
        assert by_id[e1["expense_id"]]["currency"] == "USD"

        assert by_id[s1["settlement_id"]]["type"] == "settlement"
        assert by_id[s1["settlement_id"]]["settled"] is True
        assert by_id[s1["settlement_id"]]["home_amount"] == 50.0
        assert by_id[s1["settlement_id"]]["note"] == "TEST_note"
        assert by_id[s1["settlement_id"]]["amount"] == 50.0
        assert by_id[s1["settlement_id"]]["currency"] == "USD"

        assert by_id[e2["expense_id"]]["type"] == "expense"
        assert by_id[e2["expense_id"]]["settled"] is False
        assert by_id[e2["expense_id"]]["friend_share"] == 30.0
        assert by_id[e2["expense_id"]]["home_amount"] == 30.0

    def test_history_empty_for_new_friend(self, fresh_iso_user, base_url):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_EmptyHist"}).json()["friend_id"]
        r = client.get(f"{base_url}/api/friends/{fid}/history")
        assert r.status_code == 200
        d = r.json()
        assert d["friend"]["settled_through"] is None
        assert d["net_home"] == 0.0
        assert d["timeline"] == []
        assert d["currency"] == "USD"

    def test_history_shares_path(self, fresh_iso_user, base_url):
        """Custom shares should compute friend_share correctly in history too."""
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_Shares"}).json()["friend_id"]
        # self:60 / friend:40 on $100 → friend_share=40
        e = client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food",
            "shares": [
                {"participant_id": "self", "share": 60},
                {"participant_id": fid, "share": 40},
            ],
        }).json()
        r = client.get(f"{base_url}/api/friends/{fid}/history")
        assert r.status_code == 200
        d = r.json()
        row = next(x for x in d["timeline"] if x["id"] == e["expense_id"])
        assert row["type"] == "expense"
        assert row["friend_share"] == 40.0
        assert row["home_amount"] == 40.0
        assert row["settled"] is False
        assert d["net_home"] == 40.0
