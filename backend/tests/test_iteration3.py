"""SplitSync iteration 3: shares-based split ratios + expanded home currencies (USD/INR/EUR/GBP/JPY)."""
import os
from datetime import datetime, timezone

import pytest


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ---------- Multi-Split Ratios (weighted shares) ----------
class TestSharesBasedSplit:
    friend_alice = None
    friend_bob = None

    @classmethod
    def _clean(cls, mongo):
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.settlements.delete_many({"user_id": "user_test_fixture01"})
        mongo.friends.delete_many({"user_id": "user_test_fixture01"})

    def test_setup(self, auth_client, base_url, mongo):
        self._clean(mongo)
        # ensure USD home currency for deterministic amounts
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        assert r.status_code == 200
        a = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_ShareAlice"}).json()
        b = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_ShareBob"}).json()
        TestSharesBasedSplit.friend_alice = a["friend_id"]
        TestSharesBasedSplit.friend_bob = b["friend_id"]

    def test_two_participant_shares_60_40(self, auth_client, base_url):
        """POST expense amount=100 with shares self:60, alice:40 -> alice owes 40."""
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 100.0,
                "currency": "USD",
                "shares": [
                    {"participant_id": "self", "share": 60},
                    {"participant_id": self.friend_alice, "share": 40},
                ],
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_split"] is True
        assert d["split_with"] == [self.friend_alice]
        assert d["shares"] is not None
        assert len(d["shares"]) == 2

        b = auth_client.get(f"{base_url}/api/balances")
        assert b.status_code == 200
        by_id = {f["friend_id"]: f["amount"] for f in b.json()["friends"]}
        assert abs(by_id[self.friend_alice] - 40.0) < 0.01, f"alice expected 40, got {by_id[self.friend_alice]}"
        # bob should be 0 (present as friend but not in split)
        assert abs(by_id[self.friend_bob]) < 0.01

    def test_three_participant_weighted(self, auth_client, base_url, mongo):
        """amount=200, shares self:1, alice:2, bob:1 -> total 4; alice owes 100, bob owes 50."""
        # clean prior expenses to isolate
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 200.0,
                "currency": "USD",
                "shares": [
                    {"participant_id": "self", "share": 1},
                    {"participant_id": self.friend_alice, "share": 2},
                    {"participant_id": self.friend_bob, "share": 1},
                ],
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_split"] is True
        assert set(d["split_with"]) == {self.friend_alice, self.friend_bob}

        b = auth_client.get(f"{base_url}/api/balances")
        by_id = {f["friend_id"]: f["amount"] for f in b.json()["friends"]}
        assert abs(by_id[self.friend_alice] - 100.0) < 0.01, f"alice expected 100, got {by_id[self.friend_alice]}"
        assert abs(by_id[self.friend_bob] - 50.0) < 0.01, f"bob expected 50, got {by_id[self.friend_bob]}"

    def test_backward_compat_equal_split_no_shares(self, auth_client, base_url, mongo):
        """split_with=[alice,bob] with no shares -> equal split (200/3 ≈ 66.67 each)."""
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 200.0,
                "currency": "USD",
                "split_with": [self.friend_alice, self.friend_bob],
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["shares"] is None
        assert d["is_split"] is True
        assert set(d["split_with"]) == {self.friend_alice, self.friend_bob}

        b = auth_client.get(f"{base_url}/api/balances")
        by_id = {f["friend_id"]: f["amount"] for f in b.json()["friends"]}
        # 200/(1+2)=66.666...
        assert abs(by_id[self.friend_alice] - (200.0 / 3.0)) < 0.02, f"alice got {by_id[self.friend_alice]}"
        assert abs(by_id[self.friend_bob] - (200.0 / 3.0)) < 0.02, f"bob got {by_id[self.friend_bob]}"

    def test_shares_all_zero_or_negative_treated_as_none(self, auth_client, base_url, mongo):
        """All shares <= 0 -> shares dropped to None; with no split_with -> not a split."""
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 50.0,
                "currency": "USD",
                "shares": [
                    {"participant_id": "self", "share": 0},
                    {"participant_id": self.friend_alice, "share": -5},
                ],
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["shares"] is None, f"expected shares None, got {d['shares']}"
        assert d["is_split"] is False, f"expected is_split False when no valid shares/split_with, got {d['is_split']}"
        assert d["split_with"] == []

        # balances for alice should be 0 (no split contribution)
        b = auth_client.get(f"{base_url}/api/balances")
        by_id = {f["friend_id"]: f["amount"] for f in b.json()["friends"]}
        assert abs(by_id[self.friend_alice]) < 0.01

    def test_settlement_still_subtracts_after_shares(self, auth_client, base_url, mongo):
        """Regression: settlements subtract from per-friend balance computed via shares."""
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.settlements.delete_many({"user_id": "user_test_fixture01"})
        auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 100.0,
                "currency": "USD",
                "shares": [
                    {"participant_id": "self", "share": 60},
                    {"participant_id": self.friend_alice, "share": 40},
                ],
            },
        )
        # alice owes 40; pay 15 -> expect 25
        st = auth_client.post(
            f"{base_url}/api/settlements",
            json={"friend_id": self.friend_alice, "amount": 15.0, "currency": "USD"},
        )
        assert st.status_code == 200, st.text
        b = auth_client.get(f"{base_url}/api/balances")
        by_id = {f["friend_id"]: f["amount"] for f in b.json()["friends"]}
        assert abs(by_id[self.friend_alice] - 25.0) < 0.01, f"alice after settlement: {by_id[self.friend_alice]}"


# ---------- Expanded Home Currencies ----------
class TestExpandedCurrencies:
    @pytest.mark.parametrize("cur", ["USD", "INR", "EUR", "GBP", "JPY"])
    def test_accept_supported_currency(self, auth_client, base_url, cur):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": cur})
        assert r.status_code == 200, f"{cur} failed: {r.text}"
        assert r.json()["currency"] == cur
        me = auth_client.get(f"{base_url}/api/auth/me")
        assert me.status_code == 200
        assert me.json()["currency"] == cur

    def test_reject_invalid_currency(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "XYZ"})
        assert r.status_code == 400
        # ensure we don't corrupt state
        me = auth_client.get(f"{base_url}/api/auth/me").json()
        assert me["currency"] in ("USD", "INR", "EUR", "GBP", "JPY")

    def test_lowercase_currency_accepted_uppercased(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "eur"})
        assert r.status_code == 200
        assert r.json()["currency"] == "EUR"
        # revert
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})


# ---------- FX rates expanded ----------
class TestFXExpanded:
    def test_fx_all_five_currencies(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/fx")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("base") == "USD"
        rates = data.get("rates") or {}
        for k in ("USD", "INR", "EUR", "GBP", "JPY"):
            assert k in rates, f"missing {k} in rates"
            assert isinstance(rates[k], (int, float)), f"{k} rate not a number"
            assert float(rates[k]) > 0.0, f"{k} rate not positive: {rates[k]}"
        assert abs(float(rates["USD"]) - 1.0) < 1e-9
        assert float(rates["INR"]) > 1.0
        assert float(rates["JPY"]) > 1.0
        # New shape (iter 11): snapshot_date + refreshed_today
        sd = data.get("snapshot_date")
        assert isinstance(sd, str) and len(sd) == 10
        assert isinstance(data.get("refreshed_today"), bool)


# ---------- Regression: scan endpoint still exists (no LLM call, just auth wiring) ----------
class TestScanRegression:
    def test_scan_requires_auth(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/scan", json={"image_base64": "x"})
        assert r.status_code == 401

    def test_scan_requires_image(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/scan", json={"image_base64": ""})
        # Either 400 (empty image) or 500 (LLM key issue) is a valid contract check;
        # 401 would indicate broken auth wiring.
        assert r.status_code in (400, 500), r.text


# ---------- Regression: recurring materialization still works with expanded currency ----------
class TestRecurringRegression:
    def test_recurring_still_materializes(self, auth_client, base_url, mongo):
        from datetime import timedelta
        mongo.expenses.delete_many({"user_id": "user_test_fixture01"})
        mongo.recurring.delete_many({"user_id": "user_test_fixture01"})
        start = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        r = auth_client.post(
            f"{base_url}/api/recurring",
            json={
                "amount": 7.5,
                "currency": "EUR",
                "category": "Bills",
                "merchant": "TEST_Iter3RecurEUR",
                "cadence": "weekly",
                "start_date": start,
            },
        )
        assert r.status_code == 200, r.text
        rec_id = r.json()["recurring_id"]

        exps = auth_client.get(f"{base_url}/api/expenses").json()
        materialized = [e for e in exps if e.get("merchant") == "TEST_Iter3RecurEUR"]
        assert len(materialized) >= 2, f"expected >=2 materialized, got {len(materialized)}"
        for e in materialized:
            assert e["currency"] == "EUR"
            assert abs(e["amount"] - 7.5) < 0.01

        # cleanup
        auth_client.delete(f"{base_url}/api/recurring/{rec_id}")
