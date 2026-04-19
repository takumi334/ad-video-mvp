-- CreateTable
CREATE TABLE "LyricLine" (
    "id" SERIAL NOT NULL,
    "videoId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startSec" DOUBLE PRECISION,
    "endSec" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LyricLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LyricLine_videoId_idx" ON "LyricLine"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "LyricLine_videoId_index_key" ON "LyricLine"("videoId", "index");

-- AddForeignKey
ALTER TABLE "LyricLine" ADD CONSTRAINT "LyricLine_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
