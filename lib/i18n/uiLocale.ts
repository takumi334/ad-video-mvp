/** UI display locale (not lyrics / subtitles). */

export const UI_LOCALE_STORAGE_KEY = "ad-video-mvp-ui-locale";

export const UI_LOCALES = ["en", "es", "pt", "id", "th", "ko", "ja"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** Change default for new visitors here only. */
export const DEFAULT_UI_LOCALE: UiLocale = "en";

/** Select options: value + native label (display order). */
export const UI_LOCALE_OPTIONS: { value: UiLocale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "th", label: "ไทย" },
  { value: "ko", label: "한국어" },
  { value: "ja", label: "日本語" },
];

export function isUiLocale(v: string): v is UiLocale {
  return (UI_LOCALES as readonly string[]).includes(v);
}
