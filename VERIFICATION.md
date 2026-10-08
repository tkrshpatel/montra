
## Shared groups milestone (2026-10-08)

- 42 backend tests pass against an isolated in-memory MongoDB substitute (24 foundation, 18 shared-ledger cases).
- Shared cases cover multi-account visibility, outsider denial, invitation expiry/revocation, idempotent concurrent expense retries, conflicting retry payloads, four split modes, currency precision, repayment authorization, correction history, pagination, and deleted-owner access/ownership transfer.
- Frontend TypeScript check and Expo web export pass.
- Real MongoDB concurrency, native Android interaction, and live provider sign-in remain release gates. Web compilation is not a substitute for device testing.

Shared groups use separate collections from private contacts/presets. Group currency is fixed; USD, INR, EUR, GBP and JPY are supported. Corrections void an entry with a reason and preserve history; a corrected transaction is entered separately. Invitations last seven days and can be replaced or revoked by the owner. Shared history remains for other members after account deletion, with the member name anonymized.


## Additional validation (2026-10-08)

- Expo Android/Hermes export succeeded (1,758 bundled modules). This is a JavaScript/asset build, not a signed APK or device test.
- Playwright at 390×844 passed shared-group navigation, equal expense submission, received-payment direction, invitation display, and horizontal-overflow/runtime-error assertions using mocked API responses. The rendered shared activity screen was visually inspected.
- The repeatable smoke test is `frontend/tests/shared-mobile.cjs`; GitHub Actions installs Playwright, exports the app with a test backend URL and runs it.
- Shared tests now accept `MONTRA_TEST_MONGO_URI`, using a unique disposable database for each test and cleaning it up. CI supplies a MongoDB 8.0 service. The local MongoDB binary could not start because this environment returned `open: Operation not permitted`; real-database results must be confirmed in CI.
- Live provider login and physical Android testing remain outstanding.
