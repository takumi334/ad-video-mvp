"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SegmentScreenFilter } from "@/lib/segmentVisualStyle";
import {
  DEFAULT_UI_LOCALE,
  UI_LOCALE_OPTIONS,
  UI_LOCALE_STORAGE_KEY,
  type UiLocale,
  isUiLocale,
} from "./uiLocale";
import {
  getOverlayPositionLabel,
  getScreenFilterLabel,
  getUiString,
  type OverlayPositionUiKey,
  type UiStringKey,
} from "./uiDictionary";

type Ctx = {
  locale: UiLocale;
  setLocale: (l: UiLocale) => void;
  t: (key: UiStringKey) => string;
  screenFilterLabel: (v: SegmentScreenFilter) => string;
  overlayPosLabel: (pos: OverlayPositionUiKey) => string;
  localeOptions: typeof UI_LOCALE_OPTIONS;
};

const UiLocaleContext = createContext<Ctx | null>(null);

export function UiLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_UI_LOCALE);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(UI_LOCALE_STORAGE_KEY);
      if (raw && isUiLocale(raw)) setLocaleState(raw);
    } catch {
      /* ignore */
    }
  }, []);

  const setLocale = useCallback((l: UiLocale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(UI_LOCALE_STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const htmlLang: Record<UiLocale, string> = {
      en: "en",
      es: "es",
      pt: "pt",
      id: "id",
      th: "th",
      ko: "ko",
      ja: "ja",
    };
    document.documentElement.lang = htmlLang[locale] ?? "en";
  }, [locale]);

  const t = useCallback((key: UiStringKey) => getUiString(locale, key), [locale]);

  const screenFilterLabel = useCallback(
    (v: SegmentScreenFilter) => getScreenFilterLabel(locale, v),
    [locale]
  );

  const overlayPosLabel = useCallback(
    (pos: OverlayPositionUiKey) => getOverlayPositionLabel(locale, pos),
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      screenFilterLabel,
      overlayPosLabel,
      localeOptions: UI_LOCALE_OPTIONS,
    }),
    [locale, setLocale, t, screenFilterLabel, overlayPosLabel]
  );

  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export function useUiLocale(): Ctx {
  const ctx = useContext(UiLocaleContext);
  if (!ctx) {
    throw new Error("useUiLocale must be used within UiLocaleProvider");
  }
  return ctx;
}
