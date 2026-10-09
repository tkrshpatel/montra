# Montra

Money, together. A mobile-first app for personal expenses and clear balances with friends.

## Current implementation

- Expo / React Native / TypeScript frontend for Android, iOS and web.
- FastAPI and MongoDB backend.
- Direct Google OAuth, native Apple sign-in, and revocable seven-day sessions.
- Direct Gemini receipt extraction with a server-owned API key.
- Personal expenses, private contacts and groups, equal/weighted splits, payer selection,
  payments sent/received, recurring expenses, insights and currency conversion.

This branch is an independent foundation, **not a production release**. Contacts and
current groups remain private to their creator. Collaborative accounts, group invites,
budgets and offline sync are planned in [the product blueprint](docs/PRODUCT_BLUEPRINT.md).

## Local setup

Backend (Python 3.11+):

```sh
python -m venv .venv
# Activate the virtual environment for your shell.
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
cd backend
uvicorn server:app --reload --port 8000
```

Provide a local MongoDB instance and edit the backend configuration first. No credentials
are committed. Authentication and AI scanning need your own provider configuration.

Frontend (Node 22+):

```sh
cd frontend
npm ci
cp .env.example .env
npm run web
```

Use a device-reachable HTTPS backend URL for native builds. `localhost` on a phone refers
to that phone. Google native sign-in uses a **Montra development/production build**, not
Expo Go, because the callback uses the registered `montra://` scheme.

## Verification

```sh
python -m pytest -c backend/unit_tests/pytest.ini backend/unit_tests -q
cd frontend
npm run typecheck
npx expo export --platform web
```

The foundation tests use isolated in-memory MongoDB and mocked provider traffic: they do
not access user data or spend AI credits. The older `backend/tests` integration suite
requires a disposable running server/database and has legacy contract expectations; do
not point it at production.

See [deployment and migration](docs/DEPLOYMENT.md) before connecting existing data.
