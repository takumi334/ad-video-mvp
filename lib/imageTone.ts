/**
 * 全体画像トーンと歌詞→検索語生成。
 * 世界観を統一した自動画像割当のため。
 */

import { aggregateKeywords, estimateTheme } from "@/lib/theme/parseLyricsTheme";

/** 全体トーンのプリセット */
export type ImageToneId =
  | "neutral"
  | "monochrome"
  | "dark"
  | "blue"
  | "cinematic"
  | "emo"
  | "unsettling"
  | "office"
  | "night"
  | "nostalgia"
  | "indoor"
  | "abstract"
  | "minimal-people"
  | "object-focused"
  | "background-focused";

export type ImageToneOption = {
  id: ImageToneId;
  label: string;
  /** Pixabay検索に追加するキーワード */
  keywords: string[];
};

export const IMAGE_TONE_OPTIONS: ImageToneOption[] = [
  { id: "neutral", label: "標準", keywords: [] },
  { id: "monochrome", label: "モノクロ", keywords: ["black and white", "monochrome", "grayscale"] },
  { id: "dark", label: "暗め", keywords: ["dark", "shadow", "moody", "low light"] },
  { id: "blue", label: "青寄り", keywords: ["blue", "cool tone", "blue hour"] },
  { id: "cinematic", label: "シネマ風", keywords: ["cinematic", "film", "dramatic lighting"] },
  { id: "emo", label: "エモ", keywords: ["emotional", "melancholy", "atmospheric"] },
  { id: "unsettling", label: "不穏", keywords: ["unsettling", "eerie", "surreal", "dark mood"] },
  { id: "office", label: "オフィス風", keywords: ["office", "corporate", "business"] },
  { id: "night", label: "夜", keywords: ["night", "nocturnal", "city lights", "neon"] },
  { id: "nostalgia", label: "ノスタルジー", keywords: ["nostalgic", "retro", "vintage", "memories"] },
  { id: "indoor", label: "室内多め", keywords: ["indoor", "interior", "room"] },
  { id: "abstract", label: "抽象多め", keywords: ["abstract", "minimal", "texture"] },
  { id: "minimal-people", label: "人物少なめ", keywords: ["empty", "minimal", "solitude"] },
  { id: "object-focused", label: "物中心", keywords: ["still life", "object", "close up"] },
  { id: "background-focused", label: "背景中心", keywords: ["landscape", "background", "wide"] },
];

/** 歌詞テキスト1行から検索用キーワードを生成（歌詞の意味＋全体トーン） */
export function lyricsToSearchTerms(lyricsText: string, toneId: ImageToneId): string {
  const phrase = (lyricsText ?? "").trim();
  if (!phrase) return "";

  const keywords = aggregateKeywords([phrase]);
  const themeWords = estimateTheme(keywords);
  const lyricsPart = themeWords.slice(0, 6).join(" ");

  const tone = IMAGE_TONE_OPTIONS.find((t) => t.id === toneId);
  const tonePart = tone?.keywords.slice(0, 3).join(" ") ?? "";

  const parts = [lyricsPart, tonePart].filter(Boolean);
  return parts.join(" ").trim();
}
