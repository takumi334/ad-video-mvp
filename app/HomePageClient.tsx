"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { readFetchJson } from "@/lib/http/readFetchJson";
import { isHomeImageFile, isHomeVideoFile } from "@/lib/homeMediaKinds";
import { putPendingHomeImage } from "@/lib/homePendingImageIdb";
import {
  formatBytes,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/upload/videoUpload";
import { generateOwnerSecret, setVideoOwnerSecret } from "@/lib/videoOwnerToken";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";

export default function HomePageClient() {
  const router = useRouter();
  const { t } = useUiLocale();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file || !isHomeVideoFile(file)) {
      setVideoPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setVideoPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  async function handleUploadAndNext() {
    if (!file) return;
    if (!isHomeVideoFile(file)) return;
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError(t("uploadFileTooLarge").replace("{size}", formatBytes(MAX_VIDEO_UPLOAD_BYTES)));
      return;
    }
    setError(null);
    setIsUploading(true);
    const ownerSecret = generateOwnerSecret();
    try {
      const configRes = await fetch("/api/blob-upload", { method: "GET" });
      const configParsed = await readFetchJson<{ ok?: boolean; message?: string }>(
        configRes
      );
      if (!configParsed.ok) {
        setError(configParsed.message);
        return;
      }
      if (!configParsed.data?.ok) {
        setError(configParsed.data?.message ?? t("uploadConfigError"));
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
        setError(parsed.message);
        return;
      }
      const json = parsed.data;
      if (!json?.ok) {
        setError(json?.message ?? t("uploadFailed"));
        return;
      }
      const video = json.video;
      if (video?.id != null) {
        setVideoOwnerSecret(video.id, ownerSecret);
        window.location.href = `/videos/${video.id}/sync`;
        return;
      }
      setError(t("uploadMissingVideoId"));
    } catch (e) {
      const fallback = t("uploadSomethingWrong");
      if (e instanceof Error && e.message.includes("FUNCTION_PAYLOAD_TOO_LARGE")) {
        setError(t("uploadVideoTooLarge").replace("{size}", formatBytes(MAX_VIDEO_UPLOAD_BYTES)));
      } else {
        setError(e instanceof Error ? e.message : fallback);
      }
    } finally {
      setIsUploading(false);
    }
  }

  function handleImagePick(picked: File | null, clearInput: () => void) {
    if (!picked) return;
    if (!isHomeImageFile(picked)) {
      setError(t("homePickImageError"));
      clearInput();
      return;
    }
    setError(null);
    setFile(null);
    void (async () => {
      try {
        await putPendingHomeImage(picked);
      } catch {
        // 失敗時もデモへ（手動で選び直せる）
      }
      router.push("/demo/eating");
    })();
    clearInput();
  }

  function handleVideoPick(picked: File | null, clearInput: () => void) {
    setError(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (!isHomeVideoFile(picked)) {
      setFile(null);
      setError(t("homePickVideoError"));
      clearInput();
      return;
    }
    setFile(picked);
  }

  return (
    <div
      style={{
        maxWidth: 980,
        margin: "0 auto",
        padding: "24px 16px 56px",
        background:
          "linear-gradient(180deg, #87ceeb 0%, #bfe8ff 28%, #e8f7ff 58%, #ffffff 100%)",
        color: "#0f172a",
        borderRadius: 24,
      }}
    >
      <section
        style={{
          border: "1px solid #bfdbfe",
          borderRadius: 24,
          padding: "28px 20px",
          background:
            "radial-gradient(circle at 16% 22%, rgba(255,255,255,0.95) 0 110px, transparent 120px), radial-gradient(circle at 78% 16%, rgba(255,255,255,0.9) 0 90px, transparent 100px), #f8fcff",
          boxShadow: "0 14px 40px rgba(56, 189, 248, 0.16)",
        }}
      >
        <p style={{ margin: "0 0 10px 0", fontSize: 13, color: "#0369a1", fontWeight: 700 }}>
          {t("homeHeroBadge")}
        </p>
        <h1 style={{ margin: 0, fontSize: "clamp(30px, 6vw, 46px)", lineHeight: 1.2 }}>
          {t("homeHeroTitle")}
        </h1>
        <p style={{ margin: "14px 0 0 0", fontSize: 16, lineHeight: 1.7, color: "#374151" }}>
          {t("homeHeroDescription")}
        </p>
        <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => videoInputRef.current?.click()}
            style={{
              padding: "12px 18px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              border: "1px solid #0ea5e9",
              background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 8px 20px rgba(37, 99, 235, 0.25)",
            }}
          >
            {t("homeCtaVideo")}
          </button>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            style={{
              padding: "12px 18px",
              fontSize: 15,
              fontWeight: 700,
              borderRadius: 10,
              border: "1px solid #93c5fd",
              background: "#ffffff",
              color: "#1e3a8a",
              cursor: "pointer",
            }}
          >
            {t("homeCtaImage")}
          </button>
        </div>
        <p style={{ margin: "12px 0 0 0", fontSize: 12, color: "#6b7280" }}>
          {t("homeSupportedFormatsLabel")} MP4 / MOV / WEBM / PNG / JPG / WebP
        </p>
      </section>

      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          handleVideoPick(picked, () => {
            e.target.value = "";
          });
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
        aria-label={t("homeSelectVideoAria")}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          handleImagePick(picked, () => {
            e.target.value = "";
          });
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
        aria-label={t("homeSelectImageAria")}
      />

      {file && (
        <section
          style={{
            marginTop: 20,
            padding: 16,
            border: "1px solid #bfdbfe",
            borderRadius: 16,
            background: "#ffffff",
          }}
        >
          <p style={{ margin: "0 0 8px 0", fontSize: 14, color: "#666" }}>{t("homeSelectedFileLabel")}</p>
          <strong>{file.name}</strong>
          <p style={{ margin: "8px 0 0 0", fontSize: 13, color: "#666" }}>
            {t("homeSizeLabel")} {formatBytes(file.size)} / {t("homeLimitLabel")}{" "}
            {formatBytes(MAX_VIDEO_UPLOAD_BYTES)}
          </p>
          <div style={{ marginTop: 12 }}>
            {videoPreviewUrl ? (
              <video
                width={320}
                controls
                src={videoPreviewUrl}
                style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid #e5e7eb" }}
              />
            ) : null}
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleUploadAndNext}
              disabled={isUploading}
              style={{
                padding: "12px 24px",
                fontSize: 16,
                fontWeight: 600,
                cursor: isUploading ? "not-allowed" : "pointer",
                border: "none",
                borderRadius: 10,
                background: "linear-gradient(135deg, #0ea5e9, #2563eb)",
                color: "#fff",
              }}
            >
              {isUploading ? t("uploadUploading") : t("homeUploadNextButton")}
            </button>
          </div>
        </section>
      )}

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            color: "#c00",
            background: "#fff0f0",
            borderRadius: 10,
            border: "1px solid #fecaca",
          }}
        >
          {error}
        </div>
      )}

      <section style={{ marginTop: 26 }}>
        <h2 style={{ margin: "0 0 14px 0", fontSize: 22 }}>{t("homeThreeStepsTitle")}</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 12,
          }}
        >
          {[
            t("homeStep1"),
            t("homeStep2"),
            t("homeStep3"),
          ].map((step, index) => (
            <article
              key={step}
              style={{
                border: "1px solid #bae6fd",
                borderRadius: 14,
                padding: "14px 14px 16px",
                background: "rgba(255,255,255,0.92)",
              }}
            >
              <p style={{ margin: "0 0 6px 0", fontSize: 12, color: "#6b7280" }}>
                STEP {index + 1}
              </p>
              <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.5 }}>{step}</p>
            </article>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 26 }}>
        <h2 style={{ margin: "0 0 14px 0", fontSize: 22 }}>{t("homeFeatureTitle")}</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          {[t("homeFeatureLyricsSync"), t("homeFeatureImageCrop"), t("homeFeatureFlowPreview"), t("homeFeatureShortVertical")].map((feature) => (
            <article
              key={feature}
              style={{
                border: "1px solid #bfdbfe",
                borderRadius: 14,
                padding: "16px 14px",
                background: "rgba(255,255,255,0.94)",
              }}
            >
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{feature}</p>
            </article>
          ))}
        </div>
      </section>

      <article
        style={{
          marginTop: 32,
          marginBottom: 32,
          padding: "20px 24px",
          background: "rgba(255, 255, 255, 0.94)",
          borderRadius: 12,
          border: "1px solid #bfdbfe",
          lineHeight: 1.75,
          fontSize: 15,
          color: "#334155",
        }}
      >
        <h2 style={{ margin: "0 0 12px 0", fontSize: 18, color: "#0f172a" }}>{t("homeSeoHeading")}</h2>
        <p style={{ margin: "0 0 12px 0" }}>{t("homeSeoBody1")}</p>
        <p style={{ margin: "0 0 12px 0" }}>{t("homeSeoBody2")}</p>
        <p style={{ margin: "0 0 12px 0" }}>
          歌ってみた編集の流れや用語の整理は{" "}
          <Link href="/utattemita-edit" style={{ color: "#2563eb", fontWeight: 600 }}>
            歌ってみた動画編集（無料）のご案内
          </Link>
          、<Link href="/lyrics-video-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            歌詞動画メーカー（無料）
          </Link>
          、<Link href="/free-mv-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            無料MVメーカー
          </Link>
          もご覧ください。
        </p>
        <p style={{ margin: 0 }}>
          English speakers:{" "}
          <Link href="/en" style={{ color: "#2563eb", fontWeight: 600 }}>
            English site (/en)
          </Link>
        </p>
      </article>

      <nav style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #bfdbfe" }}>
        <p style={{ margin: "0 0 12px 0", fontSize: 14, color: "#666" }}>{t("homeSeoOtherLinks")}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link
            href="/en"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#ecfdf5",
              borderRadius: 6,
              color: "#047857",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            English (/en)
          </Link>
          <Link
            href="/materials"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#333",
              borderRadius: 6,
              color: "#fff",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            素材検索へ（Pixabay）
          </Link>
          <Link
            href="/videos"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#f5f5f5",
              borderRadius: 6,
              color: "#333",
              textDecoration: "none",
              fontSize: 15,
            }}
          >
            動画一覧
          </Link>
          <Link
            href="/utattemita-edit"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#eff6ff",
              borderRadius: 6,
              color: "#1d4ed8",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            歌ってみた編集のご案内
          </Link>
          <Link
            href="/lyrics-video-maker"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#fef3c7",
              borderRadius: 6,
              color: "#92400e",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            歌詞動画メーカー
          </Link>
          <Link
            href="/free-mv-maker"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#fce7f3",
              borderRadius: 6,
              color: "#9d174d",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            無料MVメーカー
          </Link>
        </div>
        <p style={{ margin: "12px 0 0 0", fontSize: 13, color: "#888" }}>{t("homeFooterHint")}</p>
      </nav>
    </div>
  );
}
