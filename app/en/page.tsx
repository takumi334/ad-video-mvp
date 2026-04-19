import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Home",
  alternates: {
    canonical: "/en",
    languages: {
      ja: "/",
      en: "/en",
    },
  },
  openGraph: { url: "/en" },
};

export default function EnHomePage() {
  return (
    <main style={{ padding: "40px 24px", maxWidth: 640, margin: "0 auto", lineHeight: 1.75 }}>
      <p style={{ marginBottom: 16, fontSize: 14 }}>
        <Link href="/" style={{ color: "#2563eb" }}>
          日本語サイトへ / Japanese site
        </Link>
      </p>

      <article
        style={{
          marginBottom: 28,
          padding: "20px 24px",
          background: "#f8fafc",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          color: "#334155",
        }}
      >
        <h1 style={{ margin: "0 0 12px 0", fontSize: 22, color: "#0f172a" }}>
          Free video editor for karaoke covers & lyric videos
        </h1>
        <p style={{ margin: "0 0 12px 0", fontSize: 15 }}>
          Upload a music video (MP4, etc.) and align on-screen lyrics with your performance—similar to making a{" "}
          <strong>lyric video</strong> or preparing an <strong>MV</strong>. Image search helps you pick visuals. The
          editor runs in the browser and is <strong>free to try</strong>.
        </p>
        <p style={{ margin: 0, fontSize: 15 }}>
          If you searched for <strong>free video editing</strong>, <strong>lyric video maker</strong>, or{" "}
          <strong>free MV maker</strong>, start from the upload page below (the editing UI is currently shared with the
          Japanese site).
        </p>
      </article>

      <h2 style={{ fontSize: 17, marginBottom: 12, color: "#0f172a" }}>Guides</h2>
      <ul style={{ paddingLeft: 20, margin: "0 0 24px 0", color: "#334155" }}>
        <li style={{ marginBottom: 8 }}>
          <Link href="/en/lyrics-video-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            Lyrics video maker (free)
          </Link>
        </li>
        <li style={{ marginBottom: 8 }}>
          <Link href="/en/free-mv-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            Free MV maker
          </Link>
        </li>
        <li>
          <Link href="/utattemita-edit" style={{ color: "#2563eb" }}>
            Workflow guide (Japanese)
          </Link>
        </li>
      </ul>

      <Link
        href="/upload"
        style={{
          display: "inline-block",
          padding: "12px 22px",
          background: "#0f172a",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 16,
        }}
      >
        Upload a video
      </Link>
      <p style={{ marginTop: 16, fontSize: 13, color: "#64748b" }}>
        After upload you will continue in the shared editor (Japanese UI labels may appear in some screens).
      </p>
    </main>
  );
}
