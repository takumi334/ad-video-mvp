-- CreateTable
CREATE TABLE "VideoSubmission" (
    "id" SERIAL NOT NULL,
    "originalPath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoSubmission_pkey" PRIMARY KEY ("id")
);
