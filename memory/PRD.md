# SplitSync — Expense Management App

## Overview
Modern minimal mobile expense manager with AI receipt scanning, Splitwise-style bill splitting, settle-up, recurring expenses, groups, and live FX conversion.

## Core Features
1. **Google Sign-In (Emergent managed)** — 7-day sessions, expo-secure-store.
2. **Add Expense** — manual entry with amount, category, date, notes, currency (USD/INR).
3. **Scan Invoice (AI OCR)** — Gemini 3 Flash extracts merchant, amount, date, category from receipt image.
4. **Split with Friends** — assign expense to friends; balances = per-friend share owed minus settlements, all in home currency via live FX.
5. **Settle Up** — one-tap repayment record from Splits screen; balance decreases immediately.
6. **Groups** — create trip/roommate groups; picking a group in Add Expense auto-selects its members.
7. **Recurring Expenses** — monthly/weekly cadence; past-due entries materialize automatically on list.
8. **Live FX** — `/api/fx` fetches USD/INR/EUR from open.er-api.com (30-min cache); Dashboard hero and rows show converted amounts.
9. **Friends Management** — add friends by name/email.
10. **Dashboard** — hero balance card, filter chips (All/Personal/Split), transaction list with FX conversion.
11. **Profile** — user info, currency toggle (USD/INR), recurring link, sign out.

## Tech Stack
- Frontend: Expo Router 57, React Native 0.86, react-native-reanimated, @react-native-vector-icons/feather
- Backend: FastAPI + Motor (MongoDB)
- AI: Gemini 3 Flash via emergentintegrations (EMERGENT_LLM_KEY)
- Auth: Emergent Managed Google Auth
- FX: open.er-api.com (free, no key)

## Design
Sage green + monochrome, "iOS-Native Clean" personality.
