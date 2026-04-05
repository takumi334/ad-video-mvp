/** @deprecated インポートは @/lib/previewAspectLayout を推奨（互換のため再エクスポート） */

export type {
  PreviewAspectRatio,
  ExportAspectRatio,
} from "@/lib/previewAspectLayout";
export {
  PREVIEW_ASPECT_OPTIONS as EXPORT_ASPECT_OPTIONS,
  getAspectCanvasSize as exportDimensionsForAspect,
  parsePreviewAspectRatio,
} from "@/lib/previewAspectLayout";
