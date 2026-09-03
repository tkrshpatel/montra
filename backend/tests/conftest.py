import os
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv
from pathlib import Path

# Load backend env for MONGO_URL / DB_NAME
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Frontend .env holds the public URL used by clients
load_dotenv(Path(__file__).resolve().parents[2] / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

TEST_TOKEN = "test_token_abc"
TEST_USER_ID = "user_test_fixture01"
TEST_EMAIL = "TEST_backend_tester@example.com"


@pytest.fixture(scope="session")
def base_url():
    assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
    return BASE_URL


@pytest.fixture(scope="session")
def mongo():
    c = MongoClient(MONGO_URL)
    yield c[DB_NAME]
    c.close()


@pytest.fixture(scope="session", autouse=True)
def seed_user(mongo):
    from pymongo.errors import DuplicateKeyError
    # Idempotent, xdist-safe seed: match by unique email; tolerate concurrent worker races.
    user_doc = {
        "user_id": TEST_USER_ID,
        "email": TEST_EMAIL,
        "name": "Backend Tester",
        "picture": None,
        "currency": "USD",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        mongo.users.update_one({"email": TEST_EMAIL}, {"$set": user_doc}, upsert=True)
    except DuplicateKeyError:
        mongo.users.update_one({"email": TEST_EMAIL}, {"$set": user_doc})
    try:
        mongo.user_sessions.update_one(
            {"session_token": TEST_TOKEN},
            {"$set": {
                "session_token": TEST_TOKEN,
                "user_id": TEST_USER_ID,
                "expires_at": datetime.now(timezone.utc) + timedelta(days=1),
                "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    yield
    # teardown
    mongo.users.delete_many({"user_id": TEST_USER_ID})
    mongo.user_sessions.delete_many({"session_token": TEST_TOKEN})
    mongo.friends.delete_many({"user_id": TEST_USER_ID})
    mongo.expenses.delete_many({"user_id": TEST_USER_ID})
    mongo.settlements.delete_many({"user_id": TEST_USER_ID})
    mongo.groups.delete_many({"user_id": TEST_USER_ID})
    mongo.recurring.delete_many({"user_id": TEST_USER_ID})


@pytest.fixture
def auth_client():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TEST_TOKEN}",
    })
    return s


@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
