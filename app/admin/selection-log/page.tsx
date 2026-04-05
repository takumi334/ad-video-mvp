"use client";

import { Suspense, useMemo, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";

const ADMIN_KEY = "gegenpress-admin";
const AUTOSAVE_PREFIX = "videoSyncAutosave:";

type SelectionLogRow = {
  videoId: string;
  segmentIndex: number;
  lyricText: string;
  startSec: number | null;
  endSec: number | null;
  searchKeywords: string;
  pixabayImageId: number | null;
  imageUrl: string;
  apiRank: number | null;
  boostScore: number | null;
  boostReason: string | null;
  selectedAt: string;
};

function safeNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseVideoIdFromKey(key: string): string {
  return key.startsWith(AUTOSAVE_PREFIX) ? key.slice(AUTOSAVE_PREFIX.length) : key;
}

function collectRowsFromAutosave(key: string, raw: string): SelectionLogRow[] {
  const out: SelectionLogRow[] = [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!data || typeof data !== "object") return out;
  const obj = data as Record<string, unknown>;
  const videoId = parseVideoIdFromKey(key);

  // Future/legacy shape requested by ops:
  // { segments: [{ startSec, endSec, lyricText, imageSelection: {...} }] }
  if (Array.isArray(obj.segments)) {
    obj.segments.forEach((segRaw, idx) => {
      if (!segRaw || typeof segRaw !== "object") return;
      const seg = segRaw as Record<string, unknown>;
      const imageSelection =
        seg.imageSelection && typeof seg.imageSelection === "object"
          ? (seg.imageSelection as Record<string, unknown>)
          : null;
      if (!imageSelection) return;
      const selectedAt = safeStr(imageSelection.selectedAt).trim();
      if (!selectedAt) return;
      const imageUrl = safeStr(imageSelection.imageUrl).trim();
      if (!imageUrl) return;
      out.push({
        videoId,
        segmentIndex: idx,
        lyricText: safeStr(seg.lyricText || imageSelection.lyricText),
        startSec: safeNum(seg.startSec),
        endSec: safeNum(seg.endSec),
        searchKeywords: safeStr(imageSelection.searchKeywords),
        pixabayImageId: safeNum(imageSelection.pixabayImageId),
        imageUrl,
        apiRank: safeNum(imageSelection.apiRank),
        boostScore: safeNum(imageSelection.boostScore),
        boostReason: safeStr(imageSelection.boostReason) || null,
        selectedAt,
      });
    });
  }

  // Current project-state shape:
  // { panelState: { timelineSegments:[], segmentTexts:[], segmentImageSelections:[] } }
  const panelState =
    obj.panelState && typeof obj.panelState === "object"
      ? (obj.panelState as Record<string, unknown>)
      : null;
  if (panelState) {
    const timelineSegments = Array.isArray(panelState.timelineSegments)
      ? panelState.timelineSegments
      : [];
    const segmentTexts = Array.isArray(panelState.segmentTexts) ? panelState.segmentTexts : [];
    const segmentImageSelections = Array.isArray(panelState.segmentImageSelections)
      ? panelState.segmentImageSelections
      : [];
    segmentImageSelections.forEach((metaRaw, idx) => {
      if (!metaRaw || typeof metaRaw !== "object") return;
      const meta = metaRaw as Record<string, unknown>;
      const selectedAt = safeStr(meta.selectedAt).trim();
      const imageUrl = safeStr(meta.imageUrl).trim();
      if (!selectedAt || !imageUrl) return;
      const segRaw = timelineSegments[idx];
      const seg =
        segRaw && typeof segRaw === "object" ? (segRaw as Record<string, unknown>) : null;
      out.push({
        videoId,
        segmentIndex: idx,
        lyricText: safeStr(meta.lyricText) || safeStr(segmentTexts[idx]),
        startSec: safeNum(seg?.startSec),
        endSec: safeNum(seg?.endSec),
        searchKeywords: safeStr(meta.searchKeywords),
        pixabayImageId: safeNum(meta.pixabayImageId),
        imageUrl,
        apiRank: safeNum(meta.apiRank),
        boostScore: safeNum(meta.boostScore),
        boostReason: safeStr(meta.boostReason) || null,
        selectedAt,
      });
    });
  }

  return out;
}

function SelectionLogInner() {
  const params = useSearchParams();
  const key = params.get("key");
  const authorized = key === ADMIN_KEY;

  const rows = useMemo(() => {
    if (!authorized || typeof window === "undefined") return [];
    const collected: SelectionLogRow[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const storageKey = localStorage.key(i);
      if (!storageKey || !storageKey.startsWith(AUTOSAVE_PREFIX)) continue;
      const raw = localStorage.getItem(storageKey);
      if (!raw) continue;
      collected.push(...collectRowsFromAutosave(storageKey, raw));
    }
    collected.sort((a, b) => {
      const ta = Date.parse(a.selectedAt);
      const tb = Date.parse(b.selectedAt);
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
    return collected;
  }, [authorized]);

  if (!authorized) {
    return <div style={{ padding: 24, fontFamily: "Arial, sans-serif" }}>Unauthorized</div>;
  }

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ margin: "0 0 12px 0", fontSize: 20 }}>Selection Log (Admin)</h1>
      <div style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
        件数: {rows.length}
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #ddd", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f6f6f6" }}>
              <th style={thStyle}>動画ID</th>
              <th style={thStyle}>区間</th>
              <th style={thStyle}>lyricText</th>
              <th style={thStyle}>startSec</th>
              <th style={thStyle}>endSec</th>
              <th style={thStyle}>searchKeywords</th>
              <th style={thStyle}>pixabayImageId</th>
              <th style={thStyle}>画像</th>
              <th style={thStyle}>apiRank</th>
              <th style={thStyle}>boostScore</th>
              <th style={thStyle}>boostReason</th>
              <th style={thStyle}>selectedAt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.videoId}-${r.segmentIndex}-${r.selectedAt}-${i}`}>
                <td style={tdStyle}>{r.videoId}</td>
                <td style={tdStyle}>#{r.segmentIndex + 1}</td>
                <td style={tdStyle}>{r.lyricText}</td>
                <td style={tdStyle}>{r.startSec ?? "—"}</td>
                <td style={tdStyle}>{r.endSec ?? "—"}</td>
                <td style={tdStyle}>{r.searchKeywords}</td>
                <td style={tdStyle}>{r.pixabayImageId ?? "—"}</td>
                <td style={tdStyle}>
                  {r.imageUrl ? (
                    <img
                      src={r.imageUrl}
                      alt=""
                      width={120}
                      style={{ borderRadius: 4, border: "1px solid #ddd" }}
                    />
                  ) : (
                    "—"
                  )}
                </td>
                <td style={tdStyle}>{r.apiRank ?? "—"}</td>
                <td style={tdStyle}>{r.boostScore ?? "—"}</td>
                <td style={tdStyle}>{r.boostReason ?? "—"}</td>
                <td style={tdStyle}>{r.selectedAt}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td style={{ ...tdStyle, textAlign: "center", color: "#666" }} colSpan={12}>
                  ログが見つかりません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminSelectionLogPage() {
  return (
    <Suspense fallback={null}>
      <SelectionLogInner />
    </Suspense>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: "8px 10px",
  whiteSpace: "nowrap",
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
  padding: "8px 10px",
  maxWidth: 260,
  wordBreak: "break-word",
};

