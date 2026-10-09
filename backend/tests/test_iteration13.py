"""Iteration 13: Focused regression on POST /api/expenses across ALL payload
shapes the mobile app sends after the 'Save Expense does nothing' bug fix.

Scope (backend only):
- POST /api/expenses covering:
    * Personal (no split, no group)
    * Split equal (split_with=[friend_id])
    * Custom shares (shares=[{participant_id:"self", share:60},
                             {participant_id:friend_id, share:40}])
    * Group expense (auto-populate split_with from group.member_ids)
    * With small receipt_image_base64
    * Oversized receipt -> 413
    * Invalid currency -> 400
    * amount <= 0 -> 400
    * Missing required fields -> 422
- GET /api/expenses (verifies persistence + receipt_image_base64 NOT exposed)
- DELETE /api/expenses/{id}
- GET /api/expenses/{id}/receipt returns base64
- Auth (session/me/logout, apple 400-401, delete-account cascade)
- Friends CRUD
- Groups CRUD + members preserved
- Balances after splits
- Settlements create+list
- Recurring create+list+delete+materialization on next GET /api/expenses
- FX rates
- Insights month=YYYY-MM
- Trends months=6
- Scan oversize 413 (real Gemini call skipped/tolerant)
"""
from __future__ import annotations

import base64
import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4"
    "nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII="
)


# ------------------- helpers -------------------
def _cleanup_user_data(mongo, uid):
    mongo.expenses.delete_many({"user_id": uid})
    mongo.friends.delete_many({"user_id": uid})
    mongo.groups.delete_many({"user_id": uid})
    mongo.settlements.delete_many({"user_id": uid})
    mongo.recurring.delete_many({"user_id": uid})


@pytest.fixture
def clean_slate(mongo):
    from conftest import TEST_USER_ID
    _cleanup_user_data(mongo, TEST_USER_ID)
    yield
    _cleanup_user_data(mongo, TEST_USER_ID)


@pytest.fixture(scope="class")
def iso_user(mongo, request):
    """Per-class isolated user + Bearer session, avoiding xdist cross-class
    contention on the shared TEST_USER_ID.
    """
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


# ======================================================
# POST /api/expenses — payload shape matrix (bug fix focus)
# ======================================================
class TestCreateExpensePayloadShapes:
    # --- Auth guard ---
    def test_no_auth_returns_401(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/expenses", json={"amount": 5.0, "currency": "USD", "category": "Food"})
        assert r.status_code == 401

    # --- Personal, no split ---
    def test_personal_no_split(self, iso_user, base_url):
        client, uid = iso_user
        payload = {
            "amount": 12.34, "currency": "USD", "category": "Food",
            "merchant": "TEST_Cafe", "notes": "solo lunch",
            "group_id": None, "date": datetime.now(timezone.utc).isoformat(),
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["amount"] == 12.34
        assert d["currency"] == "USD"
        assert d["is_split"] is False
        assert d["split_with"] == []
        assert d["has_receipt"] is False
        assert "receipt_image_base64" not in d

        # GET verifies persistence
        g = client.get(f"{base_url}/api/expenses")
        assert g.status_code == 200
        assert any(e["expense_id"] == d["expense_id"] for e in g.json())

    # --- Split equal ---
    def test_split_equal_with_friend(self, iso_user, base_url):
        client, uid = iso_user
        # Create friend first
        f = client.post(f"{base_url}/api/friends", json={"name": "TEST_Alice"})
        assert f.status_code == 200
        fid = f.json()["friend_id"]

        payload = {
            "amount": 100.0, "currency": "USD", "category": "Food",
            "merchant": "TEST_Diner", "split_with": [fid],
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["split_with"] == [fid]
        assert d["is_split"] is True
        assert d["shares"] is None

    # --- Custom shares (self + friend) ---
    def test_custom_shares(self, iso_user, base_url):
        client, uid = iso_user
        f = client.post(f"{base_url}/api/friends", json={"name": "TEST_Bob"})
        fid = f.json()["friend_id"]
        payload = {
            "amount": 100.0, "currency": "USD", "category": "Groceries",
            "shares": [
                {"participant_id": "self", "share": 60},
                {"participant_id": fid, "share": 40},
            ],
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["shares"] is not None
        assert len(d["shares"]) == 2
        # split_with should be derived to include friend but not "self"
        assert fid in d["split_with"]
        assert "self" not in d["split_with"]
        assert d["is_split"] is True

    def test_shares_with_invalid_entries_are_dropped(self, iso_user, base_url):
        client, uid = iso_user
        payload = {
            "amount": 30.0, "currency": "USD", "category": "Other",
            "shares": [
                {"participant_id": "self", "share": 30},
                {"participant_id": "", "share": 5},           # empty pid -> drop
                {"participant_id": "someone", "share": -5},   # negative -> drop
                {"participant_id": "other", "share": "bad"}, # bad float -> drop
            ],
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        # only "self" survived
        assert d["shares"] == [{"participant_id": "self", "share": 30.0}]
        # only 1 share, no friend, so is_split == False
        assert d["is_split"] is False

    # --- Group auto-populate split_with ---
    def test_group_auto_populates_split_with(self, iso_user, base_url):
        client, uid = iso_user
        f1 = client.post(f"{base_url}/api/friends", json={"name": "TEST_G1"}).json()["friend_id"]
        f2 = client.post(f"{base_url}/api/friends", json={"name": "TEST_G2"}).json()["friend_id"]
        g = client.post(f"{base_url}/api/groups", json={"name": "TEST_Trip", "member_ids": [f1, f2]})
        assert g.status_code == 200
        gid = g.json()["group_id"]

        payload = {
            "amount": 90.0, "currency": "USD", "category": "Travel",
            "group_id": gid,  # no split_with, no shares
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d["split_with"]) == {f1, f2}
        assert d["group_id"] == gid
        assert d["is_split"] is True

    # --- Receipt attach ---
    def test_receipt_small_base64_accepted(self, iso_user, base_url):
        client, uid = iso_user
        payload = {
            "amount": 4.5, "currency": "USD", "category": "Food",
            "receipt_image_base64": TINY_PNG_B64,
        }
        r = client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        eid = d["expense_id"]
        assert d["has_receipt"] is True
        assert "receipt_image_base64" not in d  # never exposed on create response

        # GET list must not expose receipt_image_base64
        lst = client.get(f"{base_url}/api/expenses").json()
        row = next(e for e in lst if e["expense_id"] == eid)
        assert "receipt_image_base64" not in row
        assert row["has_receipt"] is True

        # GET receipt endpoint returns the base64
        rec = client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rec.status_code == 200
        assert rec.json()["image_base64"] == TINY_PNG_B64
        assert rec.json()["mime_type"] == "image/jpeg"

    # --- Oversized receipt ---
    def test_receipt_too_large_413(self, iso_user, base_url):
        client, uid = iso_user
        big = "A" * (5_500_001)
        r = client.post(
            f"{base_url}/api/expenses",
            json={"amount": 1.0, "currency": "USD", "category": "Other", "receipt_image_base64": big},
        )
        assert r.status_code == 413, r.text

    # --- Invalid currency ---
    def test_invalid_currency_400(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"amount": 5, "currency": "XYZ", "category": "Food"})
        assert r.status_code == 400

    def test_currency_lowercase_is_uppercased(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"amount": 5, "currency": "eur", "category": "Food"})
        assert r.status_code == 200
        assert r.json()["currency"] == "EUR"

    # --- amount validation ---
    def test_amount_zero_400(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"amount": 0, "currency": "USD", "category": "Food"})
        assert r.status_code == 400

    def test_amount_negative_400(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"amount": -1.5, "currency": "USD", "category": "Food"})
        assert r.status_code == 400

    # --- Missing required fields ---
    def test_missing_amount_422(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"currency": "USD", "category": "Food"})
        assert r.status_code == 422

    def test_amount_wrong_type_422(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={"amount": "not-a-number", "currency": "USD"})
        assert r.status_code == 422

    def test_empty_body_422(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={})
        assert r.status_code == 422


# ======================================================
# GET /api/expenses + DELETE
# ======================================================
class TestExpenseListAndDelete:
    def test_list_never_exposes_receipt(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={
            "amount": 2, "currency": "USD", "category": "Food",
            "receipt_image_base64": TINY_PNG_B64,
        })
        assert r.status_code == 200
        lst = client.get(f"{base_url}/api/expenses").json()
        for e in lst:
            assert "receipt_image_base64" not in e

    def test_delete_expense(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={
            "amount": 3, "currency": "USD", "category": "Food",
        })
        eid = r.json()["expense_id"]
        d = client.delete(f"{base_url}/api/expenses/{eid}")
        assert d.status_code == 200
        assert d.json().get("ok") is True

        # Deleting again -> 404
        d2 = client.delete(f"{base_url}/api/expenses/{eid}")
        assert d2.status_code == 404

    def test_get_receipt_404_when_missing(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/expenses", json={
            "amount": 1, "currency": "USD", "category": "Other",
        })
        eid = r.json()["expense_id"]
        rec = client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rec.status_code == 404

    def test_get_receipt_404_bogus_id(self, iso_user, base_url):
        client, uid = iso_user
        rec = client.get(f"{base_url}/api/expenses/exp_doesnotexist/receipt")
        assert rec.status_code == 404


# ======================================================
# Friends CRUD
# ======================================================
class TestFriends:
    def test_friend_crud(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/friends", json={"name": "TEST_Frenemy", "email": "t@e.co"})
        assert r.status_code == 200
        fid = r.json()["friend_id"]
        assert r.json()["email"] == "t@e.co"

        lst = client.get(f"{base_url}/api/friends").json()
        assert any(f["friend_id"] == fid for f in lst)

        d = client.delete(f"{base_url}/api/friends/{fid}")
        assert d.status_code == 200
        d2 = client.delete(f"{base_url}/api/friends/{fid}")
        assert d2.status_code == 404


# ======================================================
# Groups CRUD + members preserved
# ======================================================
class TestGroups:
    def test_group_members_preserved(self, iso_user, base_url):
        client, uid = iso_user
        f1 = client.post(f"{base_url}/api/friends", json={"name": "TEST_M1"}).json()["friend_id"]
        f2 = client.post(f"{base_url}/api/friends", json={"name": "TEST_M2"}).json()["friend_id"]
        g = client.post(f"{base_url}/api/groups", json={"name": "TEST_Grp", "member_ids": [f1, f2]})
        assert g.status_code == 200
        gid = g.json()["group_id"]

        lst = client.get(f"{base_url}/api/groups").json()
        got = next(x for x in lst if x["group_id"] == gid)
        assert set(got["member_ids"]) == {f1, f2}

        d = client.delete(f"{base_url}/api/groups/{gid}")
        assert d.status_code == 200
        d2 = client.delete(f"{base_url}/api/groups/{gid}")
        assert d2.status_code == 404


# ======================================================
# Balances after splits — uses an ISOLATED user to avoid xdist cross-worker
# contention on the shared TEST_USER_ID via clean_slate.
# ======================================================
@pytest.fixture(scope="class")
def isolated_auth(mongo):
    uid = f"user_test_bal_{uuid.uuid4().hex[:8]}"
    tok = f"tok_bal_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": f"TEST_bal_{uid}@example.com",
        "name": "TEST Balances", "currency": "USD",
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


class TestBalances:
    def test_balances_split_equal(self, isolated_auth, base_url):
        client, uid = isolated_auth
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_Bal"}).json()["friend_id"]
        # 100 split with 1 friend => friend owes 100/(1+1)=50
        r = client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        assert r.status_code == 200
        b = client.get(f"{base_url}/api/balances")
        assert b.status_code == 200
        data = b.json()
        friend_row = next(f for f in data["friends"] if f["friend_id"] == fid)
        assert friend_row["amount"] == 50.0
        assert data["total_owed_to_me"] == 50.0
        # cleanup for next test in class
        client.delete(f"{base_url}/api/friends/{fid}")

    def test_balances_custom_shares(self, isolated_auth, base_url):
        client, uid = isolated_auth
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_BalCS"}).json()["friend_id"]
        # 100 with self:60, friend:40 => friend owes 100*40/100=40
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food",
            "shares": [
                {"participant_id": "self", "share": 60},
                {"participant_id": fid, "share": 40},
            ],
        })
        data = client.get(f"{base_url}/api/balances").json()
        friend_row = next(f for f in data["friends"] if f["friend_id"] == fid)
        # There may be leftover 50 from previous test's expense; assert this
        # friend's contribution >= 40 (previous test's friend was deleted so
        # its expense contributes to no friend row, only this friend matters).
        assert friend_row["amount"] == 40.0
        client.delete(f"{base_url}/api/friends/{fid}")

    def test_balances_reduced_by_settlement(self, isolated_auth, base_url, mongo, request):
        client, uid = isolated_auth
        # Wipe any leftover expenses/settlements from prior tests in class
        _cleanup_user_data(mongo, uid)
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_BalSet"}).json()["friend_id"]
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        # Friend pays back 20 -> balance now 30
        s = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 20.0, "currency": "USD",
        })
        assert s.status_code == 200, s.text
        data = client.get(f"{base_url}/api/balances").json()
        friend_row = next(f for f in data["friends"] if f["friend_id"] == fid)
        assert friend_row["amount"] == 30.0


# ======================================================
# Settlements
# ======================================================
class TestSettlements:
    def test_settlement_requires_valid_friend(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/settlements", json={
            "friend_id": "frd_nonexistent", "amount": 10, "currency": "USD",
        })
        assert r.status_code == 404

    def test_settlement_amount_zero_400(self, iso_user, base_url):
        client, uid = iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_S1"}).json()["friend_id"]
        r = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 0, "currency": "USD",
        })
        assert r.status_code == 400

    def test_settlement_create_list_delete(self, iso_user, base_url):
        client, uid = iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_S2"}).json()["friend_id"]
        r = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 7.5, "currency": "USD", "note": "TEST",
        })
        assert r.status_code == 200
        sid = r.json()["settlement_id"]
        lst = client.get(f"{base_url}/api/settlements").json()
        assert any(s["settlement_id"] == sid for s in lst)
        d = client.delete(f"{base_url}/api/settlements/{sid}")
        assert d.status_code == 200


# ======================================================
# Recurring + materialization on next GET /api/expenses
# ======================================================
class TestRecurring:
    def test_recurring_materializes_past_dated(self, iso_user, base_url, mongo):
        client, uid = iso_user
        past = (datetime.now(timezone.utc) - timedelta(days=45)).isoformat()
        r = client.post(f"{base_url}/api/recurring", json={
            "amount": 9.99, "currency": "USD", "category": "Bills",
            "merchant": "TEST_Netflix", "cadence": "monthly",
            "start_date": past,
        })
        assert r.status_code == 200
        rid = r.json()["recurring_id"]

        # List expenses -> should include materialized entries
        lst = client.get(f"{base_url}/api/expenses").json()
        materialized = [e for e in lst if e.get("merchant") == "TEST_Netflix"]
        assert len(materialized) >= 1

        # next_run advanced past 'now'
        rec = next(r for r in client.get(f"{base_url}/api/recurring").json() if r["recurring_id"] == rid)
        nr = datetime.fromisoformat(rec["next_run"])
        if nr.tzinfo is None:
            nr = nr.replace(tzinfo=timezone.utc)
        assert nr > datetime.now(timezone.utc)

        # Delete
        d = client.delete(f"{base_url}/api/recurring/{rid}")
        assert d.status_code == 200

    def test_recurring_bad_cadence_400(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/recurring", json={
            "amount": 1, "currency": "USD", "category": "Other", "cadence": "yearly",
        })
        assert r.status_code == 400

    def test_recurring_amount_zero_400(self, iso_user, base_url):
        client, uid = iso_user
        r = client.post(f"{base_url}/api/recurring", json={
            "amount": 0, "currency": "USD", "category": "Other", "cadence": "monthly",
        })
        assert r.status_code == 400


# ======================================================
# FX, Insights, Trends
# ======================================================
class TestFxInsightsTrends:
    def test_fx(self, iso_user, base_url):
        client, uid = iso_user
        r = client.get(f"{base_url}/api/fx")
        assert r.status_code == 200
        d = r.json()
        assert d["base"] == "USD"
        assert set(d["rates"].keys()) == {"USD", "INR", "EUR", "GBP", "JPY"}
        assert d["rates"]["USD"] == 1.0

    def test_insights_current_month(self, iso_user, base_url):
        client, uid = iso_user
        client.post(f"{base_url}/api/expenses", json={
            "amount": 20.0, "currency": "USD", "category": "Food",
            "date": datetime.now(timezone.utc).isoformat(),
        })
        client.post(f"{base_url}/api/expenses", json={
            "amount": 10.0, "currency": "USD", "category": "Transport",
            "date": datetime.now(timezone.utc).isoformat(),
        })
        r = client.get(f"{base_url}/api/insights")
        assert r.status_code == 200
        d = r.json()
        assert d["currency"] == "USD"
        assert d["total"] >= 30.0
        cats = {c["category"]: c["amount"] for c in d["breakdown"]}
        assert "Food" in cats and "Transport" in cats

    def test_insights_specific_month(self, iso_user, base_url):
        client, uid = iso_user
        now = datetime.now(timezone.utc)
        r = client.get(f"{base_url}/api/insights", params={"month": f"{now.year:04d}-{now.month:02d}"})
        assert r.status_code == 200

    def test_insights_bad_month(self, iso_user, base_url):
        client, uid = iso_user
        r = client.get(f"{base_url}/api/insights", params={"month": "not-a-month"})
        assert r.status_code == 400

    def test_trends_6_months(self, iso_user, base_url):
        client, uid = iso_user
        r = client.get(f"{base_url}/api/trends", params={"months": 6})
        assert r.status_code == 200
        d = r.json()
        assert d["months"] == 6
        assert len(d["series"]) == 6

    def test_trends_bounds(self, iso_user, base_url):
        client, uid = iso_user
        r = client.get(f"{base_url}/api/trends", params={"months": 1})
        assert r.status_code == 400
        r2 = client.get(f"{base_url}/api/trends", params={"months": 25})
        assert r2.status_code == 400


# ======================================================
# Auth: session/me/logout/apple negatives
# ======================================================
class TestAuth:
    def test_me_ok(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == "TEST_backend_tester@example.com"

    def test_me_no_bearer(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_bad_bearer(self, base_url):
        s = requests.Session()
        s.headers.update({"Authorization": "Bearer nope_nope_nope"})
        r = s.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_session_missing_id(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/auth/session", json={"session_id": ""})
        assert r.status_code == 400

    def test_session_bad_id(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/auth/session", json={"session_id": "definitely-not-real"})
        assert r.status_code == 401

    def test_apple_missing_token(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/auth/apple", json={})
        assert r.status_code in (400, 422)

    def test_apple_bad_token(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/auth/apple", json={"identity_token": "junk.junk.junk"})
        assert r.status_code == 401

    def test_logout_idempotent(self, base_url):
        # Create a throwaway session directly in DB via the seeded flow: use anon logout — must still return {ok:true}
        s = requests.Session()
        s.headers.update({"Authorization": "Bearer nonexistent_token"})
        r = s.post(f"{base_url}/api/auth/logout")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_currency_update_valid(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "eur"})
        assert r.status_code == 200
        assert r.json()["currency"] == "EUR"
        # revert
        r2 = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        assert r2.status_code == 200

    def test_currency_update_invalid(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "ZZZ"})
        assert r.status_code == 400


# ======================================================
# Scan oversize
# ======================================================
class TestScan:
    def test_scan_oversize_413(self, auth_client, base_url):
        big = "A" * (5_500_001)
        r = auth_client.post(f"{base_url}/api/scan", json={"image_base64": big, "mime_type": "image/jpeg"})
        assert r.status_code == 413

    def test_scan_missing_image_400(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/scan", json={"image_base64": "", "mime_type": "image/jpeg"})
        assert r.status_code == 400
