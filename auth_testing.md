# Sign in with Apple — Testing

## Backend
1. Seed test user + session with `apple_sub="apple_test_sub"` in MongoDB.
2. Hit `GET /api/auth/me` with Bearer token → expect user data.
3. POST `/api/auth/apple` with invalid token → expect 401.
4. Decode any real Apple identityToken and confirm `aud` claim matches an entry in `APPLE_AUDIENCES` env (bundle id or `host.exp.Exponent`). Wrong `aud` must 401.

## Frontend (manual, requires real Apple ID on iOS device)
1. Open app on iOS device (Expo Go or native build).
2. Login screen shows "Continue with Apple" button (iOS only).
3. Tap → OS prompt → biometrics → returns identityToken.
4. Backend upserts user by `apple_sub` and returns session_token.
5. Second login: name/email in payload are null (Apple sends them only on first sign-in). Backend must NOT overwrite.

## Environment
- `APPLE_AUDIENCES="com.emergent.invoicescan.d4y5at,host.exp.Exponent"`
- iOS bundle id: `com.emergent.invoicescan.d4y5at`
- app.json: `expo.ios.usesAppleSignIn: true`
