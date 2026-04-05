"use client";

import Link from "next/link";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";

export function SyncPageNav() {
  const { t } = useUiLocale();
  return (
    <nav style={{ marginBottom: 16 }}>
      <Link href="/" style={{ marginRight: 12 }}>
        {t("navTop")}
      </Link>
      <Link href="/videos" style={{ marginRight: 12 }}>
        {t("navVideoList")}
      </Link>
      <Link href="/materials">{t("materialSearchLink")}</Link>
    </nav>
  );
}
