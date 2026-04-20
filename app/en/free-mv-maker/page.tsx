import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Free MV maker",
  description:
    "Plan a simple MV in the browser for free: sync lyrics, try image ideas from stock search, and export-oriented preview. Upload your cover video to begin.",
  alternates: {
    canonical: "/en/free-mv-maker",
    languages: {
      ja: "/free-mv-maker",
      en: "/en/free-mv-maker",
    },
  },
  openGraph: {
    title: "Free MV maker | Free Video Editor",
    description: "Free browser workflow for MV-style prep: lyrics timing plus image search for your cover.",
    url: "/en/free-mv-maker",
    type: "article",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free MV maker",
    description: "Free browser MV prep: lyrics sync and visuals for cover videos.",
  },
};

export default function EnFreeMvMakerPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", lineHeight: 1.8 }}>
      <nav style={{ marginBottom: 20, fontSize: 14 }}>
        <Link href="/en" style={{ color: "#2563eb" }}>
          English home
        </Link>
        {" · "}
        <Link href="/free-mv-maker" style={{ color: "#2563eb" }}>
          日本語
        </Link>
        {" · "}
        <Link href="/" style={{ color: "#2563eb" }}>
          Japanese site
        </Link>
      </nav>

      <h1 style={{ fontSize: 26, color: "#0f172a", marginBottom: 16 }}>Free MV maker (browser)</h1>
      <p style={{ color: "#475569", marginBottom: 20 }}>
        Building a full professional MV usually needs a desktop suite—but you can start <strong>MV-style preparation</strong>{" "}
        for <strong>free</strong> here: align lyrics with your cover, browse stock images, and iterate in the browser
        before heavier editing elsewhere.
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 19, color: "#0f172a", marginBottom: 10 }}>Suggested flow</h2>
        <ol style={{ color: "#334155", paddingLeft: 22 }}>
          <li style={{ marginBottom: 8 }}>Upload your video</li>
          <li style={{ marginBottom: 8 }}>Sync lyrics to segments</li>
          <li>Use image search when you want background or slide-style visuals</li>
        </ol>
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
        Upload a video
      </Link>
    </main>
  );
}
