/**
 * 曲調・表示テンポに応じた「歌詞表示の自動展開」用プリセット。
 * 自動 = 曲調に合わせて、見やすくテンポよく歌詞を出す（目が疲れない範囲で曲の勢いを壊さない）。
 */

/** 曲調プリセット */
export type SongStyle = "shittori" | "standard" | "tempo" | "rap";

/** 表示テンポの好み */
export type DisplayTempo = "readability" | "balance" | "rhythm";

/** フレーズ結合・分割のルール（1画面あたりの文字量・切替頻度の目安） */
export type PresetParams = {
  /** この文字数以下の部分は次の句と結合して長くする（目安: 少ない＝切替多め） */
  mergeShortBelow: number;
  /** この文字数超なら分割する（目安: 低い＝細かく切替） */
  splitLongAbove: number;
  /** 5秒あたりの目安切替数（1=ゆったり, 2=テンポ速めで2画面可） */
  maxSwitchesPer5Sec: number;
  /** 自動生成: 1画面あたりの目安表示秒数（約○秒で画面切替） */
  secondsPerScreen: number;
  /** 説明（UI表示用） */
  description: string;
};

const STYLE_BASE: Record<SongStyle, Omit<PresetParams, "description">> = {
  /** しっとり: 長め表示、切替少なめ */
  shittori: {
    mergeShortBelow: 10,
    splitLongAbove: 36,
    maxSwitchesPer5Sec: 1,
    secondsPerScreen: 7,
  },
  /** 標準: 3〜5秒、2行中心 */
  standard: {
    mergeShortBelow: 5,
    splitLongAbove: 28,
    maxSwitchesPer5Sec: 1,
    secondsPerScreen: 4,
  },
  /** テンポ速め: 5秒前後で画面切替を基準 */
  tempo: {
    mergeShortBelow: 3,
    splitLongAbove: 22,
    maxSwitchesPer5Sec: 2,
    secondsPerScreen: 5,
  },
  /** ラップ/早口寄り: フレーズ優先で細かく切替 */
  rap: {
    mergeShortBelow: 0,
    splitLongAbove: 18,
    maxSwitchesPer5Sec: 2,
    secondsPerScreen: 3,
  },
};

/** 表示テンポによるオフセット（見やすさ優先＝長め、ノリ優先＝短め） */
const TEMPO_OFFSET: Record<DisplayTempo, { merge: number; split: number }> = {
  readability: { merge: 2, split: 4 },
  balance: { merge: 0, split: 0 },
  rhythm: { merge: -2, split: -4 },
};

const STYLE_LABELS: Record<SongStyle, string> = {
  shittori: "しっとり",
  standard: "標準",
  tempo: "テンポ速め",
  rap: "ラップ/早口寄り",
};

const TEMPO_LABELS: Record<DisplayTempo, string> = {
  readability: "見やすさ優先",
  balance: "バランス",
  rhythm: "ノリ優先",
};

/**
 * 曲調と表示テンポからプリセットパラメータを取得する。
 * 後でMLやヒューリスティックに差し替えしやすいように関数分離。
 */
export function getPresetParams(style: SongStyle, tempo: DisplayTempo): PresetParams {
  const base = STYLE_BASE[style];
  const offset = TEMPO_OFFSET[tempo];
  const mergeShortBelow = Math.max(0, base.mergeShortBelow + offset.merge);
  const splitLongAbove = Math.max(mergeShortBelow + 5, base.splitLongAbove + offset.split);
  const desc = [
    STYLE_LABELS[style],
    TEMPO_LABELS[tempo],
    `（結合≦${mergeShortBelow}文字・分割>${splitLongAbove}文字・約${base.secondsPerScreen}秒/画面）`,
  ].join(" ");
  return {
    mergeShortBelow,
    splitLongAbove,
    maxSwitchesPer5Sec: base.maxSwitchesPer5Sec,
    secondsPerScreen: base.secondsPerScreen,
    description: desc,
  };
}

export function getSongStyleLabel(style: SongStyle): string {
  return STYLE_LABELS[style];
}

export function getDisplayTempoLabel(tempo: DisplayTempo): string {
  return TEMPO_LABELS[tempo];
}

export const SONG_STYLES: SongStyle[] = ["shittori", "standard", "tempo", "rap"];
export const DISPLAY_TEMPOS: DisplayTempo[] = ["readability", "balance", "rhythm"];
