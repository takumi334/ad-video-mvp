import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import type { SearchImageResult } from "@/app/api/search-images/route";

export const runtime = "nodejs";

function loadEnvLocal() {
  if (process.env.PIXABAY_API_KEY) return;
  const envPath = path.resolve(process.cwd(), ".env.local");
  const r = config({ path: envPath, override: true });
  let key = r.parsed?.["PIXABAY_API_KEY"] ?? r.parsed?.["PIXABAY_API"];
  if (!key) {
    try {
      const raw = fs.readFileSync(envPath, "utf8");
      const m = raw.match(/PIXABAY_API_KEY\s*=\s*([^\s#\r\n]+)/);
      if (m) key = m[1].replace(/^["']|["']$/g, "").trim();
    } catch {
      /* ignore */
    }
  }
  if (key) process.env.PIXABAY_API_KEY = key;
}

const PIXABAY_API = "https://pixabay.com/api";

type PixabayHit = {
  id: number;
  tags?: string;
  user?: string;
  previewURL?: string;
  webformatURL?: string;
  largeImageURL?: string;
};

function formatHit(h: PixabayHit): SearchImageResult {
  const tagsStr = h.tags ?? "";
  const tags = tagsStr.split(",").map((t) => t.trim()).filter(Boolean);
  const title = tags[0] ?? `Image ${h.id}`;
  return {
    id: h.id,
    title,
    imageUrl: h.largeImageURL ?? h.webformatURL ?? "",
    previewUrl: h.previewURL ?? h.webformatURL ?? "",
    tags,
    author: h.user ?? "",
  };
}

/**
 * Pixabay 画像 ID から最新の URL を取得（期限切れ CDN URL の復旧用）
 */
export async function GET(req: NextRequest) {
  loadEnvLocal();
  const idRaw = req.nextUrl.searchParams.get("id")?.trim();
  const id = idRaw ? Math.floor(Number(idRaw)) : NaN;
  if (!idRaw || !Number.isFinite(id) || id <= 0) {
    return NextResponse.json(
      { ok: false, message: "有効な画像 ID（id）を指定してください。" },
      { status: 400 }
    );
  }

  const apiKey = process.env.PIXABAY_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, message: "画像検索の設定がありません。PIXABAY_API_KEY を設定してください。" },
      { status: 503 }
    );
  }

  const url = `${PIXABAY_API}/?key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(String(id))}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        return NextResponse.json(
          { ok: false, message: "リクエスト回数が上限に達しました。しばらく待ってから再試行してください。" },
          { status: 429 }
        );
      }
      return NextResponse.json(
        { ok: false, message: text || `Pixabay API エラー (${res.status})` },
        { status: res.status >= 500 ? 502 : 400 }
      );
    }

    const data = (await res.json()) as { hits?: PixabayHit[] };
    const hits = data.hits ?? [];
    const hit = hits.find((h) => h.largeImageURL ?? h.webformatURL);
    if (!hit) {
      return NextResponse.json(
        { ok: false, message: "指定 ID の画像が見つかりません。" },
        { status: 404 }
      );
    }

    const image = formatHit(hit);
    if (!image.imageUrl && !image.previewUrl) {
      return NextResponse.json(
        { ok: false, message: "画像 URL を取得できませんでした。" },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, image });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Pixabay 画像の取得に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 502 });
  }
}
