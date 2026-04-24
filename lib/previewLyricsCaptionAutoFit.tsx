"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent,
} from "react";

import {
  LYRICS_CAPTION_MIN_FIT_PX,
  LYRICS_CAPTION_PAD,
  lyricsCaptionInitialFontPx,
} from "@/lib/lyricsCaptionFrameMetrics";
import {
  fitLyricsTextInBox,
  type LyricsCaptionLayoutMode,
} from "@/lib/lyricsCaptionLayout";

const PAD = LYRICS_CAPTION_PAD;
const MIN_FIT_PX = LYRICS_CAPTION_MIN_FIT_PX;

function fitsInFrame(frame: Element, caption: HTMLElement, pad: number): boolean {
  const fr = frame.getBoundingClientRect();
  const cr = caption.getBoundingClientRect();
  return (
    cr.left >= fr.left + pad - 1 &&
    cr.right <= fr.right - pad + 1 &&
    cr.top >= fr.top + pad - 1 &&
    cr.bottom <= fr.bottom - pad + 1
  );
}

type Props = {
  measureFrameRef: RefObject<HTMLElement | null>;
  /** 区間設定の基準 px（これを超えない） */
  baseFontSize: number;
  color: string;
  textShadow: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  onMouseDown?: (e: MouseEvent<HTMLDivElement>) => void;
  onTouchStart?: (e: TouchEvent<HTMLDivElement>) => void;
  /** 歌詞・区間・モード等が変わったとき再測定 */
  contentKey: string | number;
  autoWrapText?: string;
  layoutMode?: LyricsCaptionLayoutMode;
  lineBreakAt?: number;
  maxLines?: number;
  minFontSize?: number;
};

/**
 * プレビュー枠内の歌詞: 基準 fontSize は state のまま、描画は枠と実測に合わせて縮小。
 * ① 枠幅ベースの軽い事前スケール ② getBoundingClientRect で収まるまで 0.95 倍
 */
export function PreviewLyricsCaptionAutoFit({
  measureFrameRef,
  baseFontSize,
  color,
  textShadow,
  className,
  style,
  children,
  onMouseDown,
  onTouchStart,
  contentKey,
  autoWrapText,
  layoutMode = 1,
  lineBreakAt = 0,
  maxLines = 4,
  minFontSize = MIN_FIT_PX,
}: Props) {
  const captionRef = useRef<HTMLDivElement>(null);
  const [effectivePx, setEffectivePx] = useState(() => Math.round(baseFontSize));
  const [wrappedLines, setWrappedLines] = useState<string[] | null>(null);

  const measure = useCallback(() => {
    const frame = measureFrameRef.current;
    const el = captionRef.current;
    if (!frame || !el) return;

    const cw = frame.clientWidth;
    const ch = frame.clientHeight;
    if (cw < 8 || ch < 8) return;

    if (typeof autoWrapText === "string") {
      const fitted = fitLyricsTextInBox({
        text: autoWrapText,
        layoutMode,
        lineBreakAt,
        boxWidth: Math.max(8, cw - PAD * 2),
        boxHeight: Math.max(8, ch - PAD * 2),
        baseFontPx: baseFontSize,
        minFontPx: minFontSize,
        maxLines,
      });
      setWrappedLines(fitted.lines);
      setEffectivePx((prev) => (prev === fitted.fontSize ? prev : fitted.fontSize));
      return;
    }

    const narrow =
      typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches;
    let size = lyricsCaptionInitialFontPx(baseFontSize, cw, ch, narrow);

    const applyPx = (px: number) => {
      el.style.fontSize = `${px}px`;
      void el.offsetHeight;
    };

    applyPx(size);
    if (fitsInFrame(frame, el, PAD)) {
      setEffectivePx((prev) => (prev === size ? prev : size));
      return;
    }

    let s = size;
    while (s > MIN_FIT_PX && !fitsInFrame(frame, el, PAD)) {
      s = Math.max(MIN_FIT_PX, Math.floor(s * 0.95));
      applyPx(s);
    }
    setEffectivePx((prev) => (prev === s ? prev : s));
  }, [
    autoWrapText,
    layoutMode,
    lineBreakAt,
    maxLines,
    minFontSize,
    baseFontSize,
    contentKey,
    measureFrameRef,
  ]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const frame = measureFrameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(frame);
    return () => ro.disconnect();
  }, [measure, measureFrameRef]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  return (
    <div
      ref={captionRef}
      className={className}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      style={{
        ...style,
        fontSize: effectivePx,
        color,
        textShadow,
      }}
    >
      {wrappedLines == null ? (
        children
      ) : layoutMode === "vLeft" || layoutMode === "vRight" ? (
        wrappedLines[0] ?? ""
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
          {wrappedLines.map((line, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                background: "rgba(0,0,0,0.38)",
                borderRadius: 6,
                padding: "1px 8px",
              }}
            >
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
