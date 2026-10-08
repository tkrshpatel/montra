
## Shared groups milestone (2026-10-08)

- 42 backend tests pass against an isolated in-memory MongoDB substitute (24 foundation, 18 shared-ledger cases).
- Shared cases cover multi-account visibility, outsider denial, invitation expiry/revocation, idempotent concurrent expense retries, conflicting retry payloads, four split modes, currency precision, repayment authorization, correction history, pagination, and deleted-owner access/ownership transfer.
- Frontend TypeScript check and Expo web export pass.
- Real MongoDB concurrency, native Android interaction, and live provider sign-in remain release gates. Web compilation is not a substitute for device testing.

Shared groups use separate collections from private contacts/presets. Group currency is fixed; USD, INR, EUR, GBP and JPY are supported. Corrections void an entry with a reason and preserve history; a corrected transaction is entered separately. Invitations last seven days and can be replaced or revoked by the owner. Shared history remains for other members after account deletion, with the member name anonymized.
