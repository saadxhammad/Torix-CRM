# Deploy Torix CRM (Supabase + Vercel)

Internal company tool. Data lives in **Supabase**. App runs on **Vercel**.

## 1. Create Supabase project

1. Go to [supabase.com](https://supabase.com) → New project  
2. SQL Editor → paste and run `supabase/schema.sql`  
3. Storage → New bucket → name **`torix-files`** → **Private**  
4. Copy from Project Settings:
   - Database → Connection string (URI) → `DATABASE_URL`
   - API → Project URL + `anon` + `service_role` keys

## 2. Local run

```sh
cp .env.example .env.local
# fill values, especially TORIX_OWNER_EMAIL / TORIX_OWNER_PASSWORD
pnpm install
pnpm dev
```

Open http://localhost:3000 → login with owner email/password.

## 3. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → import `saadxhammad/Torix-CRM`  
2. Framework: Next.js  
3. Add the same env vars from `.env.example`  
4. Deploy  

Staff: add their email under **Users and roles** in the app, then they sign in with `TORIX_STAFF_PASSWORD`.

## What changed from Cloudflare

| Before | Now |
| --- | --- |
| Cloudflare D1 | Supabase Postgres |
| Cloudflare R2 | Supabase Storage |
| ChatGPT Sites login | Simple email/password login |
| Workers hosting | Vercel (Next.js) |
