# Montra — Expense Management App

## Overview
Modern minimal mobile expense manager (rebranded from SplitSync to **Montra**) with AI receipt scanning, Splitwise-style bill splitting, settle-up, recurring expenses, groups, live FX conversion, biometric app lock, Apple/Google sign-in, and true dark mode.

## Core Features
1. **Sign-In** — Emergent-managed Google + Apple (App Store compliant). 7-day sessions, expo-secure-store.
2. **Add Expense** — manual entry with amount, category, date, notes, currency (USD/INR/EUR/GBP/JPY). Fails gracefully with visible Alert on any error (session expired, oversized receipt, network).
3. **Scan Invoice (AI OCR)** — Gemini 3 Flash extracts merchant, amount, date, category from receipt image.
4. **Split with Friends** — equal or custom-ratio; balances via live FX.
5. **Settle Up** — one-tap repayment record from Splits screen.
6. **Groups** — trip/roommate groups auto-populate participants.
7. **Recurring Expenses** — monthly/weekly cadence; past-due entries materialize on list.
8. **Live FX** — daily-cached rates; hero + rows show converted amounts.
9. **Friends Management** — add friends by name/email.
10. **Dashboard** — hero balance card, filter chips, search, category & date filters, transaction list.
11. **Insights & Trends** — monthly category breakdown + 6-month trend chart.
12. **Profile** — user info, currency toggle, appearance (light/dark/system), biometric lock toggle, account deletion.
13. **Biometric Lock** — Face ID / Touch ID unlock (native build only).

## Tech Stack
- Frontend: Expo Router 57, React Native 0.86, react-native-reanimated, @react-native-vector-icons/feather, expo-local-authentication, expo-apple-authentication
- Backend: FastAPI + Motor (MongoDB), PyJWT for Apple token validation
- AI: Gemini 3 Flash via emergentintegrations (EMERGENT_LLM_KEY)
- Auth: Emergent Managed Google Auth + Apple Auth
- FX: open.er-api.com (free, no key)

## Design
Sage green + monochrome, "iOS-Native Clean" personality. Light + Dark themes via ThemeContext.

## Reliability
- API layer surfaces FastAPI `detail` errors, has 30s AbortController timeout, and hydrates BASE URL from both `process.env` and `expo-constants.extra`.
- Add-expense Save shows an Alert on failure (session expired → login redirect, oversized receipt, network error, backend detail).

