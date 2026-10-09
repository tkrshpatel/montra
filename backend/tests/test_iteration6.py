"""SplitSync iteration 6: security hardening.

Covers:
  1. POST /api/scan size cap (413) — LLM NOT called.
  2. POST /api/scan per-user hourly rate limit -> 21st call 429; separate
     user still gets 200.
  3. POST /api/scan LLM failure surface — 502 generic, no stack details.
  4. POST /api/expenses amount<=0 -> 400.
  5. POST /api/expenses invalid currency -> 400.
  6. POST /api/expenses receipt oversize -> 413.
  7. POST /api/expenses valid USD amount=10 (regression) -> 200.
  8. POST /api/recurring amount<=0/currency/cadence -> 400; valid monthly USD -> 200.
  9. CORS preflight: allow_credentials false/absent; methods list GET/POST/DELETE/OPTIONS.
 10. Regression battery of read endpoints.
"""
import io
import os
import time
import uuid
import base64
from datetime import datetime, timezone, timedelta

import pytest
import requests
from PIL import Image, ImageDraw


TEST_USER_ID = "user_test_fixture01"
RL_TOKEN = "TEST_scan_rl_token_iter6"
RL_USER_ID = "TEST_scan_rl_user_iter6"
RL_EMAIL = "TEST_scan_rl_iter6@example.com"


# ---------- Helpers ----------
def _tiny_jpeg_b64() -> str:
    """A small but real JPEG (features + text) well under the size cap."""
    img = Image.new("RGB", (48, 32), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([2, 2, 45, 29], outline="black")
    d.text((6, 10), "R6", fill="black")
    d.line([(0, 0), (47, 31)], fill="red", width=1)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return base64.b64encode(buf.getvalue()).decode()


def _oversize_b64() -> str:
    # Just past MAX_RECEIPT_B64_LEN (5_500_000).
    return "A" * 5_500_001


def _clean_user(mongo, uid: str = TEST_USER_ID):
    mongo.expenses.delete_many({"user_id": uid})
    mongo.recurring.delete_many({"user_id": uid})


# ---------- Fixture: seed a second user just for rate-limit tests ----------
@pytest.fixture(scope="module")
def rl_user(mongo):
    now = datetime.now(timezone.utc)
    mongo.users.update_one(
        {"email": RL_EMAIL},
        {"$set": {
            "user_id": RL_USER_ID, "email": RL_EMAIL,
            "name": "RL Tester", "picture": None,
            "currency": "USD", "created_at": now.isoformat(),
        }},
        upsert=True,
    )
    mongo.user_sessions.update_one(
        {"session_token": RL_TOKEN},
        {"$set": {
            "session_token": RL_TOKEN, "user_id": RL_USER_ID,
            "expires_at": now + timedelta(days=1),
            "created_at": now,
        }},
        upsert=True,
    )
    yield RL_TOKEN
    mongo.users.delete_many({"user_id": RL_USER_ID})
    mongo.user_sessions.delete_many({"session_token": RL_TOKEN})
    mongo.expenses.delete_many({"user_id": RL_USER_ID})


# =============================================================
# 1. Scan size cap (413) — LLM must NOT be called (short latency)
# =============================================================
class TestScanSizeCap:
    def test_scan_oversize_returns_413(self, base_url, auth_client):
        t0 = time.time()
        r = auth_client.post(
            f"{base_url}/api/scan",
            json={"image_base64": _oversize_b64(), "mime_type": "image/jpeg"},
            timeout=30,
        )
        dt = time.time() - t0
        assert r.status_code == 413, r.text
        body = r.json()
        assert "too large" in (body.get("detail") or "").lower()
        # LLM call would add multiple seconds; size-cap short-circuit should be fast.
        assert dt < 8.0, f"Size-cap path took {dt:.1f}s — LLM may have been called"

    def test_scan_missing_image_returns_400(self, base_url, auth_client):
        r = auth_client.post(
            f"{base_url}/api/scan",
            json={"image_base64": "", "mime_type": "image/jpeg"},
            timeout=15,
        )
        assert r.status_code == 400, r.text


# =============================================================
# 2. Rate limit — 21st call in an hour → 429; separate user unaffected
# =============================================================
class TestScanRateLimit:
    def test_rate_limit_kicks_in_at_21st(self, base_url, rl_user, mongo):
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {rl_user}",
        }
        img = _tiny_jpeg_b64()
        # Consume all 20 allowed slots.
        ok = 0
        first_fail = None
        for i in range(20):
            r = requests.post(
                f"{base_url}/api/scan",
                json={"image_base64": img, "mime_type": "image/jpeg"},
                headers=headers, timeout=60,
            )
            if r.status_code == 200:
                ok += 1
            elif r.status_code == 429:
                first_fail = i + 1
                break
            elif r.status_code == 502:
                # Transient LLM hiccup — still consumed a slot (see server code:
                # slot append happens BEFORE llm call). Count it as consumed.
                ok += 1
            else:
                pytest.fail(f"Unexpected status {r.status_code} at call {i+1}: {r.text}")
        assert first_fail is None, f"Rate-limited too early at call {first_fail} (only {ok} ok)"
        assert ok == 20, f"Expected 20 slots consumed, got {ok}"

        # 21st call must be 429.
        r21 = requests.post(
            f"{base_url}/api/scan",
            json={"image_base64": img, "mime_type": "image/jpeg"},
            headers=headers, timeout=30,
        )
        assert r21.status_code == 429, f"21st call expected 429, got {r21.status_code}: {r21.text}"
        detail = (r21.json().get("detail") or "").lower()
        assert "rate" in detail or "limit" in detail

    def test_other_user_not_rate_limited(self, base_url, auth_client):
        """Primary test user has its own hourly bucket."""
        img = _tiny_jpeg_b64()
        r = auth_client.post(
            f"{base_url}/api/scan",
            json={"image_base64": img, "mime_type": "image/jpeg"},
            timeout=60,
        )
        # Accept 200 or 502 (LLM transient); 429 would be a bug.
        assert r.status_code in (200, 502), f"Unexpected {r.status_code}: {r.text}"
        assert r.status_code != 429


# =============================================================
# 3. LLM failure surface — generic 502, no internal detail leaked
# =============================================================
class TestScanLLMFailureSurface:
    def test_generic_502_on_llm_error_no_stack(self, base_url, auth_client):
        # Non-image bytes; upstream Gemini/OCR should reject and library raises.
        # We accept 200 (LLM tolerated garbage) or 502 (expected). If 502, the
        # detail must be generic — no path, "Traceback", or "Exception".
        garbage = base64.b64encode(os.urandom(4096)).decode()
        r = auth_client.post(
            f"{base_url}/api/scan",
            json={"image_base64": garbage, "mime_type": "image/jpeg"},
            timeout=60,
        )
        body_text = r.text or ""
        # No stack traces / server internals in ANY response body
        for leak in ("Traceback", "/app/backend/server.py", "\n  File \""):
            assert leak not in body_text, f"Leaked '{leak}' in body: {body_text[:400]}"
        if r.status_code == 502:
            # Try to parse JSON detail; tolerate non-JSON but require generic text
            try:
                detail = (r.json().get("detail") or "")
            except Exception:
                detail = body_text
            low = detail.lower()
            assert "extraction failed" in low or "ai extraction" in low or "bad gateway" in low, \
                f"502 detail not generic: {detail[:200]}"
        else:
            # LLM tolerated garbage or already rate-limited — acceptable.
            assert r.status_code in (200, 429, 400), f"Unexpected {r.status_code}: {body_text[:200]}"


# =============================================================
# 4-7. Expense validation
# =============================================================
class TestExpenseValidation:
    def test_amount_zero_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/expenses",
                             json={"amount": 0, "currency": "USD", "category": "Food"})
        assert r.status_code == 400
        assert "> 0" in (r.json().get("detail") or "")

    def test_amount_negative_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/expenses",
                             json={"amount": -1, "currency": "USD", "category": "Food"})
        assert r.status_code == 400
        assert "> 0" in (r.json().get("detail") or "")

    def test_currency_xyz_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/expenses",
                             json={"amount": 10, "currency": "XYZ", "category": "Food"})
        assert r.status_code == 400
        d = (r.json().get("detail") or "").lower()
        # Must mention 'currency' and enumerate supported ones.
        assert "currency" in d
        assert any(c in d for c in ("usd", "inr", "eur", "gbp", "jpy"))

    def test_receipt_oversize_413(self, base_url, auth_client):
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={
                "amount": 12.34, "currency": "USD", "category": "Food",
                "receipt_image_base64": _oversize_b64(),
            },
            timeout=30,
        )
        assert r.status_code == 413, r.text
        assert "too large" in (r.json().get("detail") or "").lower()

    def test_valid_usd_10_still_works(self, base_url, auth_client, mongo):
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={"amount": 10, "currency": "USD", "category": "Food",
                  "merchant": "TEST_iter6_regression", "notes": "TEST_iter6"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["amount"] == 10
        assert data["currency"] == "USD"
        assert data["category"] == "Food"
        assert data["expense_id"].startswith("exp_")
        # GET to verify persistence
        lst = auth_client.get(f"{base_url}/api/expenses").json()
        assert any(e["expense_id"] == data["expense_id"] for e in lst)
        # Cleanup
        auth_client.delete(f"{base_url}/api/expenses/{data['expense_id']}")


# =============================================================
# 8. Recurring validation
# =============================================================
class TestRecurringValidation:
    def test_amount_zero_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/recurring",
                             json={"amount": 0, "currency": "USD", "cadence": "monthly"})
        assert r.status_code == 400

    def test_amount_negative_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/recurring",
                             json={"amount": -5, "currency": "USD", "cadence": "monthly"})
        assert r.status_code == 400

    def test_currency_xyz_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/recurring",
                             json={"amount": 5, "currency": "XYZ", "cadence": "monthly"})
        assert r.status_code == 400
        assert "currency" in (r.json().get("detail") or "").lower()

    def test_cadence_daily_400(self, base_url, auth_client):
        r = auth_client.post(f"{base_url}/api/recurring",
                             json={"amount": 5, "currency": "USD", "cadence": "daily"})
        assert r.status_code == 400
        assert "cadence" in (r.json().get("detail") or "").lower()

    def test_valid_monthly_usd(self, base_url, auth_client, mongo):
        _clean_user(mongo)
        r = auth_client.post(
            f"{base_url}/api/recurring",
            json={"amount": 15.0, "currency": "USD", "cadence": "monthly",
                  "category": "Bills", "merchant": "TEST_iter6_rec"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["amount"] == 15.0
        assert data["currency"] == "USD"
        assert data["cadence"] == "monthly"
        rid = data["recurring_id"]
        # GET to verify persistence
        rl = auth_client.get(f"{base_url}/api/recurring").json()
        assert any(x["recurring_id"] == rid for x in rl)
        auth_client.delete(f"{base_url}/api/recurring/{rid}")
        _clean_user(mongo)


# =============================================================
# 9. CORS preflight — allow_credentials must be false/absent
# =============================================================
class TestCORSPreflight:
    def test_options_preflight_no_credentials(self, base_url):
        r = requests.options(
            f"{base_url}/api/expenses",
            headers={
                "Origin": "https://x.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
            timeout=15,
        )
        # 200 or 204 accepted for preflight
        assert r.status_code in (200, 204), f"Preflight status {r.status_code}: {r.text}"
        headers_lc = {k.lower(): v for k, v in r.headers.items()}
        # ACAO must be * (open, credential-less)
        assert headers_lc.get("access-control-allow-origin") == "*", headers_lc
        # ACAC MUST be absent or false
        acac = headers_lc.get("access-control-allow-credentials")
        assert acac is None or acac.lower() == "false", \
            f"allow-credentials must not be true, got: {acac}"
        # Methods must include GET, POST, DELETE, OPTIONS
        methods = (headers_lc.get("access-control-allow-methods") or "").upper()
        for m in ("GET", "POST", "DELETE", "OPTIONS"):
            assert m in methods, f"Preflight missing method {m}, got: {methods}"


# =============================================================
# 10. Regression battery for read endpoints
# =============================================================
class TestRegressionBattery:
    def test_auth_me(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        assert r.json()["user_id"] == TEST_USER_ID

    def test_friends_list(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/friends")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_groups_list(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/groups")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_settlements_list(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/settlements")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_expenses_list(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/expenses")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_insights(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/insights")
        assert r.status_code == 200
        body = r.json()
        for k in ("month", "currency", "total", "count", "breakdown"):
            assert k in body

    def test_trends(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/trends")
        assert r.status_code == 200
        body = r.json()
        assert body["months"] == 6
        assert len(body["series"]) == 6

    def test_fx(self, base_url, auth_client):
        r = auth_client.get(f"{base_url}/api/fx")
        assert r.status_code == 200
        rates = r.json()["rates"]
        for c in ("USD", "INR", "EUR", "GBP", "JPY"):
            assert c in rates

    def test_expense_receipt_flow(self, base_url, auth_client, mongo):
        # Create expense w/ small receipt
        img = _tiny_jpeg_b64()
        r = auth_client.post(
            f"{base_url}/api/expenses",
            json={"amount": 3.5, "currency": "USD", "category": "Food",
                  "receipt_image_base64": img, "notes": "TEST_iter6_receipt"},
        )
        assert r.status_code == 200, r.text
        eid = r.json()["expense_id"]
        # Response must NOT contain the base64 payload
        assert "receipt_image_base64" not in r.json()
        # GET receipt
        rec = auth_client.get(f"{base_url}/api/expenses/{eid}/receipt")
        assert rec.status_code == 200
        body = rec.json()
        assert body["image_base64"] == img
        assert body["mime_type"] == "image/jpeg"
        # Cleanup
        auth_client.delete(f"{base_url}/api/expenses/{eid}")
