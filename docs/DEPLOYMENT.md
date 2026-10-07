# Deployment and migration

## Configuration

Copy the example environment files and store real secrets in the deployment secret store.
The frontend receives only the public backend URL. Never put Google secrets or AI keys in
an `EXPO_PUBLIC_` variable.

### Google

Create a Google OAuth web client owned by the Montra operator. Register an exact HTTPS
callback such as `https://api.your-domain/api/auth/google/callback`, and set
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_CALLBACK_URL` on the backend.
Use only the `openid email profile` scopes. Configure the consent screen as Montra.

`AUTH_REDIRECT_URIS` is an exact allowlist of frontend return URLs, for example
`montra://,https://your-domain/`. This is distinct from the Google backend callback.
The app stores a random verifier locally; the backend returns a one-minute handoff code
and consumes it once, only with the matching verifier. No session token is put in a URL.

Reference: https://developers.google.com/identity/protocols/oauth2/web-server

### Apple

Register the final bundle identifier under the owner's Apple developer account and enable
Sign in with Apple. The provisional identifier is `com.montra.app`; it is not a claim of
store availability or ownership. `APPLE_AUDIENCES` must match the actual signed app.
Changing a published app's package identifier creates a different app; inspect existing
store registrations before release. Test on a signed native build.

### Receipts

Set `GEMINI_API_KEY` and an available image-capable `GEMINI_MODEL` under your own account.
There is intentionally no unverified model default. The server calls Google's REST API;
scanning is unavailable with a clear error until configured. Manual entry remains available.

Reference: https://ai.google.dev/gemini-api/docs/image-understanding

### Infrastructure

Run MongoDB with backups and authentication. Serve the API over HTTPS and configure exact
`CORS_ORIGINS` for web. All API workers must share MongoDB. OAuth state and handoff collections
use expiry indexes; expense IDs are unique. Startup fails if required indexes cannot be
created. The receipt rate limiter is currently per-process and must move to a shared store
before scaling multiple workers. Apply gateway limits to auth start/callback/exchange.

## Existing data

Back up and rehearse migration against a disposable copy before release. This code does
not connect to or migrate production data. Existing expenses default to `paid_by=self`;
existing settlements default to `direction=received`. No records are automatically exposed
to another account.

New Google identities are keyed by the verified provider subject. Existing accounts with
the same email are deliberately not auto-linked: that requires a verified migration linking
the provider subject to the existing user ID. The current code returns a migration message
rather than creating a duplicate account or silently transferring ownership. Existing
sessions work until their original expiry. Plan this migration before switching a live app.

New session records contain a SHA-256 hash and a non-bearer sentinel for the legacy unique
session index. They do not contain the raw session token. Signing out revokes the session.

Monthly templates created after this change retain an anchor day. Legacy templates do not
have one; inspect their intended schedule when migrating. Existing duplicate recurring
records are not deleted automatically.

## Release gates

- Own Google/Apple credentials and final app identifiers configured.
- Identity migration rehearsed; rollback and backup restore verified.
- Real Google, Apple, AI receipt and biometric flows tested on devices.
- Frontend served over HTTPS; required secrets, CORS and redirect allowlists verified.
- Shared-ledger privacy tests before adding collaboration.
- Publish privacy/support details and perform accessibility/device QA.

The draft branch is for review. It is not deployed and no paid service has been provisioned.
