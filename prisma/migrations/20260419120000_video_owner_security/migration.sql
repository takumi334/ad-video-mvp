-- AlterTable (idempotent for partially-applied DBs)
ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "ownerSecret" TEXT;

ALTER TABLE "Video" ADD COLUMN IF NOT EXISTS "isPublic" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Video" SET "isPublic" = true WHERE "ownerSecret" IS NULL;
