# Torix Solutions company workspace

Private management app for Marketing, Medical Billing, Development and configurable departments. Existing owner records and immutable journals are preserved by additive migrations.

## Included workflows

- Leads, clients, proposals, tenders, security deposits, approved orders, amendments and recurring contracts.
- Assigned tasks, accepted milestones, work logs, shift schedules, overnight attendance, leave grants and approvals.
- Employee profiles, effective salaries, department salary distribution, advances, monthly payroll, approval, partial salary payments and PDF payslips.
- Multi-line invoices, saved issued snapshots, independent earning, receipts with fees, advances, credits, refunds and PDF invoices.
- Costs, employee and owner reimbursements, vendor bills, assets/prepaid cost schedules, owner loans, equity and drawings.
- PKR/USD accounts, exact integer native balances, booked PKR carrying values, FX, transfers, statement import and reconciliation.
- Shared cost allocation, period close/reopen, department and project reporting, aging, trial balance, balance sheet and owner reports.
- Scoped roles, explicit financial approvals, private versioned documents, assets, renewals, reminders and before/after audit history.
- Validated CSV import with duplicate protection, opening balances, JSON backups and staged restore to a separate workspace.
- Scoped inbound CSV APIs for bank/attendance providers. External providers are not connected by default.

## Setup

Company address, contact and payment details are editable in Settings. Add employees first, then memberships in Users and roles. Grant the same email permission in the Site sharing settings before staff can visit. No invitations are sent by the app. Financial approval powers default to the Owner; Finance can prepare records and record incoming receipts. Paid leave needs explicit annual grants. Automatic attendance penalties are disabled; overtime and deductions are reviewed payroll inputs.

Bank feeds, biometric devices, campaign accounts, payment gateways and outbound messaging require actual provider configuration. The app supplies CSV and scoped ingestion APIs rather than claiming these connections exist. No patient-level records or insurance claim processing are included; Medical Billing is tracked at the practice/service-contract level.

## Local React app (this folder)

**Stack now:** Next.js + React 19 + **Supabase** (Postgres + Storage) — deploy on Vercel.

```sh
pnpm install
cp .env.example .env.local
# 1) Create Supabase project
# 2) Run supabase/schema.sql in SQL Editor
# 3) Create private storage bucket: torix-files
# 4) Fill .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `TORIX_OWNER_EMAIL` / `TORIX_OWNER_PASSWORD`.

Full steps: [`DEPLOY.md`](./DEPLOY.md).

