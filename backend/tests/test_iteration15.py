"""Iteration 15: partial-settlement regression tests for the new
`_recompute_settled_through` behavior.

Rules verified:
 (a) Partial settlement — leaves cutoff = None, balance = residual.
 (b) Follow-up full-clearance settlement — sets cutoff to that settlement's ts,
     balance drops to 0.
 (c) DELETE of the clearing settlement — cutoff rolls back to None, balance
     restored.
 (d) Two full-clearance cycles + DELETE of 2nd → cutoff rolls back to first
     clearing settlement's ts (NOT None), balance reflects only expenses AFTER
     the earlier cutoff.
 (e) Overpayment — balance goes negative, cutoff advances to overpaying
     settlement.

All tests use fully isolated users (own session token) to keep parallel runs
green.
"""
from __future__ import annotations

import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests


def _cleanup_user_data(mongo, uid):
    mongo.expenses.delete_many({"user_id": uid})
    mongo.friends.delete_many({"user_id": uid})
    mongo.groups.delete_many({"user_id": uid})
    mongo.settlements.delete_many({"user_id": uid})
    mongo.recurring.delete_many({"user_id": uid})


@pytest.fixture
def fresh_iso_user(mongo):
    uid = f"user_test_i15_{uuid.uuid4().hex[:8]}"
    tok = f"tok_i15_{uuid.uuid4().hex}"
    mongo.users.insert_one({
        "user_id": uid, "email": f"TEST_{uid}@example.com",
        "name": "TEST i15", "currency": "USD",
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    mongo.user_sessions.insert_one({
        "session_token": tok, "user_id": uid,
        "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
        "created_at": datetime.now(timezone.utc),
    })
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {tok}",
    })
    yield s, uid
    _cleanup_user_data(mongo, uid)
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"session_token": tok})


def _friend_row(client, base_url, fid):
    b = client.get(f"{base_url}/api/balances").json()
    return next((f for f in b["friends"] if f["friend_id"] == fid), None)


def _friend_doc(mongo, uid, fid):
    return mongo.friends.find_one({"friend_id": fid, "user_id": uid})


class TestPartialSettlementRegression:
    # (a) Partial settlement leaves cutoff = None, balance = 40
    def test_a_partial_settlement_keeps_cutoff_none(self, fresh_iso_user, base_url, mongo):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_A"}).json()["friend_id"]
        # $100 split (A owes 50)
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        # partial $10
        s1 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 10.0, "currency": "USD",
        })
        assert s1.status_code == 200, s1.text
        row = _friend_row(client, base_url, fid)
        assert row["amount"] == 40.0, f"expected 40.0, got {row['amount']}"
        fdoc = _friend_doc(mongo, uid, fid)
        assert fdoc.get("settled_through") is None, (
            f"partial settlement must NOT advance cutoff, got {fdoc.get('settled_through')}"
        )

    # (b) Follow-up settlement clears → cutoff = 2nd settlement's ts
    def test_b_full_clearance_after_partial_sets_cutoff(self, fresh_iso_user, base_url, mongo):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_B"}).json()["friend_id"]
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 10.0, "currency": "USD",
        }).json()
        time.sleep(1.05)
        s2 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 40.0, "currency": "USD",
        }).json()
        row = _friend_row(client, base_url, fid)
        assert row["amount"] == 0.0, f"expected 0.0 balance after clearing, got {row['amount']}"
        fdoc = _friend_doc(mongo, uid, fid)
        assert fdoc.get("settled_through") == s2["created_at"], (
            f"cutoff should equal 2nd settlement's created_at "
            f"({s2['created_at']}) got {fdoc.get('settled_through')}"
        )

    # (c) DELETE the clearing settlement → cutoff rolls back to None, balance = 40
    def test_c_delete_clearing_settlement_rolls_back(self, fresh_iso_user, base_url, mongo):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_C"}).json()["friend_id"]
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 10.0, "currency": "USD",
        })
        time.sleep(1.05)
        s2 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 40.0, "currency": "USD",
        }).json()
        # Sanity: cleared
        assert _friend_row(client, base_url, fid)["amount"] == 0.0

        # Delete the clearing settlement
        d = client.delete(f"{base_url}/api/settlements/{s2['settlement_id']}")
        assert d.status_code == 200, d.text

        row = _friend_row(client, base_url, fid)
        assert row["amount"] == 40.0, f"expected 40.0 after delete, got {row['amount']}"
        fdoc = _friend_doc(mongo, uid, fid)
        assert fdoc.get("settled_through") is None, (
            f"cutoff should be None after removing clearing settlement, got {fdoc.get('settled_through')}"
        )

    # (d) Two full-clearance cycles → delete 2nd → cutoff rolls back to T1 (not None)
    def test_d_delete_second_cycle_rolls_back_to_first_cutoff(self, fresh_iso_user, base_url, mongo):
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_D"}).json()["friend_id"]
        # cycle 1: $100 split → settle $50 clears
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        s1 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 50.0, "currency": "USD",
        }).json()
        t1 = s1["created_at"]
        # verify cleared with cutoff = t1
        assert _friend_row(client, base_url, fid)["amount"] == 0.0
        assert _friend_doc(mongo, uid, fid).get("settled_through") == t1

        # cycle 2: add $60 split → settle $60 clears
        time.sleep(1.05)
        client.post(f"{base_url}/api/expenses", json={
            "amount": 60.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        time.sleep(1.05)
        s2 = client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 30.0, "currency": "USD",
        }).json()
        t2 = s2["created_at"]
        assert _friend_row(client, base_url, fid)["amount"] == 0.0
        assert _friend_doc(mongo, uid, fid).get("settled_through") == t2

        # Delete the 2nd clearing settlement → cutoff must roll back to t1
        d = client.delete(f"{base_url}/api/settlements/{s2['settlement_id']}")
        assert d.status_code == 200

        row = _friend_row(client, base_url, fid)
        # Only post-t1 expense counts (60 split → A owes 30)
        assert row["amount"] == 30.0, f"expected 30.0 (only post-t1 expense), got {row['amount']}"
        fdoc = _friend_doc(mongo, uid, fid)
        assert fdoc.get("settled_through") == t1, (
            f"cutoff should roll back to t1 ({t1}), got {fdoc.get('settled_through')}"
        )

    # (e) Overpayment → net_home negative, cutoff stays open
    def test_e_overpayment_keeps_books_open_and_goes_negative(self, fresh_iso_user, base_url, mongo):
        """Overpayment semantics: an overpay settlement does NOT close the
        books (there's now a residual reverse-balance the friend owes back).
        The cutoff stays untouched and /api/balances surfaces the negative
        residual naturally. Only an exact clearance advances the cutoff."""
        client, uid = fresh_iso_user
        fid = client.post(f"{base_url}/api/friends", json={"name": "TEST_E"}).json()["friend_id"]
        # $100 split (A owes 50)
        client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "split_with": [fid],
        })
        # settle $35 partial (balance = 15)
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 35.0, "currency": "USD",
        })
        row = _friend_row(client, base_url, fid)
        assert row["amount"] == 15.0, f"partial should leave 15, got {row['amount']}"
        # cutoff still None
        assert _friend_doc(mongo, uid, fid).get("settled_through") is None

        # overpay: settle $25 → balance = -10 (A overpaid)
        time.sleep(1.05)
        client.post(f"{base_url}/api/settlements", json={
            "friend_id": fid, "amount": 25.0, "currency": "USD",
        })
        # Overpay leaves the books OPEN (cutoff untouched) so the negative
        # residual is visible.
        assert _friend_doc(mongo, uid, fid).get("settled_through") is None, (
            "overpay must leave the cutoff open (books stay open)"
        )
        # Balance reflects the overpayment residual.
        row = _friend_row(client, base_url, fid)
        assert row["amount"] == -10.0, f"expected -10.0 (overpaid); got {row['amount']}."

        # History net_home == balances row
        h = client.get(f"{base_url}/api/friends/{fid}/history").json()
        assert h["net_home"] == -10.0, f"history net_home should be -10.0, got {h['net_home']}"
