-- CreateTable
CREATE TABLE "LyricLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "videoId" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "startSec" REAL,
    "endSec" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LyricLine_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "LyricLine_videoId_idx" ON "LyricLine"("videoId");

-- CreateIndex
CREATE UNIQUE INDEX "LyricLine_videoId_index_key" ON "LyricLine"("videoId", "index");
