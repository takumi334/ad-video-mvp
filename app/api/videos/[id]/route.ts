import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function parseId(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

export async function GET(
  _req: NextRequest,
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
  try {
    const video = await prisma.video.findUnique({
      where: { id },
      select: { id: true, url: true, originalName: true, size: true, createdAt: true },
    });
    if (!video) {
      return NextResponse.json(
        { ok: false, status: 404, message: "Video not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { ok: true, video: { ...video, createdAt: video.createdAt.toISOString() } },
      { status: 200 }
    );
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: idRaw } = await params;
  const id = parseId(idRaw);
  if (!id) {
    return NextResponse.json(
      {
        ok: false,
        status: 400,
        message: "Invalid id",
      },
      { status: 400 }
    );
  }

  try {
    const video = await prisma.video.findUnique({
      where: { id },
    });

    if (!video) {
      return NextResponse.json(
        {
          ok: false,
          status: 404,
          message: "Video not found",
        },
        { status: 404 }
      );
    }

    const relativePath = video.url.startsWith("/")
      ? video.url.slice(1)
      : video.url;
    const filePath = path.join(process.cwd(), "public", relativePath);

    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : null;
      if (code !== "ENOENT") throw error;
    }

    await prisma.video.delete({
      where: { id: video.id },
    });

    return NextResponse.json(
      {
        ok: true,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json(
      {
        ok: false,
        status: 500,
        message,
      },
      { status: 500 }
    );
  }
}

