# Torix Solutions implementation

Keep existing workspace IDs and immutable financial history. Upgrade the existing Site and preserve its private audience. Authentication stays with Sites. TORIX_OWNER_EMAIL is set from the verified Site owner; no account is promoted based on a browser-selected role.

Required extension scope: leads, proposals and tenders; orders and amendments; delivery milestones and work logs; shared company memberships and scoped roles; shifts, overnight attendance and leave; salary advances, reviewed payroll runs and payments; draft and issued invoices, independent earning, receipts, credits and refunds; vendors, unpaid bills and payments; PKR and USD transaction currency with booked PKR values and explicit exchange differences; bank accounts, transfers and statement reconciliation; corporate allocations and month close; private versioned documents; equipment and renewals; recurring contract cycles; reminders; CSV import; backups and restore to a separate workspace; company settings.

Store original currency units alongside base PKR ledger amounts. Use integer money and rational rate conversion. Legacy PKR postings remain valid. Client ad funds remain liabilities. Payroll expense is accrued once and payment settles the liability. Financial corrections remain explicit, linked events.

All writes use a workspace revision guard and a durable request ID. Financial source events and recurring occurrences are unique. No runtime schema creation. New Drizzle migrations append to the applied history. Test money, payroll, invoice/credit/refund, FX, role isolation, closing, CSV deduplication and migration compatibility.

External bank feeds, biometric hardware and campaign accounts require the user's provider configuration. CSV imports and scoped inbound integration endpoints are the supported data paths until those external connections are supplied. No dummy connected states.

Automatic maintenance generates due drafts, notifications and daily backups. It never pays staff, pays vendors or sends external communications. Source instructions must describe service authorization, owner-private access and readback for a future run. Test the writer before scheduling it.
