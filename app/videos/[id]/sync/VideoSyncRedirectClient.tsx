"use client";

import Link from "next/link";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";

export function VideoSyncRedirectClient({ editHref }: { editHref: string }) {
  const { t } = useUiLocale();

  return (
    <div style={{ padding: 24 }}>
      <meta httpEquiv="refresh" content={`0;url=${editHref}`} />
      <p>{t("syncRedirectLoading")}</p>
      <p>
        {t("syncRedirectDescription")} <Link href={editHref}>{t("syncRedirectClickHere")}</Link>
      </p>
    </div>
  );
}
