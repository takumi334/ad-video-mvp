import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { assertCanMutateVideo } from "@/lib/apiVideoAuth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function parseVideoId(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
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
  const text = isRecord(body) && typeof body.text === "string" ? body.text : "";
  const rawLines = text
    .split(/\r?\n/g)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  try {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, ownerSecret: true, isPublic: true },
    });
    if (!video) {
      return NextResponse.json(
        { ok: false, status: 404, message: "Video not found" },
        { status: 404 }
      );
    }
    const auth = assertCanMutateVideo(req, video);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, status: auth.status, message: auth.message },
        { status: auth.status }
      );
    }

    await prisma.$transaction(async (tx: PrismaTransactionClient) => {
      await tx.lyricLine.deleteMany({ where: { videoId } });
      if (rawLines.length > 0) {
        await tx.lyricLine.createMany({
          data: rawLines.map((lineText: string, i: number) => ({
            videoId,
            index: i,
            text: lineText,
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
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}
