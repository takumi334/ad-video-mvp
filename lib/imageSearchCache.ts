import type { SearchImageResult } from "@/app/api/search-images/route";

/** 1ページ分のキャッシュ（Pixabay page は 1 始まり） */
export type CachedImageSearchPage = {
  images: SearchImageResult[];
  hasMore: boolean;
};

/**
 * 画像検索 API 応答の query キー単位キャッシュ（同一 query・同一 page は再取得しない）
 */
export class ImageSearchQueryCache {
  private root = new Map<string, Map<number, CachedImageSearchPage>>();

  getPage(queryKey: string, page: number): CachedImageSearchPage | undefined {
    return this.root.get(queryKey)?.get(page);
  }

  setPage(queryKey: string, page: number, data: CachedImageSearchPage): void {
    let pages = this.root.get(queryKey);
    if (!pages) {
      pages = new Map();
      this.root.set(queryKey, pages);
    }
    pages.set(page, data);
  }
}
