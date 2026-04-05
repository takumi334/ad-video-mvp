/**
 * 区間ごとの画面フィルター・歌詞スタイル（プレビュー用。軽量 CSS 中心）
 */

export type SegmentScreenFilter =
  | "normal"
  | "monochrome"
  | "sepia"
  | "negative"
  | "retroHeisei"
  | "softFade"
  | "highContrast";

export const SEGMENT_SCREEN_FILTER_LIST: SegmentScreenFilter[] = [
  "normal",
  "monochrome",
  "sepia",
  "negative",
  "retroHeisei",
  "softFade",
  "highContrast",
];

export const SEGMENT_SCREEN_FILTER_OPTIONS: { value: SegmentScreenFilter; label: string }[] = [
  { value: "normal", label: "通常" },
  { value: "monochrome", label: "白黒" },
  { value: "sepia", label: "セピア" },
  { value: "negative", label: "ネガ" },
  { value: "retroHeisei", label: "平成初期風（軽量）" },
  { value: "softFade", label: "色あせ" },
  { value: "highContrast", label: "高コントラスト" },
];

export const DEFAULT_LYRICS_FONT_SIZE = 40;
export const LYRICS_FONT_SIZE_MIN = 24;
export const LYRICS_FONT_SIZE_MAX = 72;

export const LYRICS_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: "白", value: "#ffffff" },
  { label: "黒", value: "#111111" },
  { label: "赤", value: "#e53935" },
  { label: "青", value: "#1e88e5" },
  { label: "黄", value: "#fdd835" },
  { label: "ピンク", value: "#ec407a" },
];

const DEFAULT_LYRICS_COLOR = "#ffffff";

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** 相対輝度（簡易 sRGB）— 影の色の切替用 */
export function lyricsRelativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function lyricsTextShadowForColor(hex: string): string {
  const L = lyricsRelativeLuminance(hex);
  return L > 0.55
    ? "0 0 8px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.7)"
    : "0 0 10px rgba(0,0,0,0.9), 0 1px 3px rgba(0,0,0,0.8)";
}

/** メディア・合成レイヤー用。`normal` は undefined（filter なし） */
export function segmentScreenFilterCss(f: SegmentScreenFilter | undefined): string | undefined {
  if (!f || f === "normal") return undefined;
  switch (f) {
    case "monochrome":
      return "grayscale(1) contrast(1.06)";
    case "sepia":
      return "sepia(0.62) contrast(0.96) brightness(1.03)";
    case "negative":
      return "invert(1) hue-rotate(180deg)";
    case "softFade":
      return "saturate(0.78) brightness(1.06) contrast(0.93)";
    case "highContrast":
      return "contrast(1.32) saturate(1.08)";
    case "retroHeisei":
      return "saturate(0.68) contrast(1.12) brightness(1.04) blur(0.45px)";
    default:
      return undefined;
  }
}

export function parseSegmentScreenFilter(v: unknown): SegmentScreenFilter {
  if (typeof v !== "string") return "normal";
  return SEGMENT_SCREEN_FILTER_LIST.includes(v as SegmentScreenFilter)
    ? (v as SegmentScreenFilter)
    : "normal";
}

export function clampLyricsFontSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LYRICS_FONT_SIZE;
  return Math.min(LYRICS_FONT_SIZE_MAX, Math.max(LYRICS_FONT_SIZE_MIN, Math.round(n)));
}

export function normalizeLyricsColorHex(v: unknown): string {
  if (typeof v !== "string") return DEFAULT_LYRICS_COLOR;
  const t = v.trim();
  if (/^#[0-9a-f]{6}$/i.test(t)) return t.toLowerCase();
  return DEFAULT_LYRICS_COLOR;
}
