# Montra product blueprint

## Direction

Build both personal expense management and shared expenses, with a distinct Montra
identity. Android and iOS are the primary experience; web is a companion using the same
API. Prioritize reliable money records, fast entry and clear explanations over feature
count. No live deployment, billing or real-user migration is part of this foundation.

## Benchmarks

- Splitwise: friendships, shared groups, balances and settlement clarity.
  https://kb.splitwise.com/getting-started/how-do-i-use-splitwise
- Tricount: lightweight group collaboration, payer selection and flexible splitting.
  https://www.tricount.com/features
- Wallet: private spending categories, expense analysis and budgeting direction.
  https://budgetbakers.com/en/products/wallet/features/expense-tracking/

These are product references, not copied branding or a claim of feature parity.

## Product structure

| Area | User goal | Backend responsibility |
| --- | --- | --- |
| Home | Understand my own spending and outstanding balances | Separate own consumption, cash paid and money owed |
| Activity | Add/find/edit a transaction quickly | Search, pagination, validation, revisions and idempotency |
| Together | Organize friends, trips and household expenses | Shared memberships, invitations, roles and a participant ledger |
| Plan | Set category budgets and anticipate recurring bills | Budget periods, schedules, reminders and timezone rules |
| Account | Control identity, privacy, currency and export | Provider identities, sessions, consent, portability and deletion |

Private transactions must never become visible merely because a friend joins. Receipt
images should be private by default. Group members see only group transactions they have
permission to access. A user can participate without granting access to personal spending.

## First implementation in this branch

- Montra name, package IDs, deep-link scheme, app artwork and web metadata.
- Direct Google OAuth and direct Gemini receipt API; Apple remains a direct integration.
- Short-lived, single-use OAuth handoff bound to the initiating device/browser with PKCE.
- New sessions are hashed in the database; old sessions remain valid until expiry.
- Explicit payer and settlement direction, signed net balances, cent-conserving allocation.
- Ownership validation for contacts/groups and rejection of malformed split weights.
- Deterministic recurring occurrence IDs prevent duplicate inserts; monthly schedules
  retain their original day across shorter months.
- Account deletion errors are surfaced instead of silently reporting success.

## Next implementation: collaborative ledger

Introduce separate `identities`, `memberships`, `invitations`, `ledger_entries` and
`expense_revisions` collections. Keep current private contacts intact. Invitations must
be accepted before an account can access a group; matching an email alone is not consent.

Each expense has participants, currency, minor-unit amounts, and one or more payers.
Store exact allocations and the FX snapshot used at entry. Settlements are directional
ledger entries; corrections are revisions/reversals with an audit trail. Use per-request
idempotency keys for mobile retries. Authorization is based on membership, not possession
of a record ID. Test both accounts seeing the same updates and unrelated users being denied.

A private-contact expense currently records only the owner's bilateral debt; it does not
create debts between two other contacts. That behavior must remain explicit until the
shared-ledger migration is implemented.

## Subsequent implementation

1. Navigation and transaction editor redesign; equal, percentage, exact-amount and ratio
   splits, expense editing, clearer error/empty states and accessible touch targets.
2. Personal budgets, recurring management, own-share spending totals and CSV export.
3. Offline queue/sync, duplicate protection, receipt review before save and pagination.
4. Group invitations, notifications, settlement suggestions and multi-payer expenses.
5. Native device testing, privacy/account deletion workflow, backups and release readiness.

## Known release gaps

- Current insights summarize gross logged amounts, not personal consumption. Do not label
  these as personal budget spending until the own-share aggregation is added.
- Current currency balances use live FX. Snapshot-based immutable debt amounts are needed
  before claiming accounting-grade historical consistency.
- Existing lists cap at 1,000 records; pagination and search indexes are required for scale.
- No full offline mode, shared memberships, notifications or budget implementation yet.
- AI extraction still needs live provider validation and native biometric/sign-in testing.
- Legacy identity migration and app-store ownership/identifiers require deployment review.
