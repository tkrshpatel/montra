"""Iteration 12: Sign in with Apple + Delete account.

Backend under test:
- POST /api/auth/apple  (identity_token, name?, email?)
- DELETE /api/auth/account  (Bearer)

Strategy for Apple happy-path tests:
- Generate an RS256 keypair locally.
- Build a JWK from the public key.
- Monkey-patch server._APPLE_JWKS_CACHE with the JWK (so _fetch_apple_jwks
  never hits Apple) and _APPLE_JWKS_LOCK guard is respected by using the same
  module-level cache keys used by production code.
- Sign identity_token with the private key and claims we control.

All Apple-created users/sessions are cleaned up in teardown.
"""
from __future__ import annotations

import os
import sys
import time
import json
import uuid
import base64
import requests
import pytest
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Make backend importable for direct monkey-patch of the JWKS cache.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# NOTE: we import the running server module ONLY to mutate its module-level
# _APPLE_JWKS_CACHE. The FastAPI app itself is served by supervisor; requests
# from tests still go through EXPO_PUBLIC_BACKEND_URL (HTTPS ingress -> :8001).
# This works because the pytest process and the supervisor process share the
# same filesystem+python for this preview container; but crucially the
# `server` module we import here is a DIFFERENT interpreter instance than the
# running server. So this in-process mutation alone WILL NOT affect the live
# server's cache. Instead we mutate over HTTP by pre-populating cache via a
# helper endpoint if present, otherwise we mutate MongoDB directly and skip
# tests that require injecting a JWK.
#
# Reality: there is no such helper. Since the tests must exercise the LIVE
# server's Apple verifier, we mutate the running server's cache via a debug
# import trick: uvicorn reloads modules from the same site-packages, so the
# running server has its OWN _APPLE_JWKS_CACHE. We cannot reach into it from
# another process.
#
# Workaround adopted below:
#   * Negative tests (missing / malformed / wrong-kid / bad-sig) run against
#     the LIVE server — these do NOT need any monkey-patch (bad tokens fail
#     verification regardless of cache).
#   * Happy-path & wrong-audience tests import the FastAPI app in-process and
#     hit it via httpx.AsyncClient / requests through a TestClient so we CAN
#     monkey-patch the cache.
from fastapi.testclient import TestClient
import server  # type: ignore

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.backends import default_backend
import jwt as pyjwt


APPLE_ISSUER = "https://appleid.apple.com"


# ---------- Helpers ----------
def _b64u(n: int) -> str:
    b = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _make_rsa_jwk_and_pem(kid: str):
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
    pub = priv.public_key()
    numbers = pub.public_numbers()
    jwk = {
        "kty": "RSA",
        "kid": kid,
        "use": "sig",
        "alg": "RS256",
        "n": _b64u(numbers.n),
        "e": _b64u(numbers.e),
    }
    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwk, priv_pem


def _sign(claims: dict, priv_pem: bytes, kid: str) -> str:
    return pyjwt.encode(claims, priv_pem, algorithm="RS256", headers={"kid": kid})


# ---------- Fixtures ----------
@pytest.fixture(scope="module")
def live_url(base_url):
    return base_url


@pytest.fixture(scope="module")
def in_proc_client():
    """TestClient bound to the same server module we can monkey-patch."""
    return TestClient(server.app)


@pytest.fixture(scope="module")
def apple_audience():
    return server.APPLE_AUDIENCES[0]


@pytest.fixture
def patched_jwks():
    """Yield (kid, private_pem, audience) with server JWKS cache replaced."""
    kid = f"testkid_{uuid.uuid4().hex[:8]}"
    jwk, pem = _make_rsa_jwk_and_pem(kid)
    # Freeze cache so _fetch_apple_jwks short-circuits.
    server._APPLE_JWKS_CACHE["keys"] = [jwk]
    server._APPLE_JWKS_CACHE["fetched_at"] = datetime.now(timezone.utc)
    yield kid, pem
    server._APPLE_JWKS_CACHE["keys"] = None
    server._APPLE_JWKS_CACHE["fetched_at"] = None


@pytest.fixture
def cleanup_apple_users(mongo):
    created: list[str] = []
    yield created
    for uid in created:
        mongo.users.delete_many({"user_id": uid})
        mongo.user_sessions.delete_many({"user_id": uid})
        mongo.expenses.delete_many({"user_id": uid})
        mongo.friends.delete_many({"user_id": uid})
        mongo.groups.delete_many({"user_id": uid})
        mongo.recurring.delete_many({"user_id": uid})
        mongo.settlements.delete_many({"user_id": uid})
    # Also cleanup any test apple_subs we might have created directly
    mongo.users.delete_many({"apple_sub": {"$regex": "^apl_test_"}})


# ============================================================
# Negative tests — run against the LIVE server (via base_url)
# ============================================================
class TestAppleNegativeLive:
    def test_missing_identity_token(self, anon_client, live_url):
        r = anon_client.post(f"{live_url}/api/auth/apple", json={})
        # Pydantic missing field -> 422; empty string -> 400. Accept both.
        assert r.status_code in (400, 401, 422), r.text

    def test_empty_identity_token(self, anon_client, live_url):
        r = anon_client.post(f"{live_url}/api/auth/apple", json={"identity_token": ""})
        assert r.status_code in (400, 401), r.text

    def test_malformed_identity_token(self, anon_client, live_url):
        r = anon_client.post(f"{live_url}/api/auth/apple", json={"identity_token": "not.a.jwt"})
        assert r.status_code == 401, r.text

    def test_random_junk_token(self, anon_client, live_url):
        r = anon_client.post(f"{live_url}/api/auth/apple", json={"identity_token": "abcdef.ghijkl.mnopqr"})
        assert r.status_code == 401


# ============================================================
# Cache-patched tests — run in-process via TestClient
# ============================================================
class TestAppleVerifierInProc:
    def test_wrong_kid(self, in_proc_client, patched_jwks, apple_audience):
        kid, pem = patched_jwks
        # Sign a token but claim a different kid in the header
        bogus_kid = "kid_that_does_not_exist"
        now = int(time.time())
        tok = _sign(
            {
                "iss": APPLE_ISSUER,
                "aud": apple_audience,
                "sub": f"apl_test_{uuid.uuid4().hex[:6]}",
                "exp": now + 600,
                "iat": now,
            },
            pem,
            bogus_kid,
        )
        r = in_proc_client.post("/api/auth/apple", json={"identity_token": tok})
        assert r.status_code == 401
        assert "Unknown Apple signing key" in r.json().get("detail", "")

    def test_wrong_audience(self, in_proc_client, patched_jwks):
        kid, pem = patched_jwks
        now = int(time.time())
        tok = _sign(
            {
                "iss": APPLE_ISSUER,
                "aud": "com.evil.audience.not.in.env",
                "sub": f"apl_test_{uuid.uuid4().hex[:6]}",
                "exp": now + 600,
                "iat": now,
            },
            pem,
            kid,
        )
        r = in_proc_client.post("/api/auth/apple", json={"identity_token": tok})
        assert r.status_code == 401
        assert r.json().get("detail") == "Invalid audience"

    def test_wrong_signing_key(self, in_proc_client, patched_jwks, apple_audience):
        # Cache has JWK-A; sign with a different private key but re-use kid-A
        kid, _pem = patched_jwks
        _jwk_b, pem_b = _make_rsa_jwk_and_pem("ignored")
        now = int(time.time())
        tok = _sign(
            {
                "iss": APPLE_ISSUER,
                "aud": apple_audience,
                "sub": f"apl_test_{uuid.uuid4().hex[:6]}",
                "exp": now + 600,
                "iat": now,
            },
            pem_b,
            kid,  # matches cached kid, but signed by wrong key
        )
        r = in_proc_client.post("/api/auth/apple", json={"identity_token": tok})
        assert r.status_code == 401
        assert r.json().get("detail") == "Invalid Apple token"

    def test_expired_token(self, in_proc_client, patched_jwks, apple_audience):
        kid, pem = patched_jwks
        now = int(time.time())
        tok = _sign(
            {
                "iss": APPLE_ISSUER,
                "aud": apple_audience,
                "sub": f"apl_test_{uuid.uuid4().hex[:6]}",
                "exp": now - 60,
                "iat": now - 600,
            },
            pem,
            kid,
        )
        r = in_proc_client.post("/api/auth/apple", json={"identity_token": tok})
        assert r.status_code == 401
        assert r.json().get("detail") == "Apple token expired"


class TestAppleHappyPathInProc:
    """Happy-path tests run via httpx.AsyncClient+ASGITransport in a single
    asyncio loop so motor's AsyncIOMotorClient stays bound to a live loop.
    """

    def test_first_signin_creates_user(self, patched_jwks, apple_audience, mongo, cleanup_apple_users):
        import asyncio
        import httpx
        from httpx import ASGITransport
        from motor.motor_asyncio import AsyncIOMotorClient

        kid, pem = patched_jwks
        sub = f"apl_test_{uuid.uuid4().hex[:8]}"
        email = f"TEST_apple_{sub}@example.com"

        async def _run():
            # Rebind motor to this loop
            old_client, old_db = server.client, server.db
            server.client = AsyncIOMotorClient(server.MONGO_URL)
            server.db = server.client[server.DB_NAME]
            try:
                async with httpx.AsyncClient(transport=ASGITransport(app=server.app), base_url="http://t") as ac:
                    now = int(time.time())
                    tok = _sign({
                        "iss": APPLE_ISSUER, "aud": apple_audience, "sub": sub,
                        "exp": now + 600, "iat": now, "email": email,
                    }, pem, kid)
                    r = await ac.post("/api/auth/apple", json={
                        "identity_token": tok, "name": "TEST Apple User", "email": email,
                    })
                    assert r.status_code == 200, r.text
                    data = r.json()
                    assert data["session_token"].startswith("apl_")
                    assert data["user"]["name"] == "TEST Apple User"
                    assert data["user"]["email"] == email
                    uid = data["user"]["user_id"]
                    cleanup_apple_users.append(uid)

                    # Second call: null name/email must NOT overwrite
                    tok2 = _sign({
                        "iss": APPLE_ISSUER, "aud": apple_audience, "sub": sub,
                        "exp": now + 600, "iat": now,
                    }, pem, kid)
                    r2 = await ac.post("/api/auth/apple", json={
                        "identity_token": tok2, "name": None, "email": None,
                    })
                    assert r2.status_code == 200, r2.text
                    d2 = r2.json()
                    assert d2["session_token"] != data["session_token"]
                    assert d2["user"]["user_id"] == uid
                    assert d2["user"]["name"] == "TEST Apple User"
                    assert d2["user"]["email"] == email
                    return uid
            finally:
                try:
                    server.client.close()
                except Exception:
                    pass
                server.client, server.db = old_client, old_db

        uid = asyncio.new_event_loop().run_until_complete(_run())

        # DB assertions via sync pymongo
        u = mongo.users.find_one({"user_id": uid})
        assert u is not None
        assert u.get("apple_sub") == sub
        assert u.get("name") == "TEST Apple User"
        assert u.get("email") == email


# ============================================================
# DELETE /api/auth/account (live server)
# ============================================================
class TestDeleteAccount:
    def test_delete_requires_auth(self, anon_client, live_url):
        r = anon_client.delete(f"{live_url}/api/auth/account")
        assert r.status_code == 401

    def test_delete_wipes_all_owned_data(self, anon_client, live_url, mongo):
        # Seed a dedicated user + session + rows in all owned collections
        uid = f"user_test_del_{uuid.uuid4().hex[:8]}"
        token = f"tok_del_{uuid.uuid4().hex}"
        mongo.users.insert_one({
            "user_id": uid, "email": f"TEST_delme_{uid}@example.com",
            "name": "TEST Delete Me", "currency": "USD",
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo.user_sessions.insert_one({
            "session_token": token, "user_id": uid,
            "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
            "created_at": datetime.now(timezone.utc),
        })
        mongo.expenses.insert_one({
            "expense_id": f"exp_{uuid.uuid4().hex[:12]}", "user_id": uid,
            "amount": 10.0, "currency": "USD", "category": "Other",
            "date": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "split_with": [], "is_split": False, "has_receipt": False,
        })
        mongo.friends.insert_one({
            "friend_id": f"frd_{uuid.uuid4().hex[:12]}", "user_id": uid,
            "name": "Buddy", "email": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo.groups.insert_one({
            "group_id": f"grp_{uuid.uuid4().hex[:12]}", "user_id": uid,
            "name": "Trip", "member_ids": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo.settlements.insert_one({
            "settlement_id": f"stl_{uuid.uuid4().hex[:12]}", "user_id": uid,
            "friend_id": "x", "amount": 5.0, "currency": "USD", "note": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        mongo.recurring.insert_one({
            "recurring_id": f"rec_{uuid.uuid4().hex[:12]}", "user_id": uid,
            "amount": 1.0, "currency": "USD", "category": "Other",
            "cadence": "monthly", "next_run": datetime.now(timezone.utc).isoformat(),
            "active": True, "split_with": [],
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        try:
            s = requests.Session()
            s.headers.update({
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            })
            r = s.delete(f"{live_url}/api/auth/account")
            assert r.status_code == 200, r.text
            body = r.json()
            assert body.get("ok") is True and body.get("deleted") is True

            # Assert 0 rows remain across every collection
            for coll in ("users", "user_sessions", "expenses", "friends", "groups", "settlements", "recurring"):
                cnt = mongo[coll].count_documents({"user_id": uid} if coll != "users" else {"user_id": uid})
                assert cnt == 0, f"{coll} still has {cnt} rows for {uid}"

            # subsequent /api/auth/me with same token -> 401
            r2 = s.get(f"{live_url}/api/auth/me")
            assert r2.status_code == 401
        finally:
            mongo.users.delete_many({"user_id": uid})
            mongo.user_sessions.delete_many({"user_id": uid})
            mongo.expenses.delete_many({"user_id": uid})
            mongo.friends.delete_many({"user_id": uid})
            mongo.groups.delete_many({"user_id": uid})
            mongo.settlements.delete_many({"user_id": uid})
            mongo.recurring.delete_many({"user_id": uid})


# ============================================================
# Regression: core endpoints still work
# ============================================================
class TestRegression:
    def test_auth_me(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/auth/me")
        assert r.status_code == 200
        assert r.json().get("user_id")

    def test_root(self, anon_client, live_url):
        r = anon_client.get(f"{live_url}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "Montra API"

    def test_expenses_list(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/expenses")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_friends_list(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/friends")
        assert r.status_code == 200

    def test_groups_list(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/groups")
        assert r.status_code == 200

    def test_settlements_list(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/settlements")
        assert r.status_code == 200

    def test_recurring_list(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/recurring")
        assert r.status_code == 200

    def test_fx_snapshot(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/fx")
        assert r.status_code == 200
        d = r.json()
        assert d.get("base") == "USD"
        assert "snapshot_date" in d and "refreshed_today" in d

    def test_insights(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/insights")
        assert r.status_code == 200

    def test_trends(self, auth_client, live_url):
        r = auth_client.get(f"{live_url}/api/trends?months=6")
        assert r.status_code == 200

    def test_scan_413(self, auth_client, live_url):
        big = "A" * (5_500_001)
        r = auth_client.post(f"{live_url}/api/scan", json={"image_base64": big, "mime_type": "image/jpeg"})
        assert r.status_code == 413

    def test_cors_preflight(self, anon_client, live_url):
        r = anon_client.options(
            f"{live_url}/api/auth/me",
            headers={
                "Origin": "https://example.com",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        assert r.status_code in (200, 204)
