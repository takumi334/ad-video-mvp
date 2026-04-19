import type { NextRequest } from "next/server";

export type VideoAuthFields = {
  ownerSecret: string | null;
  isPublic: boolean;
};

export function getBearerToken(req: NextRequest): string | null {
  const a = req.headers.get("authorization");
  if (!a?.toLowerCase().startsWith("bearer ")) return null;
  const t = a.slice(7).trim();
  return t.length > 0 ? t : null;
}

/** 動画メタの取得可否（公開 or 所有者） */
export function canReadVideo(video: VideoAuthFields, bearer: string | null): boolean {
  if (video.isPublic) return true;
  if (!video.ownerSecret) return true;
  return bearer != null && bearer === video.ownerSecret;
}

/** 変更系 API 用。ownerSecret 未設定の旧動画は変更不可 */
export function assertCanMutateVideo(
  req: NextRequest,
  video: VideoAuthFields
): { ok: true } | { ok: false; status: number; message: string } {
  if (!video.ownerSecret) {
    return {
      ok: false,
      status: 403,
      message:
        "この動画は所有者トークンが登録されていないため変更できません。再アップロードしてください。",
    };
  }
  const bearer = getBearerToken(req);
  if (!bearer || bearer !== video.ownerSecret) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
