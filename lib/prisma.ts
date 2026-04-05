import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const rawConnectionString = process.env.DATABASE_URL?.trim();
if (!rawConnectionString) {
  throw new Error(
    "DATABASE_URL is not set or empty. Add it to .env.local (Postgres, e.g. Supabase pooler port 6543)."
  );
}

// ローカル開発のみ: self-signed certificate (Supabase 等) を許可して P1011 を回避する。
// pg は connectionString の sslmode があると Pool の ssl オプションを上書きするため、
// dev では URL から sslmode を除き、Pool の ssl: { rejectUnauthorized: false } のみで接続する。
const isDev = process.env.NODE_ENV !== "production";
let connectionString = rawConnectionString;
if (isDev) {
  try {
    const u = new URL(rawConnectionString);
    u.searchParams.delete("sslmode");
    u.searchParams.delete("sslaccept");
    connectionString = u.toString();
  } catch {
    connectionString = rawConnectionString;
  }
}

const pool = new Pool({
  connectionString,
  ...(isDev && { ssl: { rejectUnauthorized: false } }),
});
const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}