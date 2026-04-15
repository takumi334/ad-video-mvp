import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type CreateVideoBody = {
  originalName?: string;
  url?: string;
  size?: number;
  mime?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CreateVideoBody;
    const originalName = body.originalName?.trim();
    const url = body.url?.trim();
    const size = body.size;
    const mime = body.mime?.trim() || "video/mp4";

    if (!originalName || !url || typeof size !== "number" || size < 0) {
      return NextResponse.json(
        { ok: false, status: 400, message: "Invalid payload" },
        { status: 400 }
      );
    }

    const video = await prisma.video.create({
      data: { originalName, url, size, mime },
      select: { id: true, originalName: true, url: true },
    });

    return NextResponse.json({ ok: true, video }, { status: 201 });
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
