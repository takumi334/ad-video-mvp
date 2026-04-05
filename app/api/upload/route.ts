import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, status: 400, message: "file is required" },
        { status: 400 }
      );
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await fs.mkdir(uploadDir, { recursive: true });

    const ext = path.extname(file.name) || ".mp4";
    const filename = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}${ext}`;
    const savePath = path.join(uploadDir, filename);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    await fs.writeFile(savePath, buffer);

    const urlPath = `/uploads/${filename}`;
    const mime =
      (file as File).type && (file as File).type !== ""
        ? (file as File).type
        : "video/mp4";

    const video = await prisma.video.create({
      data: {
        originalName: file.name,
        url: urlPath,
        size: buffer.length,
        mime,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        video: {
          id: video.id,
          originalName: video.originalName,
          url: video.url,
        },
      },
      { status: 201 }
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

