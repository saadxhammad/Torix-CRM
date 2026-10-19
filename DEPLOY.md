# Deploy Torix CRM

## Important: this is not a drop-in Vercel app

This codebase targets **Cloudflare Workers** with:

- **D1** (SQLite) as `DB`
- **R2** object storage as `BUCKET`
- Vinext/Sites auth headers (`oai-authenticated-user-*`)
- `wrangler` local/runtime bindings

A normal **Vercel → Import Git repo → Deploy** flow will fail or run without a working database, file storage, or login.

---

## Option A — Recommended: Cloudflare Workers

1. Push this repo (already on GitHub).
2. Create a Cloudflare account and install Wrangler:
   ```sh
   npm i -g wrangler
   wrangler login
   ```
3. Create production resources:
   ```sh
   wrangler d1 create torix-crm
   wrangler r2 bucket create torix-crm-files
   ```
4. Put the real `database_id` and bucket name into a production Wrangler config (do not use the local placeholder IDs in `wrangler.local.jsonc` for production).
5. Apply migrations to remote D1:
   ```sh
   wrangler d1 migrations apply DB --remote --config wrangler.jsonc
   ```
6. Set secrets (owner identity + any service tokens):
   ```sh
   wrangler secret put TORIX_OWNER_EMAIL
   wrangler secret put TORIX_OWNER_ID
   ```
7. Replace Sites/ChatGPT sign-in (`app/chatgpt-auth.ts`) with your own auth (Auth.js, Clerk, Cloudflare Access, etc.) before public use. The local `/signin-with-chatgpt` helper only works in the Vinext/Sites local gateway.
8. Build and deploy with the project’s Cloudflare/Vinext pipeline (`pnpm build`, then the Worker deploy path documented in `DEVELOPER_HANDOVER.md`).

---

## Option B — Vercel (only after a platform migration)

Vercel can host the **UI**, but you must rewrite the platform pieces first:

| Current (Cloudflare) | Needed on Vercel |
| --- | --- |
| D1 | Postgres (Neon / Supabase / Vercel Postgres) + Drizzle adapter changes |
| R2 | Vercel Blob / S3 / Supabase Storage |
| Worker bindings `env.DB` / `env.BUCKET` | Node/Edge runtime env + SDK clients |
| Sites auth headers | NextAuth / Clerk / Auth.js session cookies |
| Vinext + Wrangler build | Standard Next.js App Router on Node |

High-level Vercel steps **after** that migration:

1. Open [vercel.com/new](https://vercel.com/new) → Import [`saadxhammad/Torix-CRM`](https://github.com/saadxhammad/Torix-CRM).
2. Framework: **Next.js**.
3. Install command: `pnpm install` (or `npm install` if you switch lockfiles).
4. Build command: `pnpm build` / `next build`.
5. Add env vars for DB URL, storage, and auth secrets.
6. Deploy → run migrations against the Postgres instance → smoke-test login, uploads, invoices/PDFs.

Until that migration is done, use **Option A (Cloudflare)** or keep developing locally with:

```sh
pnpm install --frozen-lockfile
cp dev.env.example .dev.vars
pnpm exec wrangler d1 migrations apply DB --local --config wrangler.local.jsonc --persist-to .wrangler/state
pnpm dev
```

Open http://127.0.0.1:5173
