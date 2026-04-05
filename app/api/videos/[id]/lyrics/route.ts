import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function parseVideoId(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const videoId = parseVideoId(id);
  if (!videoId) {
    return NextResponse.json(
      { ok: false, status: 400, message: "Invalid id" },
      { status: 400 }
    );
  }

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) {
      return NextResponse.json(
        { ok: false, status: 404, message: "Video not found" },
        { status: 404 }
      );
    }

    const lines = await prisma.lyricLine.findMany({
      where: { videoId },
      orderBy: { index: "asc" },
      select: {
        id: true,
        index: true,
        text: true,
        startSec: true,
        endSec: true,
      },
    });

    return NextResponse.json({ ok: true, lines }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    if (error && typeof error === "object" && "code" in error) {
      const prismaErr = error as { code?: string; cause?: unknown };
      console.error("Prisma error:", prismaErr.code, "cause:", prismaErr.cause);
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const videoId = parseVideoId(id);
  if (!videoId) {
    return NextResponse.json(
      { ok: false, status: 400, message: "Invalid id" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const lyricsText =
    isRecord(body) && typeof body.lyricsText === "string" ? body.lyricsText : "";
  const rawLines = lyricsText
    .split(/\r?\n/g)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) {
      return NextResponse.json(
        { ok: false, status: 404, message: "Video not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx: PrismaTransactionClient) => {
      await tx.lyricLine.deleteMany({ where: { videoId } });
      if (rawLines.length > 0) {
        await tx.lyricLine.createMany({
          data: rawLines.map((text: string, i: number) => ({
            videoId,
            index: i,
            text,
            startSec: null,
            endSec: null,
          })),
        });
      }
    });

    const lines = await prisma.lyricLine.findMany({
      where: { videoId },
      orderBy: { index: "asc" },
      select: {
        id: true,
        index: true,
        text: true,
        startSec: true,
        endSec: true,
      },
    });

    return NextResponse.json({ ok: true, lines }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    if (error && typeof error === "object" && "code" in error) {
      const prismaErr = error as { code?: string; cause?: unknown };
      console.error("Prisma error:", prismaErr.code, "cause:", prismaErr.cause);
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}

type LyricsSegment = {
  startSec?: number | null;
  endSec?: number | null;
  text: string;
};

function isLyricsSegment(v: unknown): v is LyricsSegment {
  return (
    typeof v === "object" &&
    v !== null &&
    "text" in v &&
    typeof (v as LyricsSegment).text === "string"
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const videoId = parseVideoId(id);
  if (!videoId) {
    return NextResponse.json(
      { ok: false, status: 400, message: "Invalid id" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;
  const lyricsRaw = isRecord(body) && Array.isArray(body.lyrics) ? body.lyrics : [];
  const segments: LyricsSegment[] = lyricsRaw.filter(isLyricsSegment);

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true },
    });
    if (!video) {
      return NextResponse.json(
        { ok: false, status: 404, message: "Video not found" },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx: PrismaTransactionClient) => {
      await tx.lyricLine.deleteMany({ where: { videoId } });
      if (segments.length > 0) {
        await tx.lyricLine.createMany({
          data: segments.map((seg, i) => ({
            videoId,
            index: i,
            text: seg.text,
            startSec: seg.startSec ?? null,
            endSec: seg.endSec ?? null,
          })),
        });
      }
    });

    const lines = await prisma.lyricLine.findMany({
      where: { videoId },
      orderBy: { index: "asc" },
      select: {
        id: true,
        index: true,
        text: true,
        startSec: true,
        endSec: true,
      },
    });

    return NextResponse.json({ ok: true, lines }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    if (error && typeof error === "object" && "code" in error) {
      const prismaErr = error as { code?: string; cause?: unknown };
      console.error("Prisma error:", prismaErr.code, "cause:", prismaErr.cause);
    }
    console.error(error);
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}
