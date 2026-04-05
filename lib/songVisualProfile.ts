/**
 * 曲全体のビジュアルプロファイル（検索補助用）。
 * 区間編集モーダルで設定し、全区間の画像検索候補生成に使う。
 */

import {
  buildLyricsPrimeEnglishForImageSearch,
  japaneseImageTokensToEnglishTerms,
  prioritizeLyricsForImageSearch,
  tokenizeLyricsRemovingParticles,
} from "@/lib/theme/parseLyricsTheme";

/** 曲のイメージ（ムード） */
export const MOOD_OPTIONS = [
  { id: "", label: "未設定", keywords: [] as string[] },
  { id: "youth", label: "青春", keywords: ["youth", "energetic", "school", "teen"] },
  { id: "passion", label: "情熱", keywords: ["passion", "fire", "intense", "dynamic"] },
  { id: "sadness", label: "悲しみ", keywords: ["sad", "melancholy", "rain", "tears"] },
  { id: "heartbreak", label: "失恋", keywords: ["heartbreak", "lonely", "night", "emotional"] },
  { id: "refreshing", label: "爽やか", keywords: ["refreshing", "clear", "bright", "sky"] },
  { id: "heartfelt", label: "切ない", keywords: ["heartfelt", "tender", "emotional", "soft"] },
  { id: "urban", label: "都会", keywords: ["urban", "city", "street", "modern"] },
  { id: "sunset", label: "夕暮れ", keywords: ["sunset", "twilight", "golden hour", "warm"] },
] as const;

/** インターナショナルスタイル */
export const INTERNATIONAL_OPTIONS = [
  { id: "", label: "未設定", keywords: [] as string[] },
  { id: "japan", label: "日本", keywords: ["japanese", "asia", "zen", "minimal"] },
  { id: "indonesia", label: "インドネシア", keywords: ["tropical", "indonesia", "island", "green"] },
  { id: "latin", label: "ラテン", keywords: ["latin", "dance", "colorful", "celebration"] },
  { id: "samba", label: "サンバ", keywords: ["samba", "brazil", "carnival", "festival"] },
  { id: "kpop", label: "K-POP寄り", keywords: ["kpop", "korean", "neon", "trendy"] },
  { id: "tiktok", label: "TikTok向き", keywords: ["vertical", "viral", "trendy", "casual"] },
  { id: "shorts", label: "YouTube Shorts向き", keywords: ["vertical", "short", "quick", "impact"] },
] as const;

/** SNSプラットフォーム寄せ */
export const PLATFORM_OPTIONS = [
  { id: "", label: "未設定", keywords: [] as string[] },
  { id: "tiktok", label: "TikTok", keywords: ["vertical", "viral", "trendy", "youth"] },
  { id: "youtube-shorts", label: "YouTube Shorts", keywords: ["vertical", "impact", "fast"] },
  { id: "instagram-reels", label: "Instagram Reels", keywords: ["aesthetic", "trendy", "lifestyle"] },
] as const;

export type MoodId = (typeof MOOD_OPTIONS)[number]["id"];
export type InternationalId = (typeof INTERNATIONAL_OPTIONS)[number]["id"];
export type PlatformId = (typeof PLATFORM_OPTIONS)[number]["id"];

export type SongVisualProfile = {
  mood: MoodId;
  international: InternationalId;
  platform: PlatformId;
};

export const DEFAULT_SONG_VISUAL_PROFILE: SongVisualProfile = {
  mood: "",
  international: "",
  platform: "",
};

/**
 * 曲全体プロファイル + 区間歌詞から検索候補ワードを生成。
 */
export function generateSearchSuggestions(
  profile: SongVisualProfile,
  segmentLyrics: string
): string[] {
  const parts: string[] = [];

  const mood = MOOD_OPTIONS.find((m) => m.id === profile.mood);
  if (mood?.keywords.length) parts.push(...mood.keywords);

  const international = INTERNATIONAL_OPTIONS.find((i) => i.id === profile.international);
  if (international?.keywords.length) parts.push(...international.keywords);

  const platform = PLATFORM_OPTIONS.find((p) => p.id === profile.platform);
  if (platform?.keywords.length) parts.push(...platform.keywords);

  if (segmentLyrics.trim()) {
    const { enRanked } = prioritizeLyricsForImageSearch([segmentLyrics]);
    parts.push(...enRanked.slice(0, 6));
  }

  return [...new Set(parts)].filter(Boolean).slice(0, 12);
}

/** 曲全体プロファイルから「土台」英語トークン（各カテゴリ先頭のみ、重複除去） */
export function getProfileBaseEnglish(profile: SongVisualProfile): string[] {
  const mood = MOOD_OPTIONS.find((m) => m.id === profile.mood);
  const intl = INTERNATIONAL_OPTIONS.find((i) => i.id === profile.international);
  const plat = PLATFORM_OPTIONS.find((p) => p.id === profile.platform);
  const raw: string[] = [];
  if (mood?.keywords?.length) raw.push(...mood.keywords.slice(0, 2));
  if (intl?.keywords?.length) raw.push(intl.keywords[0]!);
  if (plat?.keywords?.length) raw.push(plat.keywords[0]!);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of raw) {
    const x = w.trim().toLowerCase();
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= 5) break;
  }
  return out;
}

function uniqueLowerTokens(tokens: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const x = t.trim().toLowerCase();
    if (!x || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= cap) break;
  }
  return out;
}

/** 画像検索クエリ用: 先に来たパーツ優先・英単語は重複除去（複合語はスペースで分割して比較） */
const IMAGE_QUERY_ORDERED_MAX_TOKENS = 14;
const IMAGE_QUERY_ORDERED_MAX_CHARS = 110;

export function mergeImageSearchQueryPartsOrdered(parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const p = part?.trim();
    if (!p) continue;
    for (const rawTok of p.split(/\s+/)) {
      const low = rawTok.trim().toLowerCase();
      if (low.length < 2) continue;
      if (seen.has(low)) continue;
      seen.add(low);
      out.push(rawTok.trim());
      if (out.length >= IMAGE_QUERY_ORDERED_MAX_TOKENS) {
        let s = out.join(" ");
        if (s.length > IMAGE_QUERY_ORDERED_MAX_CHARS) s = s.slice(0, IMAGE_QUERY_ORDERED_MAX_CHARS).trim();
        return s;
      }
    }
  }
  let s = out.join(" ");
  if (s.length > IMAGE_QUERY_ORDERED_MAX_CHARS) s = s.slice(0, IMAGE_QUERY_ORDERED_MAX_CHARS).trim();
  return s;
}

/** 英語: 土台 + 主役で 5〜8 語程度の候補を 2〜3 本 */
function buildEnglishSearchVariants(base: string[], spotlight: string[]): string[] {
  const s = spotlight.length ? spotlight : [];
  const a = uniqueLowerTokens([...base.slice(0, 4), ...s.slice(0, 4)], 8).join(" ");
  const b = uniqueLowerTokens([...base.slice(0, 2), ...s.slice(0, 8)], 8).join(" ");
  const c =
    s.length >= 4
      ? uniqueLowerTokens(s.slice(0, 10), 8).join(" ")
      : uniqueLowerTokens([...base.slice(0, 3), ...s.slice(0, 5)], 8).join(" ");
  const raw = [a, b, c].filter((q) => q.length > 2);
  return [...new Set(raw)].slice(0, 3);
}

/** 日本語: ラベル土台 + 主役語で 3〜6 語程度の候補を 2〜3 本 */
function buildJapaneseSearchVariants(
  moodLabel: string,
  intlLabel: string,
  platformLabel: string,
  jaSpotlight: string[]
): string[] {
  const baseLabels = [moodLabel, intlLabel, platformLabel].filter(Boolean).slice(0, 3);
  const j = jaSpotlight;
  const line = (parts: string[]) =>
    parts
      .filter(Boolean)
      .slice(0, 6)
      .join(" ")
      .trim();

  const q1 = line([...baseLabels.slice(0, 2), ...j.slice(0, 4)]);
  const q2 = line(j.slice(0, 6));
  const q3 = line([...(platformLabel ? [platformLabel] : []), ...j.slice(1, 7)]);
  const raw = [q1, q2, q3].filter((q) => q.length > 0);
  return [...new Set(raw)].slice(0, 3);
}

export type SegmentSearchAssist = {
  /** 助詞除去→英語化した最優先断片（API・手動検索より前に付与） */
  lyricsPrimeEn: string;
  /** 助詞除去後の日本語キーワード（スペース区切り・表示用） */
  lyricsPrimeJa: string;
  /** 代表の英語候補（1本目）。互換・API用 */
  searchQuery: string;
  /** 代表の日本語候補（1本目）。互換・API用 */
  searchQueryJa: string;
  /** 短い英語候補 2〜3 本（各 5〜8 語目安） */
  searchQueriesEn: string[];
  /** 短い日本語候補 2〜3 本（各 3〜6 語目安） */
  searchQueriesJa: string[];
  /** 画像イメージ候補の短文（最大3つ） */
  imageConcepts: string[];
  /** 短いタグ候補 */
  tags: string[];
};

/**
 * 曲全体プロファイル + 区間歌詞から、画像検索補助を一括生成。
 * 歌詞が空でも曲全体設定ベースで候補を出す。
 * キーワード抽出（2文字以上）に乗らない編集でも追従するよう、生歌詞スニペットを検索案・画像案に含める。
 */
function lyricSnippetForAssist(raw: string, maxLen = 48): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.length <= maxLen ? t : `${t.slice(0, maxLen)}…`;
}

export type GenerateSegmentSearchAssistOptions = {
  /**
   * localStorage 由来の補助トークン（最大4語想定）。
   * 主役（歌詞・プロファイル）のあとにだけ混ぜる。
   */
  historyAuxiliaryTokens?: readonly string[];
};

export function generateSegmentSearchAssist(
  profile: SongVisualProfile,
  segmentLyrics: string,
  options?: GenerateSegmentSearchAssistOptions
): SegmentSearchAssist {
  const moodOpt = MOOD_OPTIONS.find((m) => m.id === profile.mood);
  const intlOpt = INTERNATIONAL_OPTIONS.find((i) => i.id === profile.international);
  const platformOpt = PLATFORM_OPTIONS.find((p) => p.id === profile.platform);

  const moodLabel = moodOpt?.label ?? "";
  const intlLabel = intlOpt?.label ?? "";
  const platformLabel = platformOpt?.label ?? "";
  const lyricEcho = lyricSnippetForAssist(segmentLyrics);

  const trimmedLyrics = segmentLyrics.trim();
  const lyricsPrimeJa = trimmedLyrics ? tokenizeLyricsRemovingParticles(trimmedLyrics).join(" ") : "";
  const lyricsPrimeEn = trimmedLyrics ? buildLyricsPrimeEnglishForImageSearch(trimmedLyrics) : "";
  const primeTokSet = new Set(
    lyricsPrimeEn
      .split(/\s+/)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length >= 1)
  );

  const baseEn = getProfileBaseEnglish(profile);
  const { jaRanked: lyricsJa, enRanked: lyricsEn } = prioritizeLyricsForImageSearch(
    trimmedLyrics ? [trimmedLyrics] : []
  );

  const lyricsEnDeduped = lyricsEn.filter((en) => {
    const words = en.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
    return !words.some((w) => primeTokSet.has(w));
  });

  const searchQueriesEnRaw = buildEnglishSearchVariants(baseEn, lyricsEnDeduped);
  const searchQueriesEn = searchQueriesEnRaw.map((q) =>
    lyricsPrimeEn ? mergeImageSearchQueryPartsOrdered([lyricsPrimeEn, q]) : q
  );
  const searchQueriesJaRaw = buildJapaneseSearchVariants(
    moodLabel,
    intlLabel,
    platformLabel,
    lyricsJa
  );
  const searchQueriesJa = searchQueriesJaRaw.map((q) =>
    lyricsPrimeJa ? `${lyricsPrimeJa} ${q}`.trim() : q
  );

  const histTokens = (options?.historyAuxiliaryTokens ?? [])
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 4);
  const histStr =
    histTokens.length > 0 ? mergeImageSearchQueryPartsOrdered(histTokens) : "";

  let searchQueriesEnFinal = searchQueriesEn;
  let searchQueriesJaFinal = searchQueriesJa;
  if (histStr) {
    searchQueriesEnFinal = searchQueriesEn.map((q) =>
      mergeImageSearchQueryPartsOrdered([q, histStr])
    );
    searchQueriesJaFinal = searchQueriesJa.map((q) =>
      mergeImageSearchQueryPartsOrdered([q, histStr])
    );
  }

  const searchQuery =
    searchQueriesEnFinal[0] ?? (lyricsPrimeEn || baseEn.join(" "));
  const searchQueryJa = searchQueriesJaFinal[0] ?? searchQuery;

  /** タグ: 土台を最大限圧縮し、主役英語を上位数個だけ。履歴は末尾に少しだけ */
  const tagParts = uniqueLowerTokens(
    [
      ...baseEn.slice(0, 4),
      ...lyricsEnDeduped.slice(0, 5),
      ...(lyricEcho && lyricEcho.length <= 20 ? [lyricEcho.replace(/\s+/g, "-")] : []),
      ...histTokens,
    ],
    12
  );
  const tags = tagParts;

  const imageConcepts: string[] = [];
  if (lyricEcho) {
    imageConcepts.push(`歌詞のイメージ: ${lyricEcho}`);
  }
  if (moodLabel || intlLabel || lyricsJa.length > 0) {
    const parts: string[] = [];
    if (moodLabel) parts.push(`${moodLabel}的`);
    if (intlLabel) parts.push(`${intlLabel}感`);
    if (lyricsJa.length > 0) parts.push(lyricsJa.slice(0, 3).join("・"));
    if (parts.length > 0) {
      imageConcepts.push(parts.join("／") + "のビジュアル");
    }
  }
  if (intlLabel && platformLabel) {
    imageConcepts.push(`${platformLabel}向け・${intlLabel}テイスト`);
  }
  if (imageConcepts.length === 0 && tags.length > 0) {
    imageConcepts.push(tags.slice(0, 5).join(" · ") + " で検索");
  }

  return {
    lyricsPrimeEn,
    lyricsPrimeJa,
    searchQuery,
    searchQueryJa: searchQueryJa || searchQuery,
    searchQueriesEn: searchQueriesEnFinal.length
      ? searchQueriesEnFinal
      : [searchQuery].filter(Boolean),
    searchQueriesJa: searchQueriesJaFinal.length
      ? searchQueriesJaFinal
      : [searchQueryJa].filter(Boolean),
    imageConcepts: imageConcepts.slice(0, 3),
    tags,
  };
}

/** 自動モード: 代表英語クエリ or タグ連結（従来どおり） */
export function buildAutoImageSearchQuery(assist: SegmentSearchAssist): string {
  return assist.searchQuery.trim() || assist.tags.filter(Boolean).join(" ").trim();
}

const MANUAL_IMAGE_QUERY_MAX_LEN = 110;
/** 手動検索ありの場合、土台補助は最大1語まで（青春/ラテン/TikTok が手動語を邪魔しないように） */
const MANUAL_ASSIST_EXTRA_MAX = 1;

/** 日本語フレーズ → API 用英語クエリ（翻訳＋文脈語）。手動検索で使う */
const MANUAL_SEARCH_PHRASE_EXPANSIONS: Record<string, string> = {
  レッドカード: "red card soccer football referee foul player sent off",
  イエローカード: "soccer football referee foul warning",
  サッカー: "soccer football player field",
  野球: "baseball player field",
  バスケ: "basketball court player",
  バスケットボール: "basketball court player",
};

/** 手動検索入力を API 用英語クエリに展開。日本語は辞書で英訳し、既知フレーズは文脈語を追加 */
function expandManualSearchForApi(manual: string): string {
  const t = manual.trim().normalize("NFKC");
  if (!t) return "";

  // 既知フレーズ: 翻訳＋文脈語をそのまま使用（英語のみで API に送る）
  const expansion = MANUAL_SEARCH_PHRASE_EXPANSIONS[t];
  if (expansion) {
    return mergeImageSearchQueryPartsOrdered([expansion]).trim();
  }

  // スペース・読点で分割
  const parts = t.split(/[\s,，、]+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const enTerms = japaneseImageTokensToEnglishTerms([part]);
    if (enTerms.length > 0) {
      out.push(...enTerms);
    } else {
      // 辞書にない場合はそのまま（Pixabay が解釈する可能性）
      if (part.length >= 2) out.push(part);
    }
  }

  if (out.length === 0) return t;
  return mergeImageSearchQueryPartsOrdered(out).trim() || t;
}

/**
 * 手動検索優先: 手動語を主役にする。土台（青春/ラテン/TikTok）は補助最大1語まで。
 * - 手動語を先頭に置く（prime は入れない）
 * - 日本語入力は expandManualSearchForApi で英訳・文脈展開
 */
export function buildManualFocusedImageSearchQuery(
  manualTrimmed: string,
  assist: SegmentSearchAssist,
  profile: SongVisualProfile
): string {
  const manual = manualTrimmed.trim();
  if (!manual) return buildAutoImageSearchQuery(assist);

  // 手動語を API 用に展開（日本語→英語、既知フレーズの文脈追加）
  const manualExpanded = expandManualSearchForApi(manual);

  const manualTok = new Set(
    manualExpanded
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  );
  const extras: string[] = [];

  const tryAdd = (w: string) => {
    const x = w.trim();
    if (!x || extras.length >= MANUAL_ASSIST_EXTRA_MAX) return;
    const low = x.toLowerCase();
    if (manualTok.has(low)) return;
    if (extras.some((e) => e.toLowerCase() === low)) return;
    extras.push(x);
  };

  // 補助: 曲土台から最大1語のみ（青春/ラテン/TikTok が手動語を邪魔しない）
  for (const w of getProfileBaseEnglish(profile)) {
    tryAdd(w);
    if (extras.length >= 1) break;
  }

  /** 手動語を最優先、補助は最大1語 */
  const ordered = mergeImageSearchQueryPartsOrdered(
    [manualExpanded, extras.join(" ")].filter((s) => s.trim().length > 0)
  );
  if (!ordered) return manualExpanded || manual;
  if (ordered.length > MANUAL_IMAGE_QUERY_MAX_LEN) {
    return ordered.slice(0, MANUAL_IMAGE_QUERY_MAX_LEN).trim() || manualExpanded || manual;
  }
  return ordered;
}

/**
 * 画像検索用の最終クエリ（検索バー最優先）。
 * - バーが空 → フル自動
 * - 未編集でバーが自動生成文と同一 → フル自動（補助の二重付与を避ける）
 * - それ以外 → **いまの検索バー**を主役＋土台・タグを少量だけ補助
 * @deprecated 明示検索フローでは {@link resolveImageSearchApiQuery} を使う
 */
export function buildEffectiveImageSearchQuery(
  opts: {
    assist: SegmentSearchAssist;
    profile: SongVisualProfile;
    /** 検索バーの現在値 */
    draft: string;
    /** ユーザーが検索バーを編集したか（未編集で同期された自動文だけなら false） */
    draftUserTouched: boolean;
  }
): string {
  const autoQ = buildAutoImageSearchQuery(opts.assist);
  const draft = opts.draft.trim();

  if (!draft) return autoQ;

  if (!opts.draftUserTouched && draft === autoQ.trim()) {
    return autoQ;
  }

  return buildManualFocusedImageSearchQuery(draft, opts.assist, opts.profile);
}

/**
 * 「検索」確定後の API 用クエリ。
 * - manualMode が false → 常にフル自動（自動候補を薄めない）
 * - manualMode が true → 確定バー文言を主役、補助は最大3語まで
 */
export function resolveImageSearchApiQuery(
  assist: SegmentSearchAssist,
  profile: SongVisualProfile,
  /** 確定した検索バー（空のときは呼び出し側で auto に寄せる） */
  committedBarText: string,
  manualMode: boolean
): string {
  const autoQ = buildAutoImageSearchQuery(assist);
  const t = committedBarText.trim();
  if (!t) return autoQ;
  if (!manualMode) return autoQ;
  return buildManualFocusedImageSearchQuery(t, assist, profile);
}
