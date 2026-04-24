"use client";

import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";

export function GlobalLocaleSelect() {
  const { locale, setLocale, localeOptions, t } = useUiLocale();

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 2000,
        background: "rgba(255,255,255,0.92)",
        border: "1px solid #d1d5db",
        borderRadius: 10,
        padding: "6px 8px",
        backdropFilter: "blur(4px)",
      }}
    >
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span>{t("displayLanguage")}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          style={{ border: "1px solid #cbd5e1", borderRadius: 6, padding: "2px 6px" }}
        >
          {localeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
