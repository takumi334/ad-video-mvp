import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

const MISSING_TOKEN_MESSAGE =
  "動画アップロード設定が未完了です。管理者が BLOB_READ_WRITE_TOKEN を設定してください。";

function hasBlobToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return false;
  return token.trim().length > 0;
}

function logBlobTokenState(context: "GET" | "POST") {
  if (process.env.NODE_ENV !== "development") return;
  const raw = process.env.BLOB_READ_WRITE_TOKEN;
  const trimmed = raw?.trim() ?? "";
  console.info("[blob-upload]", context, {
    hasRawToken: Boolean(raw),
    rawLength: raw?.length ?? 0,
    trimmedLength: trimmed.length,
  });
}

export async function GET() {
  logBlobTokenState("GET");
  if (!hasBlobToken()) {
    return NextResponse.json(
      { ok: false, status: 503, message: MISSING_TOKEN_MESSAGE },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function POST(request: Request) {
  logBlobTokenState("POST");
  if (!hasBlobToken()) {
    return NextResponse.json(
      { ok: false, status: 503, message: MISSING_TOKEN_MESSAGE },
      { status: 503 }
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        return {
          allowedContentTypes: ["video/mp4", "video/webm", "video/quicktime"],
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Metadata is persisted separately via /api/videos.
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error(error);
    const message =
      error instanceof Error ? error.message : "Failed to prepare blob upload";
    return NextResponse.json(
      { ok: false, status: 500, message },
      { status: 500 }
    );
  }
}
