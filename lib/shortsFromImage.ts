export type NormalizedRegion = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RegionDetectionMode = "grid" | "ai-focus";

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function buildGridRegions(count: number): NormalizedRegion[] {
  const safeCount = Math.max(3, Math.min(6, Math.round(count)));
  const columns = safeCount <= 4 ? 2 : 3;
  const rows = Math.ceil(safeCount / columns);
  const tileWidth = 1 / columns;
  const tileHeight = 1 / rows;

  const regions: NormalizedRegion[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    regions.push({
      id: `region-${index + 1}`,
      x: clamp01(col * tileWidth),
      y: clamp01(row * tileHeight),
      width: clamp01(tileWidth),
      height: clamp01(tileHeight),
    });
  }
  return regions;
}

/**
 * 将来 AI 注目領域検出に差し替える入口。
 * 現時点では grid ベースで返す。
 */
export function detectFocusRegions(
  imageSize: { width: number; height: number },
  options: { count: number; mode?: RegionDetectionMode }
): NormalizedRegion[] {
  const { count, mode = "grid" } = options;
  if (mode === "ai-focus") {
    // TODO: AI モデル統合時にここで注目領域を返す。
    return buildGridRegions(count);
  }
  if (imageSize.width <= 0 || imageSize.height <= 0) return buildGridRegions(count);
  return buildGridRegions(count);
}
