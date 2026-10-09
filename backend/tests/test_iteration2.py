"""SplitSync iteration 2: settlements, groups, recurring, fx, currency-converted balances."""
import os
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ---------- FX ----------
class TestFX:
    def test_fx_requires_auth(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/fx")
        assert r.status_code == 401

    def test_fx_returns_rates(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/fx")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("base") == "USD"
        rates = data.get("rates") or {}
        assert isinstance(rates, dict)
        for k in ("USD", "INR", "EUR"):
            assert k in rates, f"missing {k} in rates"
            assert isinstance(rates[k], (int, float))
        assert abs(float(rates["USD"]) - 1.0) < 1e-9
        assert float(rates["INR"]) > 1.0
        assert float(rates["EUR"]) > 0.0
        # New shape (iter 11): snapshot_date (YYYY-MM-DD) + refreshed_today bool
        sd = data.get("snapshot_date")
        assert isinstance(sd, str) and len(sd) == 10 and sd[4] == "-" and sd[7] == "-"
        assert "refreshed_today" in data
        assert isinstance(data["refreshed_today"], bool)


# ---------- Groups ----------
class TestGroups:
    friend_x = None
    friend_y = None
    group_id = None

    def test_setup_friends(self, auth_client, base_url):
        a = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_GroupA"}).json()
        b = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_GroupB"}).json()
        TestGroups.friend_x = a["friend_id"]
        TestGroups.friend_y = b["friend_id"]

    def test_create_group(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/groups",
            json={"name": "TEST_Trip", "member_ids": [self.friend_x, self.friend_y]},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Trip"
        assert set(data["member_ids"]) == {self.friend_x, self.friend_y}
        assert data["group_id"].startswith("grp_")
        TestGroups.group_id = data["group_id"]

    def test_list_groups(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/groups")
        assert r.status_code == 200
        ids = [g["group_id"] for g in r.json()]
        assert self.group_id in ids

    def test_expense_with_group_autopopulates_split(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 60.0,
                "currency": "USD",
                "category": "Food",
                "merchant": "TEST_GroupDinner",
                "group_id": self.group_id,
                "split_with": [],
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["group_id"] == self.group_id
        assert set(data["split_with"]) == {self.friend_x, self.friend_y}
        assert data["is_split"] is True
        # cleanup expense
        auth_client.delete(f"{base_url}/api/expenses/{data['expense_id']}")

    def test_delete_group(self, auth_client, base_url):
        r = auth_client.delete(f"{base_url}/api/groups/{self.group_id}")
        assert r.status_code == 200
        assert r.json().get("ok") is True
        # subsequent delete -> 404
        r2 = auth_client.delete(f"{base_url}/api/groups/{self.group_id}")
        assert r2.status_code == 404


# ---------- Settlements ----------
class TestSettlements:
    friend_a = None
    friend_b = None
    expense_id = None
    settlement_id = None

    def test_setup(self, auth_client, base_url, mongo):
        # Clean expenses/settlements/friends for isolated arithmetic
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.settlements.delete_many({"user_id": "user_test_fixture01"})
        mongo.friends.delete_many({"user_id": "user_test_fixture01"})
        # ensure home currency USD
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})

        a = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_SetAlice"}).json()
        b = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_SetBob"}).json()
        TestSettlements.friend_a = a["friend_id"]
        TestSettlements.friend_b = b["friend_id"]

        exp = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 90.0,
                "currency": "USD",
                "split_with": [self.friend_a, self.friend_b],
            },
        ).json()
        TestSettlements.expense_id = exp["expense_id"]

    def test_balances_before_settlement(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/balances")
        assert r.status_code == 200
        d = r.json()
        by_id = {f["friend_id"]: f["amount"] for f in d["friends"]}
        assert abs(by_id[self.friend_a] - 30.0) < 0.01
        assert abs(by_id[self.friend_b] - 30.0) < 0.01
        assert abs(d["total_owed_to_me"] - 60.0) < 0.01

    def test_create_settlement_invalid_friend(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": "frd_doesnotexist", "amount": 5.0},
        )
        assert r.status_code == 404

    def test_create_settlement_bad_amount(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": self.friend_a, "amount": 0},
        )
        assert r.status_code == 400
        r2 = auth_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": self.friend_a, "amount": -5},
        )
        assert r2.status_code == 400

    def test_settlement_requires_auth(self, anon_client, base_url):
        r = anon_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": "x", "amount": 1},
        )
        assert r.status_code == 401

    def test_create_settlement_success(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": self.friend_a, "amount": 10.0, "currency": "USD", "note": "TEST_partial"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["friend_id"] == self.friend_a
        assert d["amount"] == 10.0
        assert d["settlement_id"].startswith("stl_")
        TestSettlements.settlement_id = d["settlement_id"]

    def test_list_settlements(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/settlements")
        assert r.status_code == 200
        ids = [s["settlement_id"] for s in r.json()]
        assert self.settlement_id in ids

    def test_balances_after_settlement(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/balances")
        assert r.status_code == 200
        d = r.json()
        by_id = {f["friend_id"]: f["amount"] for f in d["friends"]}
        # Alice was 30, minus 10 settlement => 20
        assert abs(by_id[self.friend_a] - 20.0) < 0.01, f"Alice balance: {by_id[self.friend_a]}"
        assert abs(by_id[self.friend_b] - 30.0) < 0.01
        assert abs(d["total_owed_to_me"] - 50.0) < 0.01

    def test_delete_settlement(self, auth_client, base_url):
        r = auth_client.delete(f"{base_url}/api/settlements/{self.settlement_id}")
        assert r.status_code == 200
        # 404 on repeat
        r2 = auth_client.delete(f"{base_url}/api/settlements/{self.settlement_id}")
        assert r2.status_code == 404
        # balances revert
        b = auth_client.get(f"{base_url}/api/balances").json()
        by_id = {f["friend_id"]: f["amount"] for f in b["friends"]}
        assert abs(by_id[self.friend_a] - 30.0) < 0.01


# ---------- Recurring ----------
class TestRecurring:
    rec_id = None

    def test_setup_clean(self, auth_client, base_url, mongo):
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.recurring.delete_many({"user_id": "user_test_fixture01"})

    def test_create_recurring_invalid_cadence(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/recurring",
            json={"amount": 5.0, "cadence": "daily"},
        )
        assert r.status_code == 400

    def test_create_recurring_weekly_past_materializes(self, auth_client, base_url):
        # start 3 weeks ago -> should materialize 3-4 expenses immediately
        start = (datetime.now(timezone.utc) - timedelta(days=21)).isoformat()
        r = auth_client.post(
            f"{base_url}/api/recurring",
            json={
                "amount": 12.5,
                "currency": "USD",
                "category": "Bills",
                "merchant": "TEST_Netflix",
                "cadence": "weekly",
                "start_date": start,
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["cadence"] == "weekly"
        assert d["recurring_id"].startswith("rec_")
        TestRecurring.rec_id = d["recurring_id"]
        # next_run should now be in the future
        nr = datetime.fromisoformat(d["next_run"])
        if nr.tzinfo is None:
            nr = nr.replace(tzinfo=timezone.utc)
        assert nr > datetime.now(timezone.utc), f"next_run should be future, got {nr}"

    def test_expenses_materialized(self, auth_client, base_url):
        # calling GET /api/expenses also triggers materialize
        r = auth_client.get(f"{base_url}/api/expenses")
        assert r.status_code == 200
        matching = [e for e in r.json() if e.get("merchant") == "TEST_Netflix"]
        # 3 weeks past + start-of-window means at least 3 entries created
        assert len(matching) >= 3, f"expected >=3 materialized recurring expenses, got {len(matching)}"
        for e in matching:
            assert abs(e["amount"] - 12.5) < 0.01
            assert e["category"] == "Bills"

    def test_list_recurring(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/recurring")
        assert r.status_code == 200
        ids = [x["recurring_id"] for x in r.json()]
        assert self.rec_id in ids

    def test_delete_recurring(self, auth_client, base_url):
        r = auth_client.delete(f"{base_url}/api/recurring/{self.rec_id}")
        assert r.status_code == 200
        r2 = auth_client.delete(f"{base_url}/api/recurring/{self.rec_id}")
        assert r2.status_code == 404


# ---------- Currency-converted Balances ----------
class TestBalancesCurrencyConversion:
    friend_id = None

    def test_setup(self, auth_client, base_url, mongo):
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.settlements.delete_many({"user_id": "user_test_fixture01"})
        mongo.friends.delete_many({"user_id": "user_test_fixture01"})
        f = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_FXFriend"}).json()
        TestBalancesCurrencyConversion.friend_id = f["friend_id"]

    def test_inr_home_usd_expense_converted(self, auth_client, base_url):
        # Set home currency to INR
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "INR"})
        assert r.status_code == 200
        # Get current INR rate
        fx = auth_client.get(f"{base_url}/api/fx").json()
        inr_rate = float(fx["rates"]["INR"])
        assert inr_rate > 1.0

        # Create $60 USD expense split with 1 friend -> each share = 30 USD
        exp = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 60.0,
                "currency": "USD",
                "split_with": [self.friend_id],
            },
        )
        assert exp.status_code == 200
        expected_inr = 30.0 * inr_rate

        b = auth_client.get(f"{base_url}/api/balances")
        assert b.status_code == 200
        data = b.json()
        assert data["currency"] == "INR"
        by_id = {f["friend_id"]: f["amount"] for f in data["friends"]}
        got = by_id[self.friend_id]
        # tolerate slight rate variance
        assert abs(got - expected_inr) < 1.0, f"expected ~{expected_inr} INR, got {got}"

        # revert currency
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
