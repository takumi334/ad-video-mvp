const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

/** トップから「画像」扱い: PNG / JPG / WebP */
export function isHomeImageFile(file: File): boolean {
  if (file.type && IMAGE_MIMES.has(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

/** トップから「動画」扱い: MP4 / MOV / WEBM（MIME または拡張子） */
export function isHomeVideoFile(file: File): boolean {
  if (file.type && VIDEO_MIMES.has(file.type)) return true;
  return /\.(mp4|mov|webm)$/i.test(file.name);
}
