export type OutputAspect = "1:1" | "16:9" | "9:16";

export type ShortFrame = {
  id: string;
  order: number;
  label: string;
  aspect: OutputAspect;
  centerX: number;
  centerY: number;
  cropW: number;
  cropH: number;
  text: string;
  duration: number;
  zoomScale: number;
};
