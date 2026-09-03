"""SplitSync iteration 4: photo attachments on expenses + monthly insights.

Tests cover:
  1. POST /api/expenses with `receipt_image_base64` -> has_receipt=true & image retrievable.
  2. POST /api/expenses without receipt -> has_receipt=false; receipt fetch -> 404.
  3. GET /api/expenses/{id}/receipt for unknown id -> 404.
  4. GET /api/expenses list response never leaks `receipt_image_base64`.
  5. GET /api/insights (no month) defaults to current month; breakdown sorted desc; pct ~100.
  6. GET /api/insights?month=YYYY-MM converts non-home currencies via live FX.
  7. GET /api/insights?month=invalid -> 400.
  8. GET /api/insights without bearer -> 401.
  9. Regression: shares split, settlement subtract, recurring materialization, scan auth.
"""
import io
import base64
from datetime import datetime, timezone, timedelta

import pytest
from PIL import Image, ImageDraw


TEST_USER_ID = "user_test_fixture01"


# ---------- Helpers ----------
def _make_jpeg_b64(text: str = "RCPT") -> str:
    img = Image.new("RGB", (60, 40), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([5, 5, 55, 35], outline="black", width=2)
    d.line([5, 5, 55, 35], fill="blue", width=2)
    d.line([55, 5, 5, 35], fill="red", width=2)
    d.text((10, 15), text, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=70)
    return base64.b64encode(buf.getvalue()).decode()


def _clean_user(mongo):
    mongo.expenses.delete_many({"user_id": TEST_USER_ID})
    mongo.settlements.delete_many({"user_id": TEST_USER_ID})
    mongo.recurring.delete_many({"user_id": TEST_USER_ID})
    mongo.friends.delete_many({"user_id": TEST_USER_ID})


# ---------- Photo attachments ----------
class TestReceiptAttachments:
    def test_create_expense_with_receipt(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        # ensure USD home for deterministic behavior later
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        b64 = _make_jpeg_b64("A")
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={"amount": 12.5, "currency": "USD", "category": "Food",
                  "receipt_image_base64": b64},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("has_receipt") is True, f"expected has_receipt True, got {d}"
        # response must NOT include the base64
        assert "receipt_image_base64" not in d, "receipt_image_base64 leaked in POST response"
        eid = d["expense_id"]

        # list should show has_receipt True and never include base64 field
        lst = auth_client.get(f"{base_url}/api/expenses").json()
        rec = next((e for e in lst if e["expense_id"] == eid), None)
        assert rec is not None, "created expense not in list"
        assert rec["has_receipt"] is True
        for e in lst:
            assert "receipt_image_base64" not in e, "list leaks receipt_image_base64"

        # fetch receipt
        rr = auth_client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rr.status_code == 200, rr.text
        body = rr.json()
        assert body.get("image_base64") == b64, "returned base64 does not match stored"
        assert body.get("mime_type"), "mime_type missing"

    def test_create_expense_without_receipt(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={"amount": 8.0, "currency": "USD", "category": "Other"},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("has_receipt") is False
        eid = d["expense_id"]

        # list has_receipt false
        lst = auth_client.get(f"{base_url}/api/expenses").json()
        rec = next((e for e in lst if e["expense_id"] == eid), None)
        assert rec is not None and rec["has_receipt"] is False

        # receipt fetch should 404 with 'No receipt attached'
        rr = auth_client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rr.status_code == 404
        assert "No receipt attached" in rr.text

    def test_receipt_fetch_unknown_id_404(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/expenses/exp_does_not_exist_xyz/receipt")
        assert r.status_code == 404

    def test_receipt_requires_auth(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/expenses/any/receipt")
        assert r.status_code == 401


# ---------- Insights ----------
class TestInsights:
    def _seed_expenses(self, auth_client, base_url):
        """Seed 3 Jan 2026 expenses across 2 categories, mixed currencies."""
        jan = "2026-01-15T12:00:00+00:00"
        # USD 100 Food
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food", "date": jan,
        })
        # USD 40 Food
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 40.0, "currency": "USD", "category": "Food", "date": jan,
        })
        # EUR 50 Transport (converted via FX)
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 50.0, "currency": "EUR", "category": "Transport", "date": jan,
        })

    def test_insights_auth_required(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/insights")
        assert r.status_code == 401

    def test_insights_invalid_month_400(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/insights?month=invalid")
        assert r.status_code == 400
        r2 = auth_client.get(f"{base_url}/api/insights?month=2026-13")
        assert r2.status_code == 400
        r3 = auth_client.get(f"{base_url}/api/insights?month=2026-00")
        assert r3.status_code == 400

    def test_insights_default_month_shape(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        # seed a couple expenses in current month
        now_iso = datetime.now(timezone.utc).isoformat()
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 30.0, "currency": "USD", "category": "Food", "date": now_iso})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 70.0, "currency": "USD", "category": "Transport", "date": now_iso})

        r = auth_client.get(f"{base_url}/api/insights")
        assert r.status_code == 200, r.text
        j = r.json()
        # month is current
        now = datetime.now(timezone.utc)
        assert j["month"] == f"{now.year:04d}-{now.month:02d}"
        assert j["currency"] == "USD"
        assert j["count"] == 2
        assert abs(j["total"] - 100.0) < 0.01
        br = j["breakdown"]
        assert isinstance(br, list) and len(br) == 2
        # sorted desc by amount
        assert br[0]["amount"] >= br[1]["amount"]
        assert br[0]["category"] == "Transport"
        # pct sums to ~100
        pct_sum = sum(x["pct"] for x in br)
        assert abs(pct_sum - 100.0) < 0.5, f"pct sum {pct_sum}"

    def test_insights_specific_month_with_fx(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        self._seed_expenses(auth_client, base_url)

        r = auth_client.get(f"{base_url}/api/insights?month=2026-01")
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["month"] == "2026-01"
        assert j["currency"] == "USD"
        assert j["count"] == 3
        # Food = 140 USD; Transport = 50 EUR converted to USD. EUR/USD ~1.05-1.15 typically -> ~50-60 USD.
        cats = {b["category"]: b for b in j["breakdown"]}
        assert "Food" in cats and "Transport" in cats
        assert abs(cats["Food"]["amount"] - 140.0) < 0.01
        # Transport converted: expect a positive amount not equal to 50 (unless EUR happens to be 1.0)
        assert cats["Transport"]["amount"] > 0
        # breakdown sorted desc
        amounts = [b["amount"] for b in j["breakdown"]]
        assert amounts == sorted(amounts, reverse=True)
        # pct sums ~100
        pct_sum = sum(b["pct"] for b in j["breakdown"])
        assert abs(pct_sum - 100.0) < 0.5
        # total matches sum of category amounts (within rounding)
        assert abs(j["total"] - sum(b["amount"] for b in j["breakdown"])) < 0.5

    def test_insights_excludes_other_months(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD", "category": "Food",
            "date": "2026-01-05T00:00:00+00:00"})
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 200.0, "currency": "USD", "category": "Food",
            "date": "2026-02-05T00:00:00+00:00"})
        r = auth_client.get(f"{base_url}/api/insights?month=2026-01")
        j = r.json()
        assert j["count"] == 1
        assert abs(j["total"] - 100.0) < 0.01

    def test_insights_empty_month(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        r = auth_client.get(f"{base_url}/api/insights?month=2020-06")
        assert r.status_code == 200
        j = r.json()
        assert j["count"] == 0
        assert j["total"] == 0
        assert j["breakdown"] == []


# ---------- Regressions ----------
class TestRegressionsIter4:
    def test_shares_split_still_works(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        alice = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_Iter4Alice"}).json()
        r = auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 100.0, "currency": "USD",
            "shares": [
                {"participant_id": "self", "share": 60},
                {"participant_id": alice["friend_id"], "share": 40},
            ],
        })
        assert r.status_code == 200
        b = auth_client.get(f"{base_url}/api/balances").json()
        by_id = {f["friend_id"]: f["amount"] for f in b["friends"]}
        assert abs(by_id[alice["friend_id"]] - 40.0) < 0.01

    def test_settlement_subtracts(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})
        alice = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_Iter4Set"}).json()
        auth_client.post(f"{base_url}/api/expenses", json={
            "amount": 60.0, "currency": "USD",
            "shares": [
                {"participant_id": "self", "share": 1},
                {"participant_id": alice["friend_id"], "share": 1},
            ],
        })
        auth_client.post(f"{base_url}/api/settlements", json={
            "friend_id": alice["friend_id"], "amount": 10.0, "currency": "USD"})
        b = auth_client.get(f"{base_url}/api/balances").json()
        by_id = {f["friend_id"]: f["amount"] for f in b["friends"]}
        assert abs(by_id[alice["friend_id"]] - 20.0) < 0.01

    def test_recurring_materialization(self, auth_client, base_url, mongo):
        _clean_user(mongo)
        start = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        r = auth_client.post(f"{base_url}/api/recurring", json={
            "amount": 5.0, "currency": "USD", "category": "Bills",
            "merchant": "TEST_Iter4Recur", "cadence": "weekly", "start_date": start,
        })
        assert r.status_code == 200
        exps = auth_client.get(f"{base_url}/api/expenses").json()
        mat = [e for e in exps if e.get("merchant") == "TEST_Iter4Recur"]
        assert len(mat) >= 2
        # cleanup
        auth_client.delete(f"{base_url}/api/recurring/{r.json()['recurring_id']}")

    def test_scan_auth_wiring(self, anon_client, auth_client, base_url):
        r = anon_client.post(f"{base_url}/api/scan", json={"image_base64": "x"})
        assert r.status_code == 401
        r2 = auth_client.post(f"{base_url}/api/scan", json={"image_base64": ""})
        assert r2.status_code in (400, 500)
