import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function prismaErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const c = (error as { code: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

function parseId(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (!id) {
    return NextResponse.json(
      { ok: false, status: 400, message: "Invalid id" },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;

  const startSec =
    isRecord(body) && "startSec" in body ? toNumberOrNull(body.startSec) : null;
  const endSec =
    isRecord(body) && "endSec" in body ? toNumberOrNull(body.endSec) : null;
  const text =
    isRecord(body) && "text" in body && body.text !== null && body.text !== undefined
      ? String(body.text)
      : undefined;

  if (startSec != null && startSec < 0) {
    return NextResponse.json(
      { ok: false, status: 400, message: "startSec must be >= 0" },
      { status: 400 }
    );
  }
  if (endSec != null && endSec < 0) {
    return NextResponse.json(
      { ok: false, status: 400, message: "endSec must be >= 0" },
      { status: 400 }
    );
  }
  if (startSec != null && endSec != null && startSec > endSec) {
    return NextResponse.json(
      { ok: false, status: 400, message: "startSec must be <= endSec" },
      { status: 400 }
    );
  }

  try {
    const line = await prisma.lyricLine.update({
      where: { id },
      data: {
        startSec,
        endSec,
        ...(text !== undefined ? { text } : {}),
      },
      select: {
        id: true,
        index: true,
        text: true,
        startSec: true,
        endSec: true,
      },
    });

    return NextResponse.json({ ok: true, line }, { status: 200 });
  } catch (error: unknown) {
    console.error(error);
    if (prismaErrorCode(error) === "P2025") {
      return NextResponse.json(
        { ok: false, status: 404, message: "Lyric line not found" },
        { status: 404 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}

