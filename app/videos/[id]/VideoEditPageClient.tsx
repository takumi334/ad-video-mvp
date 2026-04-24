"use client";

import Link from "next/link";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import { SyncPageNav } from "./sync/SyncPageNav";
import { LyricsSyncClient } from "./sync/LyricsSyncClient";

export function VideoEditPageClient({ videoId }: { videoId: number }) {
  const { t } = useUiLocale();

  return (
    <div style={{ padding: 24 }}>
      <p>
        <Link href={`/videos/${videoId}/sync`}>
          {t("editorBackToSync")} /videos/{videoId}/sync
        </Link>
      </p>
      <SyncPageNav />
      <LyricsSyncClient videoId={videoId} />
    </div>
  );
}
