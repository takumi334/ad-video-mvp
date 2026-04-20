import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Lyrics video maker (free)",
  description:
    "Make a lyric-style video in the browser: upload your cover, line up lyrics with timing, and preview on-screen text. Free to try for karaoke covers and utattemita.",
  alternates: {
    canonical: "/en/lyrics-video-maker",
    languages: {
      ja: "/lyrics-video-maker",
      en: "/en/lyrics-video-maker",
    },
  },
  openGraph: {
    title: "Lyrics video maker (free) | Free Video Editor",
    description: "Browser-based lyric video timing for covers. Upload and sync lyrics to your video.",
    url: "/en/lyrics-video-maker",
    type: "article",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lyrics video maker (free)",
    description: "Free browser tool to time lyrics with your cover video.",
  },
};

export default function EnLyricsVideoMakerPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", lineHeight: 1.8 }}>
      <nav style={{ marginBottom: 20, fontSize: 14 }}>
        <Link href="/en" style={{ color: "#2563eb" }}>
          English home
        </Link>
        {" · "}
        <Link href="/lyrics-video-maker" style={{ color: "#2563eb" }}>
          日本語
        </Link>
        {" · "}
        <Link href="/" style={{ color: "#2563eb" }}>
          Japanese site
        </Link>
      </nav>

      <h1 style={{ fontSize: 26, color: "#0f172a", marginBottom: 16 }}>Lyrics video maker (free)</h1>
      <p style={{ color: "#475569", marginBottom: 20 }}>
        A <strong>lyrics video</strong> (or “lyric video”) shows your song text in sync with the music. This site lets
        you upload a performance video and adjust line-by-line timing so the text matches what viewers hear—useful for{" "}
        <strong>karaoke covers</strong> and <strong>utattemita</strong>-style uploads.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 19, color: "#0f172a", marginBottom: 10 }}>What you can do here</h2>
        <ul style={{ color: "#334155", paddingLeft: 22 }}>
          <li style={{ marginBottom: 8 }}>Upload an MP4 (or supported video) from the upload page</li>
          <li style={{ marginBottom: 8 }}>Import lyrics and place them on a timeline by segment</li>
          <li>Preview synced captions over your video while you edit</li>
        </ul>
      </section>

      <Link
        href="/upload"
        style={{
          display: "inline-block",
          padding: "12px 20px",
          background: "#0f172a",
          color: "#fff",
          borderRadius: 8,
          textDecoration: "none",
          fontWeight: 600,
        }}
      >
        Start with video upload
      </Link>
    </main>
  );
}
