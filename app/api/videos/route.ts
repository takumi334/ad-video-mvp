import { NextResponse } from "next/server";
import { isAllowedVercelBlobVideoUrl } from "@/lib/blobUrlAllowlist";
import { checkSimpleRateLimit, getClientIp } from "@/lib/rateLimitSimple";
import { prisma } from "@/lib/prisma";
import type { NextRequest } from "next/server";

type CreateVideoBody = {
  originalName?: string;
  url?: string;
  size?: number;
  mime?: string;
  ownerSecret?: string;
};

const OWNER_SECRET_MIN_LEN = 32;

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkSimpleRateLimit(`videos-post:${ip}`, 30, 60_000)) {
    return NextResponse.json(
      { ok: false, status: 429, message: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  try {
    const body = (await request.json()) as CreateVideoBody;
    const originalName = body.originalName?.trim();
    const url = body.url?.trim();
    const size = body.size;
    const mime = body.mime?.trim() || "video/mp4";
    const ownerSecret =
      typeof body.ownerSecret === "string" ? body.ownerSecret.trim() : "";

    if (!originalName || !url || typeof size !== "number" || size < 0) {
      return NextResponse.json(
        { ok: false, status: 400, message: "Invalid payload" },
        { status: 400 }
      );
    }

    if (ownerSecret.length < OWNER_SECRET_MIN_LEN) {
      return NextResponse.json(
        {
          ok: false,
          status: 400,
          message: "ownerSecret is required (min 32 characters).",
        },
        { status: 400 }
      );
    }

    if (!isAllowedVercelBlobVideoUrl(url)) {
      return NextResponse.json(
        {
          ok: false,
          status: 400,
          message: "url must be a Vercel Blob URL (https://*.public.blob.vercel-storage.com).",
        },
        { status: 400 }
      );
    }

    const video = await prisma.video.create({
      data: {
        originalName,
        url,
        size,
        mime,
        ownerSecret,
        isPublic: false,
      },
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
