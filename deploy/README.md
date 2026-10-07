# Montra hosted deployment

Deploy three services in one Railway project: MongoDB, API, and web. Hosting is not yet
provisioned; these files prepare the merged application for deployment. Container images
have not been built in this workspace because Docker is unavailable.

Use the repository root as build context for both application services.

| Service | Dockerfile selection | Port | Health check |
| --- | --- | --- | --- |
| API | `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.api` | platform `PORT` | `/api/` |
| Web | `RAILWAY_DOCKERFILE_PATH=deploy/Dockerfile.web` | platform `PORT` | `/healthz` |

Provision MongoDB with a persistent volume and private-network credentials. Reference its
connection variable in the API's `MONGO_URL`; use `DB_NAME=montra`. Do not expose the database
publicly. Configure backups before real users are onboarded.

Generate API and web HTTPS domains. Set the web build variable `EXPO_PUBLIC_BACKEND_URL`
to the API origin without a trailing slash. Missing backend URL deliberately fails the web
build. Nginx serves Expo's single-page output with fallback for deep links such as `/login`.

Set API `CORS_ORIGINS` to the exact web origin and `AUTH_REDIRECT_URIS` to
`montra://,https://<web-domain>/`. Register `https://<api-domain>/api/auth/google/callback`
in the owner's Google OAuth web client, then configure `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`. See `docs/DEPLOYMENT.md` for existing-user
identity migration. Login is unavailable until configured; no demo authentication is used.

Set `GEMINI_API_KEY` and `GEMINI_MODEL` for receipt scanning. Manual expense entry does not
require an AI key, but still requires working sign-in. All secrets belong in provider
variables, never in the frontend or Git repository.

Before opening the app to users: verify API and web health checks, complete a real Google
login, create and retrieve a private expense, test a split and settlement, and verify
that another account cannot read those records. Native store deployment is separate.

Provider references:
- https://docs.railway.com/services
- https://docs.railway.com/variables/reference
- https://docs.railway.com/databases/reference
