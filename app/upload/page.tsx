"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { upload } from "@vercel/blob/client";
import { readFetchJson } from "@/lib/http/readFetchJson";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import {
  formatBytes,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/upload/videoUpload";
import {
  generateOwnerSecret,
  setVideoOwnerSecret,
} from "@/lib/videoOwnerToken";

const ACCEPT =
  ".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" as const;

export default function UploadPage() {
  const { t } = useUiLocale();
  const router = useRouter();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError(
        t("uploadFileTooLarge").replace("{size}", formatBytes(MAX_VIDEO_UPLOAD_BYTES))
      );
      return;
    }

    setIsUploading(true);
    setError(null);
    const ownerSecret = generateOwnerSecret();

    try {
      const configRes = await fetch("/api/blob-upload", { method: "GET" });
      const configParsed = await readFetchJson<{
        ok?: boolean;
        message?: string;
      }>(configRes);
      if (!configParsed.ok) {
        setError(configParsed.message);
        return;
      }
      if (!configParsed.data?.ok) {
        setError(
          configParsed.data?.message ??
            t("uploadConfigError")
        );
        return;
      }

      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
      });
      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          url: blob.url,
          size: file.size,
          mime: file.type || "video/mp4",
          ownerSecret,
        }),
      });
      const parsed = await readFetchJson<{
        ok?: boolean;
        message?: string;
        video?: { id?: number };
      }>(res);

      if (!parsed.ok) {
        setError(parsed.message ?? t("uploadSomethingWrong"));
        return;
      }

      const json = parsed.data;
      if (!json?.ok) {
        setError(
          json?.message ??
            t("uploadFailed")
        );
        return;
      }

      const video = json.video;
      if (video?.id != null) {
        setVideoOwnerSecret(video.id, ownerSecret);
        router.push(`/videos/${video.id}/sync`);
        return;
      }
      setError(t("uploadMissingVideoId"));
    } catch (e) {
      if (
        e instanceof Error &&
        e.message.includes("FUNCTION_PAYLOAD_TOO_LARGE")
      ) {
        setError(t("uploadVideoTooLarge").replace("{size}", formatBytes(MAX_VIDEO_UPLOAD_BYTES)));
      } else {
        setError(
          e instanceof Error ? e.message : "An error occurred while uploading."
        );
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-10 sm:px-8">
      <nav className="mb-8 flex flex-wrap gap-x-4 gap-y-2 text-sm text-neutral-600">
        <Link href="/" className="underline-offset-4 hover:underline">
          {t("navTop")}
        </Link>
        <Link href="/videos" className="underline-offset-4 hover:underline">
          {t("navVideos")}
        </Link>
      </nav>

      <h1 className="mb-2 text-2xl font-semibold tracking-tight text-neutral-900">
        {t("uploadTitle")}
      </h1>
      <p className="mb-1 text-sm text-neutral-500">
        {t("uploadLimitLabel")} {formatBytes(MAX_VIDEO_UPLOAD_BYTES)}
      </p>
      <p className="mb-10 text-sm text-neutral-500">
        {t("uploadSupportedFormats")}
      </p>

      <form onSubmit={onSubmit} className="space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-4">
          <input
            id={inputId}
            type="file"
            accept={ACCEPT}
            disabled={isUploading}
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <label
            htmlFor={inputId}
            className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-2 border-neutral-900 bg-white px-5 py-2.5 text-sm font-medium text-neutral-900 shadow-sm transition hover:bg-neutral-50 focus-within:ring-2 focus-within:ring-neutral-900 focus-within:ring-offset-2 ${
              isUploading ? "pointer-events-none opacity-50" : ""
            }`}
          >
            {t("uploadChooseFile")}
          </label>

          <p
            className={`min-h-6 flex-1 text-sm sm:min-w-0 ${
              file ? "text-neutral-900" : "text-neutral-400"
            }`}
            aria-live="polite"
          >
            {file ? (
              <span className="break-all font-medium">{file.name}</span>
            ) : (
              t("uploadNoFile")
            )}
          </p>

          <button
            type="submit"
            disabled={isUploading || !file}
            className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-400 sm:w-auto"
          >
            {isUploading ? t("uploadUploading") : t("uploadUploadButton")}
          </button>
        </div>

        {file && (
          <p className="text-sm text-neutral-500">
            {t("uploadFileSizeLabel")} {formatBytes(file.size)}
          </p>
        )}
      </form>

      {error && (
        <div
          className="mt-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <span className="font-medium">{t("uploadErrorPrefix")} </span>
          {error}
        </div>
      )}
    </div>
  );
}
