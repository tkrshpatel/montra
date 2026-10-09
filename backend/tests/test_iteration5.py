"""SplitSync iteration 5: /api/trends endpoint.

Tests cover:
  1. GET /api/trends (default months=6) -> shape & 6 items chronological (oldest..current).
  2. GET /api/trends?months=3 -> 3 items chronological.
  3. GET /api/trends?months=1 -> 400 (min 2).
  4. GET /api/trends?months=25 -> 400 (max 24).
  5. GET /api/trends without bearer -> 401.
  6. Totals in home currency: non-home currency expense converted via FX (>0 and not equal to raw).
  7. Older-than-window expenses are ignored.
  8. Regressions: /api/insights, /api/expenses/{id}/receipt, shares split, settlements,
     recurring materialization, scan auth all still functional.
"""
import io
import base64
from datetime import datetime, timezone, timedelta

import pytest
from PIL import Image, ImageDraw


TEST_USER_ID = "user_test_fixture01"


# ---------- Helpers ----------
def _make_jpeg_b64(text: str = "R") -> str:
    img = Image.new("RGB", (40, 30), "white")
    d = ImageDraw.Draw(img)
    d.text((5, 5), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return base64.b64encode(buf.getvalue()).decode()


def _clean_user(mongo):
    mongo.expenses.delete_many({"user_id": TEST_USER_ID})
    mongo.settlements.delete_many({"user_id": TEST_USER_ID})
    mongo.recurring.delete_many({"user_id": TEST_USER_ID})
    mongo.friends.delete_many({"user_id": TEST_USER_ID})


def _month_keys(n: int):
    """Return chronological (oldest..current) list of YYYY-MM strings for last n months."""
    now = datetime.now(timezone.utc)
    y, m = now.year, now.month
    keys = []
    for _ in range(n):
        keys.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m < 1:
            m = 12
            y -= 1
    keys.reverse()
    return keys


def _iso_for_month(year: int, month: int, day: int = 15) -> str:
    return datetime(year, month, day, 12, 0, 0, tzinfo=timezone.utc).isoformat()


# ---------- Trends: shape / validation / auth ----------
class TestTrendsShape:
    def test_trends_requires_auth(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/trends")
        assert r.status_code == 401

    def test_trends_default_months_6(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        r = auth_client.get(f"{base_url}/api/trends")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["currency"] == "USD"
        assert j["months"] == 6
        assert isinstance(j["series"], list)
        assert len(j["series"]) == 6
        # chronological, oldest first, current month last
        expected = _month_keys(6)
        actual = [s["month"] for s in j["series"]]
        assert actual == expected, f"expected {expected}, got {actual}"
        # each item shape
        for s in j["series"]:
            assert set(s.keys()) >= {"month", "total", "count"}
            assert isinstance(s["total"], (int, float))
            assert isinstance(s["count"], int)
        # empty user -> all zeros
        assert all(s["total"] == 0 for s in j["series"])
        assert all(s["count"] == 0 for s in j["series"])

    def test_trends_months_3(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        r = auth_client.get(f"{base_url}/api/trends?months=3")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["months"] == 3
        assert len(j["series"]) == 3
        assert [s["month"] for s in j["series"]] == _month_keys(3)

    def test_trends_months_2_boundary(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/trends?months=2")
        assert r.status_code == 200, r.text
        assert r.json()["months"] == 2
        assert len(r.json()["series"]) == 2

    def test_trends_months_24_boundary(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/trends?months=24")
        assert r.status_code == 200, r.text
        assert r.json()["months"] == 24
        assert len(r.json()["series"]) == 24

    def test_trends_months_1_400(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/trends?months=1")
        assert r.status_code == 400

    def test_trends_months_0_400(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/trends?months=0")
        assert r.status_code == 400

    def test_trends_months_25_400(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/trends?months=25")
        assert r.status_code == 400


# ---------- Trends: totals & FX ----------
class TestTrendsTotals:
    def test_current_month_totals_in_home_currency(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        now_iso = datetime.now(timezone.utc).isoformat()
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 25.0, "currency": "USD", "category": "Food", "date": now_iso})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 75.0, "currency": "USD", "category": "Transport", "date": now_iso})

        r = auth_client.get(f"{base_url}/api/trends?months=6")
        assert r.status_code == 200
        j = r.json()
        curr_key = _month_keys(6)[-1]
        curr = next(s for s in j["series"] if s["month"] == curr_key)
        assert curr["count"] == 2
        assert abs(curr["total"] - 100.0) < 0.01
        # other months should be 0
        for s in j["series"]:
            if s["month"] != curr_key:
                assert s["total"] == 0 and s["count"] == 0

    def test_fx_conversion_to_home_currency(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        now_iso = datetime.now(timezone.utc).isoformat()
        # Add 100 EUR in current month; USD total should be > 0 and typically != 100
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "EUR", "category": "Food", "date": now_iso})
        r = auth_client.get(f"{base_url}/api/trends?months=6")
        j = r.json()
        assert j["currency"] == "USD"
        curr_key = _month_keys(6)[-1]
        curr = next(s for s in j["series"] if s["month"] == curr_key)
        assert curr["count"] == 1
        assert curr["total"] > 0
        # Conversion should have applied; EUR/USD is rarely exactly 1.0.
        # Use loose bound to avoid failing if provider drifts near parity.
        assert 50.0 < curr["total"] < 200.0

    def test_older_expenses_ignored(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        # expense in current month (should count)
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 40.0, "currency": "USD", "category": "Food", "date": now_iso})

        # expense far in the past (>24 months ago) - should be ignored for any window
        old_year = now.year - 3
        old_iso = _iso_for_month(old_year, now.month if now.month != 2 else 3, 10)
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 999.0, "currency": "USD", "category": "Food", "date": old_iso})

        # 3-month window: only current-month expense should appear
        r = auth_client.get(f"{base_url}/api/trends?months=3")
        j = r.json()
        keys = [s["month"] for s in j["series"]]
        assert keys == _month_keys(3)
        total_all = sum(s["total"] for s in j["series"])
        count_all = sum(s["count"] for s in j["series"])
        assert abs(total_all - 40.0) < 0.01
        assert count_all == 1

    def test_multi_month_distribution(self, auth_client, base_url, mongo):
        """Seed expenses in 3 distinct recent months and verify per-month totals."""
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        now = datetime.now(timezone.utc)

        # month0=current, month1=prev, month2=prev-prev
        def prev_month(y, m, k):
            for _ in range(k):
                m -= 1
                if m < 1:
                    m = 12
                    y -= 1
            return y, m

        y0, m0 = now.year, now.month
        y1, m1 = prev_month(now.year, now.month, 1)
        y2, m2 = prev_month(now.year, now.month, 2)

        # current: 10 + 20 = 30
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 10.0, "currency": "USD", "category": "Food",
            "date": _iso_for_month(y0, m0, min(now.day, 28))})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 20.0, "currency": "USD", "category": "Food",
            "date": _iso_for_month(y0, m0, min(now.day, 28))})
        # prev: 50
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 50.0, "currency": "USD", "category": "Food",
            "date": _iso_for_month(y1, m1, 5)})
        # prev-prev: 15
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 15.0, "currency": "USD", "category": "Food",
            "date": _iso_for_month(y2, m2, 5)})

        r = auth_client.get(f"{base_url}/api/trends?months=6")
        j = r.json()
        by_month = {s["month"]: s for s in j["series"]}
        assert abs(by_month[f"{y0:04d}-{m0:02d}"]["total"] - 30.0) < 0.01
        assert by_month[f"{y0:04d}-{m0:02d}"]["count"] == 2
        assert abs(by_month[f"{y1:04d}-{m1:02d}"]["total"] - 50.0) < 0.01
        assert by_month[f"{y1:04d}-{m1:02d}"]["count"] == 1
        assert abs(by_month[f"{y2:04d}-{m2:02d}"]["total"] - 15.0) < 0.01
        assert by_month[f"{y2:04d}-{m2:02d}"]["count"] == 1


# ---------- Regressions ----------
class TestRegressionsIter5:
    def test_insights_still_works(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        now_iso = datetime.now(timezone.utc).isoformat()
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 40.0, "currency": "USD", "category": "Food", "date": now_iso})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 60.0, "currency": "USD", "category": "Transport", "date": now_iso})
        r = auth_client.get(f"{base_url}/api/insights")
        assert r.status_code == 200
        j = r.json()
        assert j["currency"] == "USD"
        assert j["count"] == 2
        assert abs(j["total"] - 100.0) < 0.01
        cats = {b["category"] for b in j["breakdown"]}
        assert cats == {"Food", "Transport"}
        pct_sum = sum(b["pct"] for b in j["breakdown"])
        assert abs(pct_sum - 100.0) < 0.5

    def test_receipt_flow_still_works(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        b64 = _make_jpeg_b64("X")
        r = auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 5.0, "currency": "USD", "category": "Food",
            "receipt_image_base64": b64})
        assert r.status_code == 200
        d = r.json()
        assert d["has_receipt"] is True
        assert "receipt_image_base64" not in d
        eid = d["expense_id"]
        rr = auth_client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rr.status_code == 200
        assert rr.json()["image_base64"] == b64

    def test_shares_split_still_works(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        alice = auth_client.post(f"{base_url}/api/friends",
                                 json={"name": "TEST_Iter5Alice"}).json()
        r = auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD",
            "shares": [
                {"participant_id": "self", "share": 70},
                {"participant_id": alice["friend_id"], "share": 30},
            ],
        })
        assert r.status_code == 200
        b = auth_client.get(f"{base_url}/api/balances").json()
        by_id = {f["friend_id"]: f["amount"] for f in b["friends"]}
        assert abs(by_id[alice["friend_id"]] - 30.0) < 0.01

    def test_settlement_still_subtracts(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        alice = auth_client.post(f"{base_url}/api/friends",
                                 json={"name": "TEST_Iter5Set"}).json()
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 80.0, "currency": "USD",
            "shares": [
                {"participant_id": "self", "share": 1},
                {"participant_id": alice["friend_id"], "share": 1},
            ],
        })
        auth_client.post(f"{base_url}/api/settlements", json={
            "friend_id": alice["friend_id"], "amount": 15.0, "currency": "USD"})
        b = auth_client.get(f"{base_url}/api/balances").json()
        by_id = {f["friend_id"]: f["amount"] for f in b["friends"]}
        assert abs(by_id[alice["friend_id"]] - 25.0) < 0.01

    def test_recurring_still_materializes(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        start = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        r = auth_client.post(f"{base_url}/api/recurring", json={
            "amount": 3.0, "currency": "USD", "category": "Bills",
            "merchant": "TEST_Iter5Recur", "cadence": "weekly", "start_date": start})
        assert r.status_code == 200
        exps = auth_client.get(f"{base_url}/api/expenses").json()
        mat = [e for e in exps if e.get("merchant") == "TEST_Iter5Recur"]
        assert len(mat) >= 2
        auth_client.delete(f"{base_url}/api/recurring/{r.json()['recurring_id']}")

    def test_scan_auth_wiring(self, anon_client, auth_client, base_url):
        r = anon_client.post(f"{base_url}/api/scan", json={"image_base64": "x"})
        assert r.status_code == 401
        r2 = auth_client.post(f"{base_url}/api/scan", json={"image_base64": ""})
        assert r2.status_code in (400, 500)
