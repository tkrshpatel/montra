"""SplitSync backend API tests"""
import base64
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")


# ---------- Health ----------
class TestHealth:
    def test_root(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ---------- Auth ----------
class TestAuth:
    def test_session_missing_session_id(self, anon_client, base_url):
        # Empty body -> Pydantic validation 422
        r = anon_client.post(f"{base_url}/api/auth/session", json={})
        assert r.status_code in (400, 422)

    def test_session_empty_string_session_id(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/auth/session", json={"session_id": ""})
        assert r.status_code in (400, 401)

    def test_session_invalid_session_id(self, anon_client, base_url):
        r = anon_client.post(
            f"{base_url}/api/auth/session",
            json={"session_id": "invalid_bogus_session_id_123"},
        )
        assert r.status_code == 401

    def test_me_no_auth(self, anon_client, base_url):
        r = anon_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token(self, anon_client, base_url):
        r = requests.get(
            f"{base_url}/api/auth/me",
            headers={"Authorization": "Bearer notreal"},
        )
        assert r.status_code == 401

    def test_me_valid(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["email"].startswith("TEST_")
        assert data["currency"] in ("USD", "INR")

    def test_currency_update_valid(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "INR"})
        assert r.status_code == 200
        assert r.json()["currency"] == "INR"
        # Verify via GET
        me = auth_client.get(f"{base_url}/api/auth/me").json()
        assert me["currency"] == "INR"
        # revert
        auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "USD"})

    def test_currency_update_invalid(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/auth/currency", json={"currency": "EUR"})
        assert r.status_code == 400


# ---------- Friends ----------
class TestFriends:
    friend_id = None

    def test_create_friend(self, auth_client, base_url):
        r = auth_client.post(
            f"{base_url}/api/friends",
            json={"name": "TEST_Alice", "email": "TEST_alice@example.com"},
        )
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "TEST_Alice"
        assert data["friend_id"].startswith("frd_")
        TestFriends.friend_id = data["friend_id"]

    def test_list_friends_contains_created(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/friends")
        assert r.status_code == 200
        ids = [f["friend_id"] for f in r.json()]
        assert TestFriends.friend_id in ids

    def test_friends_require_auth(self, anon_client, base_url):
        assert anon_client.get(f"{base_url}/api/friends").status_code == 401
        assert anon_client.post(f"{base_url}/api/friends", json={"name": "x"}).status_code == 401

    def test_delete_friend_not_found(self, auth_client, base_url):
        r = auth_client.delete(f"{base_url}/api/friends/frd_doesnotexist")
        assert r.status_code == 404


# ---------- Expenses + Balances ----------
class TestExpensesAndBalances:
    friend_a = None
    friend_b = None
    expense_id = None

    def test_setup_friends(self, auth_client, base_url):
        a = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_Bob"}).json()
        b = auth_client.post(f"{base_url}/api/friends", json={"name": "TEST_Carol"}).json()
        TestExpensesAndBalances.friend_a = a["friend_id"]
        TestExpensesAndBalances.friend_b = b["friend_id"]
        assert a["friend_id"] and b["friend_id"]

    def test_create_expense_split(self, auth_client, base_url):
        payload = {
            "amount": 90.0,
            "currency": "USD",
            "category": "Food",
            "merchant": "TEST_Diner",
            "split_with": [self.friend_a, self.friend_b],
        }
        r = auth_client.post(f"{base_url}/api/expenses", json=payload)
        assert r.status_code == 200
        data = r.json()
        assert data["amount"] == 90.0
        assert data["is_split"] is True
        assert set(data["split_with"]) == {self.friend_a, self.friend_b}
        TestExpensesAndBalances.expense_id = data["expense_id"]

    def test_list_expenses(self, auth_client, base_url):
        r = auth_client.get(f"{base_url}/api/expenses")
        assert r.status_code == 200
        ids = [e["expense_id"] for e in r.json()]
        assert TestExpensesAndBalances.expense_id in ids

    def test_balances_computation(self, auth_client, base_url):
        # amount=90, split_with 2 friends -> share = 90/(1+2) = 30 each
        r = auth_client.get(f"{base_url}/api/balances")
        assert r.status_code == 200
        data = r.json()
        assert data["currency"] in ("USD", "INR")
        # total owed = 30 + 30 = 60
        assert abs(data["total_owed_to_me"] - 60.0) < 0.01
        by_id = {f["friend_id"]: f["amount"] for f in data["friends"]}
        assert abs(by_id.get(self.friend_a, 0) - 30.0) < 0.01
        assert abs(by_id.get(self.friend_b, 0) - 30.0) < 0.01

    def test_expenses_require_auth(self, anon_client, base_url):
        assert anon_client.get(f"{base_url}/api/expenses").status_code == 401
        assert anon_client.get(f"{base_url}/api/balances").status_code == 401


# ---------- Scan (Gemini 3 Flash) ----------
def _make_receipt_png_b64() -> str:
    """Render a real receipt-looking PNG using Pillow so it has real visual features."""
    from PIL import Image, ImageDraw, ImageFont
    img = Image.new("RGB", (480, 640), color=(255, 255, 255))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
    except Exception:
        font = ImageFont.load_default()
        small = ImageFont.load_default()
    d.text((140, 20), "STARBUCKS COFFEE", fill=(0, 0, 0), font=font)
    d.text((160, 60), "123 Main Street", fill=(30, 30, 30), font=small)
    d.line((20, 100, 460, 100), fill=(0, 0, 0), width=2)
    d.text((30, 120), "Latte           4.50", fill=(0, 0, 0), font=small)
    d.text((30, 150), "Croissant       3.20", fill=(0, 0, 0), font=small)
    d.text((30, 180), "Muffin          2.80", fill=(0, 0, 0), font=small)
    d.line((20, 220, 460, 220), fill=(0, 0, 0), width=2)
    d.text((30, 240), "Subtotal       10.50", fill=(0, 0, 0), font=small)
    d.text((30, 270), "Tax             0.95", fill=(0, 0, 0), font=small)
    d.text((30, 310), "TOTAL          11.45 USD", fill=(0, 0, 0), font=font)
    d.text((30, 360), "Date: 2026-01-15", fill=(0, 0, 0), font=small)
    d.text((30, 390), "Thank you!", fill=(100, 100, 100), font=small)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class TestScan:
    def test_scan_requires_auth(self, anon_client, base_url):
        r = anon_client.post(f"{base_url}/api/scan", json={"image_base64": "abc"})
        assert r.status_code == 401

    def test_scan_missing_image(self, auth_client, base_url):
        r = auth_client.post(f"{base_url}/api/scan", json={"image_base64": ""})
        assert r.status_code == 400

    def test_scan_real_receipt(self, auth_client, base_url):
        b64 = _make_receipt_png_b64()
        r = auth_client.post(
            f"{base_url}/api/scan",
            json={"image_base64": b64, "mime_type": "image/png"},
            timeout=60,
        )
        assert r.status_code == 200, f"scan failed: {r.status_code} {r.text[:400]}"
        data = r.json()
        # At minimum a raw response should be present
        assert "raw" in data
        # Prefer that amount/merchant/currency were parsed – log if not
        if data.get("amount") is not None:
            assert isinstance(data["amount"], (int, float))
        print("SCAN RESULT:", {k: data.get(k) for k in ("amount", "currency", "merchant", "date", "category")})
