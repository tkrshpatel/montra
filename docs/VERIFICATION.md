# Foundation verification

Validated locally on 7 October 2026:

- 24 backend tests pass using isolated in-memory MongoDB and mocked providers.
- `npm run typecheck` passes.
- `npx expo export --platform web` succeeds.
- Headless Chromium at 390 × 844 checks Montra login, selects a friend as payer,
  submits the expense payload, opens a negative balance settlement with a positive
  prefilled amount, and submits `direction=paid`. No JavaScript page errors observed.
- Source scan finds no old platform brand/provider references in current project files.
- `git diff --check` passes.

Tests cover allocations conserving cents, JPY precision, bilateral debt direction,
legacy default payer/settlement behavior, cross-user contact rejection, invalid split
weights and currencies, amount precision, concurrent recurring refreshes, month-end
anchors, deleting historical expenses, hashed/revocable sessions, OAuth redirect
allowlists, callback state replay, PKCE handoff mismatch/replay/expiry, and the direct
receipt-provider request contract.

Not validated: real Google or Apple credentials, live AI receipt accuracy, native app
builds, biometric hardware, production MongoDB migration, app-store submission or
collaborative multi-account groups. No production data was accessed or changed.

Older generated run reports have been removed from the current branch and remain in
Git history; they describe a previous platform and are not evidence for this version.
