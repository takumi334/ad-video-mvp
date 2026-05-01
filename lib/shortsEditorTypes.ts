export type OutputAspect = "1:1" | "16:9" | "9:16";
import type { UiLocale } from "@/lib/i18n/uiLocale";
export type ShortsMediaType = "image" | "video" | "gif";

export type ShortFrameBannerSettings = {
  bannerPosition: "top" | "bottom";
  bannerHeightPercent: number;
  bannerFit: "contain" | "cover";
  bannerCropX: number;
  bannerCropY: number;
  bannerCropLeft?: number;
  bannerCropRight?: number;
  bannerCropTop?: number;
  bannerCropBottom?: number;
  bannerScale: number;
  bannerOpacity: number;
};

export type ShortFrame = {
  id: string;
  order: number;
  label: string;
  aspect: OutputAspect;
  centerX: number;
  centerY: number;
  cropW: number;
  cropH: number;
  frameCropX?: number;
  frameCropY?: number;
  frameScale?: number;
  frameFit?: "contain" | "cover";
  frameCropLeft?: number;
  frameCropRight?: number;
  frameCropTop?: number;
  frameCropBottom?: number;
  videoStart?: number;
  videoEnd?: number;
  videoMuted?: boolean;
  videoLoop?: boolean;
  playbackRate?: number;
  text: string;
  narrationByLang?: Partial<Record<UiLocale, string>>;
  bannerEnabled?: boolean;
  bannerSettings?: ShortFrameBannerSettings;
  startTime: number;
  endTime: number;
  zoomScale: number;
};
