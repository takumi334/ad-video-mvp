import { config } from "dotenv";
import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { expandLyricsKeywordsForImageSearch } from "@/lib/imageSearchKeywordDict";

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
/** 既定は従来どおり 12（素材ページ等）。モーダルは per_page=6 を指定可能 */
const DEFAULT_PER_PAGE = 12;
const MAX_PER_PAGE = 24;

/** フロントに返す画像1件の型 */
export type SearchImageResult = {
  id: number;
  title: string;
  imageUrl: string;
  previewUrl: string;
  tags: string[];
  author: string;
  /** 運営向け: Pixabay の元順位（1始まり） */
  apiRank?: number;
  /** 運営向け: アプリ内最終ランキング用スコア（高いほど上位） */
  finalRankScore?: number;
  /** 運営向け: ブースト加点 */
  boostScore?: number;
  /** 運営向け: ブースト理由（ユーザーUIでは非表示） */
  boostReason?: string;
};

/** Pixabay API の hit の型（必要なフィールドのみ） */
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

function toTokenSet(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g)
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

function computeBoostMeta(
  query: string,
  tags: string[],
  id: number
): { boostScore: number; boostReason?: string } {
  const qTokens = toTokenSet(query);
  const tTokens = toTokenSet(tags.join(" "));
  let boostScore = 0;
  const reasons: string[] = [];

  const hasAny = (set: Set<string>, words: string[]) => words.some((w) => set.has(w));

  const worldcupTerms = ["worldcup", "world", "cup", "fifa", "wc"];
  const soccerTerms = ["soccer", "football", "stadium", "goal", "match", "crowd"];
  if (hasAny(qTokens, worldcupTerms) || hasAny(tTokens, worldcupTerms)) {
    if (hasAny(tTokens, soccerTerms)) {
      boostScore += 50;
      reasons.push("worldcup");
    }
  }

  const eventTerms = ["tournament", "final", "fans", "supporters", "team"];
  if (hasAny(qTokens, soccerTerms) && (hasAny(tTokens, soccerTerms) || hasAny(tTokens, eventTerms))) {
    boostScore += 20;
    reasons.push("soccer_event");
  }

  const month = new Date().getUTCMonth() + 1;
  if ((month === 6 || month === 7) && hasAny(tTokens, soccerTerms)) {
    boostScore += 8;
    reasons.push("seasonal_priority");
  }

  // 将来の運営即時対応用。今は空集合（必要時に ID を追加）。
  const manualPushImageIds = new Set<number>([]);
  if (manualPushImageIds.has(id)) {
    boostScore += 100;
    reasons.push("manual_push");
  }

  return {
    boostScore,
    boostReason: reasons.length > 0 ? reasons.join("+") : undefined,
  };
}

function rerankResults(query: string, images: SearchImageResult[]): SearchImageResult[] {
  const withMeta = images.map((img, idx) => {
    const apiRank = idx + 1;
    // Pixabay 元順位を base として保持（小さい順位ほど高得点）
    const baseScore = Math.max(0, 10_000 - apiRank);
    const { boostScore, boostReason } = computeBoostMeta(query, img.tags, img.id);
    const finalRankScore = baseScore + boostScore;
    return {
      ...img,
      apiRank,
      boostScore,
      boostReason,
      finalRankScore,
    };
  });
  withMeta.sort((a, b) => {
    const d = (b.finalRankScore ?? 0) - (a.finalRankScore ?? 0);
    if (d !== 0) return d;
    return (a.apiRank ?? Number.MAX_SAFE_INTEGER) - (b.apiRank ?? Number.MAX_SAFE_INTEGER);
  });
  return withMeta;
}

export async function GET(req: NextRequest) {
  loadEnvLocal();
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const pageRaw = req.nextUrl.searchParams.get("page");
  const perPageRaw = req.nextUrl.searchParams.get("per_page");
  const page = Math.max(1, Math.floor(Number(pageRaw ?? "1")) || 1);
  let perPage = Math.floor(Number(perPageRaw ?? String(DEFAULT_PER_PAGE))) || DEFAULT_PER_PAGE;
  if (!Number.isFinite(perPage) || perPage < 3) perPage = DEFAULT_PER_PAGE;
  perPage = Math.min(MAX_PER_PAGE, perPage);

  if (!q) {
    return NextResponse.json(
      { ok: false, message: "検索キーワード（q）を指定してください。" },
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

  /** クライアントは日本語 UI のまま送る。Pixabay 向けに辞書で英語展開（混在・未知語はそのまま） */
  const qForApi = expandLyricsKeywordsForImageSearch(q) || q;

  const url = `${PIXABAY_API}/?key=${encodeURIComponent(apiKey)}&q=${encodeURIComponent(qForApi)}&image_type=photo&per_page=${perPage}&page=${page}&safesearch=true`;

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

    const data = (await res.json()) as { hits?: PixabayHit[]; totalHits?: number };
    const hits = data.hits ?? [];
    const totalHits = typeof data.totalHits === "number" ? data.totalHits : 0;
    const imagesFromApi: SearchImageResult[] = hits
      .filter((h) => h.largeImageURL ?? h.webformatURL)
      .map(formatHit);
    const images = rerankResults(qForApi, imagesFromApi);

    const loadedSoFar = (page - 1) * perPage + images.length;
    const hasMore = totalHits > 0 ? loadedSoFar < totalHits : images.length >= perPage;

    return NextResponse.json({
      ok: true,
      images,
      page,
      perPage,
      totalHits,
      hasMore,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "画像検索に失敗しました。";
    return NextResponse.json(
      { ok: false, message },
      { status: 502 }
    );
  }
}
