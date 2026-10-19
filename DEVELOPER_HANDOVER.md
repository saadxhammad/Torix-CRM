# Torix Solutions | Developer handover

Prepared 16 October 2026. Start here before deploying or moving the app.

## What you are receiving

A source snapshot of the currently published Torix Solutions management app, with its frontend, server routes, financial logic, database migrations, dependency lockfile and tests. This is the application source, rather than just its compiled deployment output.

- Current app: https://company-desk-yasin.spunkyfly16.chatgpt.site
- Published source commit: `ce8a422031b0f0976130e0f55b5e653d1f051654`
- Existing Sites project: `appgprj_6ad1306af43c81919aef3a4d58616fe8`
- Framework: React 19, Vinext/Next-style App Router, Vite, TypeScript.
- Server runtime: Cloudflare Workers, with D1 SQLite and private R2 object storage.
- Package manager: pnpm 11.25.0, as pinned by package.json.
- Authoring checks used Node 24.19.0. Use Node 24 for a matching development environment.

The `source/` directory contains the application. `SOURCE_MANIFEST.json` identifies the exported files and their checksums. Its .npmrc uses project-local cache paths, .gitignore excludes local Worker secret files, and generated TypeScript cache files are omitted. Business source and migrations are from the published commit.

Credentials, live database records, uploaded documents, object-store contents and dependencies are not part of a source snapshot. Production environment values and data access must be provisioned separately by the owner.

## Choose the handover path

### A. Continue on the existing ChatGPT Site

Use this path when keeping the existing private URL, database and documents.

1. The owner grants the developer Site **Editor** permission when that developer is a supported member of the same ChatGPT workspace. Supported editor management is for same-workspace users/groups. External visitor invitations grant viewing access, not source-editing permission.
2. Opening the app or receiving an in-app company role does not grant Site source or publishing access. These are separate permissions.
3. In an authorized ChatGPT Work session with Sites enabled, open the existing Site by its exact URL/project ID using the Sites workflow. Keep the project ID, access policy and current source history.
4. Work from that Site's canonical repository, compare against the commit above, make changes, run checks, build, push, save a version and deploy using the supported Sites workflow for the current audience. Preserve the owner's visitor allowlist. Do not use owner-private publication if the owner has subsequently added other visitors; let the current audience select the appropriate supported deployment operation.
5. Short-lived source credentials must be acquired by the authorized session. Nothing in this ZIP grants access to the live Site, its repository or its data.

If the developer cannot receive same-workspace Editor permission, use path B for independent hosting, or have the owner apply the reviewed source changes through their authorized Sites workflow.

### B. Developer-owned repository and separate hosting

Use this path for a company GitHub repository, your own domain or independent deployment.

1. Import `source/` into the company's private repository and give the developer repository access. The source URL used internally by Sites is not a transferable GitHub invitation.
2. Start with a separate staging environment. This app currently depends on Cloudflare Workers/D1/R2 and the Sites authentication gateway; it is not a static site or a ready-made generic Node/Vercel deployment.
3. Configure Workers, a D1 binding named `DB`, and an R2 binding named `BUCKET`. The example local Wrangler config is for local development only; real deployment needs the company's resource identifiers and configuration.
4. Replace Sites-specific sign-in with the company's chosen authenticated session system before production. `app/chatgpt-auth.ts` currently consumes identity headers authenticated by Sites. On an independent host, those headers are untrusted unless your own gateway verifies them and strips client-supplied values.
5. Update `app/page.tsx`, `lib/server.ts`, auth links and the hosting/build integration as required by the chosen environment. Keep the stable user IDs and membership authorization consistent.
6. Secure `/api/maintenance` and the service path in `/api/integrations` with explicit service authentication. They currently rely on the owner-private Sites gateway for service access. This protection does not transfer with the source ZIP.
7. Configure a scheduler for the maintenance writer only after its new authorization is tested. The existing daily 06:00 Asia/Karachi task belongs to the current Site and will not move automatically.
8. Migrate data and R2 files deliberately, verify them, then cut over the domain and disable duplicate scheduling at the old location. The JSON app backup includes records/journals and references to uploaded files; it is not a complete portable export of all R2 objects or memberships. Its restore function creates a separate workspace under the same company owner. A move to new storage/authentication needs an explicit migration, not just the Restore button.

The existing live app remains available while the developer prepares this separate deployment.

## Local setup recipe

The exported configuration falls back to the portable execution profile. Linux-only authoring installation helpers are not needed on a normal developer machine.

From `source/`, use the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
```

Copy `dev.env.example` to `.dev.vars` in `source/`. These example values match the built-in localhost development sign-in. They are not production credentials:

```text
TORIX_OWNER_EMAIL=seedy@sites.test
TORIX_OWNER_ID=local_seedy
```

Create the local schema before opening the app:

```sh
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .wrangler/state
pnpm dev
```

The local development server uses port 5173. The existing local authentication helper is limited to localhost. Local D1/R2 storage belongs to `.wrangler/state`; it contains no live company data.

The separate-machine install/startup recipe has not been run on the developer's machine. Resolve any local binding/persistence configuration before using it. A generic cloud deploy still requires path B's production auth and hosting work.

Checks:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
pnpm exec tsc --noEmit
pnpm build
```

For an authorized Sites deployment, use its supplied build/package workflow. An arbitrary `wrangler deploy` against the local example config is not a deployment procedure for the current Site.

## Source map

| Area | Location |
| --- | --- |
| Main app, navigation, lists | app/workspace.tsx |
| Forms and action dialogs | app/workspace-forms.tsx |
| Reports UI | app/views.tsx |
| Company record routes | app/api/workspace/route.ts |
| Documents and backups downloads | app/api/files/route.ts |
| Invoice/payslip/report PDFs | app/api/print/route.ts |
| Reports endpoint | app/api/reports/route.ts |
| Scheduled writer | app/api/maintenance/route.ts, lib/maintenance.ts |
| Scoped provider ingestion | app/api/integrations/route.ts |
| Identity helpers | app/chatgpt-auth.ts |
| Roles and scopes | lib/access.mjs |
| Database context and atomic changes | lib/server.ts |
| Integer money, currencies and journals | lib/finance.mjs |
| Financial workflows | lib/finance-actions.ts |
| Operational workflows | lib/operations.ts |
| Module and field configuration | lib/modules.mjs, lib/ui-config.mjs |
| Database schema and migrations | db/schema.ts, drizzle/ |
| Tests | tests/ |
| Maintenance contract | AUTOMATION.md |

## Data and financial invariants

- Native-currency amounts use integer minor units; ledger `amount` is booked PKR minor units and `units` is native-currency minor units. FX rates use integer millionths. Do not replace these with floating-point money.
- Invoice issue, earning and receipt are separate events. Staff advances, ad funds, capital and loans are not ordinary revenue.
- Payroll posting records the cost once; subsequent payments settle salary liabilities. Owner-paid and employee-paid costs create a payable rather than a second expense on reimbursement.
- Journals are immutable. Corrections use linked reversals or source-document workflows.
- Preserve workspace revision guards, durable request IDs, occurrence keys, server-side role/scope checks and closed-period checks.
- Add a new migration for schema changes. Do not edit already-applied 0000/0001 migrations or reinitialize production tables.
- Existing workspace IDs, member identities and financial references need explicit mapping during any data/auth migration.

## Verification and completion items

The published source passed TypeScript checks, its build and 36 unit/integration checks. Integration tests run real SQLite migrations and route handlers with a D1 adapter and an object-store stub. The live private maintenance endpoint was exercised and its backup record was read back from production.

Full browser visual and interaction QA was unavailable during authoring and remains to be completed. Developer acceptance should cover the main flows on desktop/mobile and under Owner, Finance/HR, department and Staff roles, including upload/download, payroll, invoice/credit/payment and backup restore. Verify financial reports against the company's actual expected balances before broad operational use.

Provider bank feeds, biometric hardware, campaign platforms, payment gateways and outbound messaging are not connected. CSV and scoped inbound APIs are supplied. Company address/payment details, leave grants, staff accounts and commercial/HR policies need company-specific setup. Medical Billing is practice-level business/service-contract tracking, not patient claims processing.

## Ownership and final release

Use company-owned accounts for repository, hosting, domain, database, object storage and backups. Give the developer named access through those services. Transfer required production secrets through the chosen service's secret manager, rather than adding them to this ZIP or a repository.

For handover completion, retain the final repository URL, approved deployed commit, deployment procedure, migration/backup procedure and company administrator access. Preserve the current working app until the replacement is verified.
