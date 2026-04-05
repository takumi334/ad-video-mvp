This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment

Use **`.env.local`** at the project root (same level as `package.json`) for local development. Do not commit it.

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `DATABASE_URL` | Postgres connection string (Supabase pooler). **Username must be `postgres.[PROJECT_REF]`** (see below). Required. |
| `DIRECT_URL` | Optional. For migrations; use session pooler or direct. Same username format as DATABASE_URL. |

Variable names must be exactly `DATABASE_URL` and `DIRECT_URL` (not `DB_URL` or `DATABASE-URL`).

**After changing `.env` or `.env.local`, restart the Next.js dev server** (`npm run dev`). Env is loaded only at startup.

On startup, the server logs `DATABASE_URL present: true/false` so you can confirm the variable is loaded.

**Which env file is used:** Next.js loads env from the project root in this order (later overrides earlier): `.env`, `.env.local`, `.env.development`, `.env.development.local`. For `npm run dev`, use **`.env.local`** for secrets (it is gitignored).

**SSL (Supabase / Postgres):** In **local development** the app creates the pg Pool with `ssl: { rejectUnauthorized: false }` so self-signed certs (e.g. Supabase) do not cause P1011. Your `.env.local` can keep `?sslmode=require` in `DATABASE_URL`; the code overrides TLS verification in dev only. Production does not set `rejectUnauthorized: false`.

**Prisma / env:** Only **`DATABASE_URL`** is used at runtime (`lib/prisma.ts`, `prisma.config.ts`). `prisma/schema.prisma` has no `url`/`directUrl` in the datasource (URL comes from `prisma.config.ts` → `env("DATABASE_URL")`). **`DIRECT_URL`** is not referenced; optional for future migrations.

**Supabase の接続文字列で重要な点（「Tenant or user not found」を防ぐ）:**

- **ユーザー名:** pooler 接続では **`postgres.[PROJECT_REF]`** が必須。`postgres` だけだと「Tenant or user not found」になる。
- **PROJECT_REF:** ダッシュボードの URL または `NEXT_PUBLIC_SUPABASE_URL` のホスト部分。例: `https://ihajzcsadjfkyfvucycl.supabase.co` → PROJECT_REF は **`ihajzcsadjfkyfvucycl`**。
- **ホスト:** Session モードは `aws-0-[REGION].pooler.supabase.com` または `aws-1-[REGION].pooler.supabase.com`（リージョンはダッシュボードで確認）。
- **ポート:** Session モード 5432 / Transaction モード 6543。DB 名は通常 `postgres`。
- **パスワード:** ダッシュボードの Project Settings → Database で確認・リセット可能。

**`.env.local` の完成形（パスワードだけ伏せた例）:**

```env
# 必須。ユーザー名は必ず postgres.[PROJECT_REF] にする（PROJECT_REF は上記のとおり）
DATABASE_URL=postgresql://postgres.ihajzcsadjfkyfvucycl:YOUR_DB_PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres?sslmode=require

NEXT_PUBLIC_SUPABASE_URL=https://ihajzcsadjfkyfvucycl.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# 任意（マイグレーション用。現状コードでは未使用。同じく postgres.PROJECT_REF）
# DIRECT_URL=postgresql://postgres.ihajzcsadjfkyfvucycl:YOUR_DB_PASSWORD@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres
```

**Verify DB connection:** After starting the dev server, open `/videos/1/sync`. If the DB is reachable, `GET /api/videos/1` and `GET /api/videos/1/lyrics` return 200 and the sync page loads. If you see 500, check the server log (e.g. DATABASE_URL present, Prisma errors).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
