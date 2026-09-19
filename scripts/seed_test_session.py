"""Seed a test user + session for the frontend to be authenticated.
Currency set to INR so USD/EUR expenses trigger the conversion preview.
"""
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
import os

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")

client = MongoClient(MONGO_URL)
db = client[DB_NAME]

db.users.update_one(
    {"user_id": "user_test123"},
    {"$set": {
        "user_id": "user_test123",
        "email": "test@example.com",
        "name": "Test User",
        "picture": None,
        "currency": "INR",
        "created_at": "2026-01-01T00:00:00+00:00",
    }},
    upsert=True,
)
db.user_sessions.update_one(
    {"session_token": "test_token_abc"},
    {"$set": {
        "session_token": "test_token_abc",
        "user_id": "user_test123",
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        "created_at": datetime.now(timezone.utc),
    }},
    upsert=True,
)
print("Seeded user_test123 (INR) + session test_token_abc")
print("db:", DB_NAME)
print("user:", db.users.find_one({"user_id": "user_test123"}, {"_id": 0}))
print("session:", db.user_sessions.find_one({"session_token": "test_token_abc"}, {"_id": 0}))
