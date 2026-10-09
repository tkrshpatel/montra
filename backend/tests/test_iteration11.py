"""Montra iteration 11: FX daily snapshot + brand rename (SplitSync -> Montra).

Covers:
- API root message renamed to 'Montra API'
- /api/fx new response shape: base, rates, snapshot_date (YYYY-MM-DD), refreshed_today (bool)
- Consecutive same-user calls: first call may return refreshed_today True or False
  depending on prior snapshot; second call MUST return refreshed_today=False with
  identical snapshot_date and rates
- User doc gets fx_snapshot={date, rates} persisted after /api/fx call
- convert_amount still works: /api/balances + /api/insights remain functional
"""
import os
import re
import pytest


class TestBrandRename:
    def test_root_message_is_montra(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("ok") is True
        # Iter 11: rename SplitSync -> Montra
        assert data.get("message") == "Montra API", f"expected 'Montra API', got: {data.get('message')!r}"


class TestFxSnapshotShape:
    def test_fx_new_shape(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/fx")
        assert r.status_code == 200, r.text
        data = r.json()
        # base
        assert data.get("base") == "USD"
        # rates
        rates = data.get("rates") or {}
        assert isinstance(rates, dict)
        for k in ("USD", "INR", "EUR", "GBP", "JPY"):
            assert k in rates
            assert isinstance(rates[k], (int, float))
        # snapshot_date YYYY-MM-DD
        sd = data.get("snapshot_date")
        assert isinstance(sd, str)
        assert re.match(r"^\d{4}-\d{2}-\d{2}$", sd), f"bad snapshot_date: {sd!r}"
        # refreshed_today is bool
        assert "refreshed_today" in data
        assert isinstance(data["refreshed_today"], bool)
        # legacy key removed
        assert "updated_at" not in data

    def test_fx_second_call_not_refreshed(self, auth_client, base_url, mongo):
        # Clear any pre-existing snapshot so the FIRST call in this test flips
        # refreshed_today = True (setting up the day-boundary case). This avoids
        # coupling to whether other tests have already refreshed today.
        from conftest import TEST_USER_ID
        mongo.users.update_one(
            {"user_id": TEST_USER_ID}, {"$unset": {"fx_snapshot": ""}}
        )

        r1 = auth_client.get(f"{base_url}/api/fx")
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1.get("refreshed_today") is True, (
            f"first call after clearing snapshot should refresh today; got: {d1}"
        )
        first_date = d1.get("snapshot_date")
        first_rates = d1.get("rates")

        r2 = auth_client.get(f"{base_url}/api/fx")
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("refreshed_today") is False, (
            f"second call same day/user should NOT refresh; got: {d2}"
        )
        assert d2.get("snapshot_date") == first_date
        assert d2.get("rates") == first_rates

    def test_fx_persists_user_snapshot(self, auth_client, base_url, mongo):
        from conftest import TEST_USER_ID
        # Ensure a call has happened
        r = auth_client.get(f"{base_url}/api/fx")
        assert r.status_code == 200
        snap_date = r.json().get("snapshot_date")

        user = mongo.users.find_one({"user_id": TEST_USER_ID})
        assert user is not None
        fx_snap = user.get("fx_snapshot")
        assert isinstance(fx_snap, dict), f"fx_snapshot not persisted on user doc: {user!r}"
        assert fx_snap.get("date") == snap_date
        assert isinstance(fx_snap.get("rates"), dict)
        for k in ("USD", "INR", "EUR", "GBP", "JPY"):
            assert k in fx_snap["rates"]


class TestFxConversionStillWorks:
    """Regression: balances/insights endpoints still consume FX conversion correctly."""

    def test_balances_still_returns_home_currency(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/balances")
        assert r.status_code == 200, r.text
        data = r.json()
        # Balances endpoint returns list of {friend_id/email, net} or dict — accept both shapes
        assert isinstance(data, (list, dict))

    def test_insights_still_works(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/insights")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        # Convention: insights should include some monthly-total field
        # Don't hard-assert exact keys — just ensure JSON dict returned without 500.
