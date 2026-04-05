/**
 * 画像検索の手動クエリ履歴（localStorage・軽量）。
 * 検索実行時のみ更新。入力中は触らない。
 */

import { LYRICS_IMAGE_PARTICLE_STOPWORDS } from "@/lib/theme/parseLyricsTheme";

/** 全曲共通の最近語（JSON 配列） */
export const LS_RECENT_SEARCH_TOKENS = "adVideo.recentSearchTokens";
/** 曲ごと: adVideo.songSearchTokenHistory.{songId} */
export const lsSongSearchTokenKey = (songId: number) =>
  `adVideo.songSearchTokenHistory.${songId}`;

export const GLOBAL_TOKEN_CAP = 45;
export const SONG_TOKEN_CAP = 20;
/** 候補生成に混ぜる履歴語の上限（補助のみ） */
export const ASSIST_BLEND_CAP = 4;

const EN_NOISE = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "is",
  "it",
  "as",
]);

const SKIP = new Set<string>([...LYRICS_IMAGE_PARTICLE_STOPWORDS, ...EN_NOISE]);

function safeParseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  } catch {
    return [];
  }
}

/** 手動クエリをトークン化（助詞・軽い英語ノイズ除外） */
export function tokenizeManualQueryForHistory(query: string): string[] {
  const n = query.normalize("NFKC").trim();
  if (!n) return [];
  const parts = n.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    if (p.length < 2) continue;
    if (SKIP.has(p)) continue;
    const k = p.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** 新しい検索のトークンを先頭に、重複は除去、cap まで */
function mergeNewestFirst(incoming: string[], previous: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...incoming, ...previous]) {
    const k = t.normalize("NFKC").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function readGlobal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return safeParseStringArray(localStorage.getItem(LS_RECENT_SEARCH_TOKENS));
  } catch {
    return [];
  }
}

function writeGlobal(tokens: string[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_RECENT_SEARCH_TOKENS, JSON.stringify(tokens));
  } catch {
    /* quota / private mode */
  }
}

function readSong(songId: number): string[] {
  if (typeof window === "undefined" || !Number.isFinite(songId) || songId <= 0) return [];
  try {
    return safeParseStringArray(localStorage.getItem(lsSongSearchTokenKey(songId)));
  } catch {
    return [];
  }
}

function writeSong(songId: number, tokens: string[]): void {
  if (typeof window === "undefined" || !Number.isFinite(songId) || songId <= 0) return;
  try {
    localStorage.setItem(lsSongSearchTokenKey(songId), JSON.stringify(tokens));
  } catch {
    /* ignore */
  }
}

/**
 * 検索実行時のみ呼ぶ。manual の生文字列からトークンを取り、全体＋曲ごとに保存。
 */
export function recordManualSearchHistory(manualQueryTrimmed: string, songId: number): void {
  const incoming = tokenizeManualQueryForHistory(manualQueryTrimmed);
  if (incoming.length === 0) return;

  const nextGlobal = mergeNewestFirst(incoming, readGlobal(), GLOBAL_TOKEN_CAP);
  writeGlobal(nextGlobal);

  if (songId > 0) {
    const nextSong = mergeNewestFirst(incoming, readSong(songId), SONG_TOKEN_CAP);
    writeSong(songId, nextSong);
  }
}

/**
 * 候補生成用: 曲ごと履歴を優先し、足りなければ全体履歴から最大 ASSIST_BLEND_CAP 語。
 */
export function getAssistBlendTokens(songId: number): string[] {
  const song = songId > 0 ? readSong(songId) : [];
  const global = readGlobal();
  const seen = new Set<string>();
  const out: string[] = [];

  for (const t of song) {
    const k = t.normalize("NFKC").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= ASSIST_BLEND_CAP) return out;
  }
  for (const t of global) {
    const k = t.normalize("NFKC").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= ASSIST_BLEND_CAP) break;
  }
  return out;
}
