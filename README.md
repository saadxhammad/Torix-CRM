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

This is already a **React 19** app (Vinext/Next App Router + Vite + TypeScript + Cloudflare D1/R2).

```sh
pnpm install --frozen-lockfile
cp dev.env.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .wrangler/state
pnpm dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). First visit redirects to local sign-in (`seedy@sites.test` from `.dev.vars`).

Checks:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm build
```

See `DEVELOPER_HANDOVER.md` for deploy paths and `AUTOMATION.md` for the maintenance writer.
