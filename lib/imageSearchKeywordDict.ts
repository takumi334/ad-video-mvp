/**
 * 歌詞でよく使う日本語 → 画像検索用英語（Pixabay 等）。
 * UI は日本語のまま。検索 API 実行時にのみ展開する。
 */

/** キーは NFKC 正規化後に照合。値はスペース区切りで連結してクエリに混ぜる */
export const keywordDict: Record<string, readonly string[]> = {
  青春: ["youth"],
  情熱: ["passion", "fire"],
  今日: ["today"],
  夜: ["night"],
  街: ["city"],
  涙: ["tears"],
  笑顔: ["smile"],
  空: ["sky"],
  走る: ["running"],
  君: ["you"],
  恋: ["love"],
  愛: ["love"],
  夢: ["dream"],
  朝: ["morning"],
  海: ["ocean"],
  心: ["heart"],
  光: ["light"],
  風: ["wind"],
  雨: ["rain"],
  雪: ["snow"],
  花: ["flower"],
  星: ["stars"],
  月: ["moon"],
  太陽: ["sun"],
  夏: ["summer"],
  冬: ["winter"],
  春: ["spring"],
  秋: ["autumn"],
  悲しみ: ["sadness"],
  喜び: ["joy"],
  希望: ["hope"],
  未来: ["future"],
  過去: ["past"],
  記憶: ["memory"],
  別れ: ["farewell"],
  出会い: ["meeting"],
  誓い: ["promise"],
  歌: ["song"],
  声: ["voice"],
  音: ["sound"],
  踊る: ["dance"],
  泣く: ["crying"],
  笑う: ["laughing"],
  飛ぶ: ["flying"],
  旅: ["journey"],
  帰る: ["return"],
  一人: ["alone"],
  二人: ["couple"],
  永遠: ["forever"],
  瞬間: ["moment"],
  時間: ["time"],
  世界: ["world"],
  宇宙: ["space"],
  部屋: ["room"],
  窓: ["window"],
  電車: ["train"],
  駅: ["station"],
  道路: ["road"],
  森: ["forest"],
  川: ["river"],
  山: ["mountain"],
  俺: ["man"],
  私: ["woman"],
  僕: ["boy"],
  僕ら: ["friends"],
  きみ: ["you"],
  あなた: ["you"],
  みんな: ["crowd"],
  始まり: ["beginning"],
  終わり: ["ending"],
  炎: ["fire"],
  煙: ["smoke"],
  嵐: ["storm"],
  波: ["waves"],
  砂: ["sand"],
  鳥: ["bird"],
  猫: ["cat"],
  犬: ["dog"],
  魚: ["fish"],
  花火: ["fireworks"],
  祭り: ["festival"],
  戦い: ["battle"],
  勝利: ["victory"],
  敗北: ["defeat"],
  レッドカード: ["red", "card", "soccer"],
  サッカー: ["soccer", "football"],
  野球: ["baseball"],
  バスケ: ["basketball"],
  カツン: ["impact"],
  バタン: ["door", "slam"],
  ドスン: ["thud", "impact"],
  ペン: ["pen"],
  書く: ["writing"],
  書類: ["papers"],
  オフィス: ["office"],
  仕事: ["work"],
  会社: ["office"],
  上司: ["boss"],
  ストレス: ["stress"],
  溜息: ["sigh"],
  ため息: ["sigh"],
  爽やか: ["refreshing", "bright"],
  切ない: ["bittersweet", "tender"],
  都会: ["urban", "city"],
  夕暮れ: ["sunset", "twilight"],
  失恋: ["heartbreak", "lonely"],
  ドラマチック: ["dramatic"],
};

/** NFKC キー → 英語配列（モジュール読み込み時に1回だけ構築） */
const LOOKUP = new Map<string, readonly string[]>();
for (const [ja, en] of Object.entries(keywordDict)) {
  LOOKUP.set(ja.normalize("NFKC"), en);
}

/**
 * クエリを空白区切りトークンにし、辞書ヒットのみ英語に置き換え（複数英語はスペース連結）。
 * 辞書にないトークンはそのまま。日本語・英語混在可。
 */
export function expandLyricsKeywordsForImageSearch(query: string): string {
  const raw = query.normalize("NFKC").trim();
  if (!raw) return "";

  const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return "";

  const out: string[] = [];
  for (const token of tokens) {
    const key = token.normalize("NFKC");
    const en = LOOKUP.get(key);
    if (en && en.length > 0) {
      out.push(...en);
    } else {
      out.push(token);
    }
  }

  return out.join(" ").replace(/\s+/g, " ").trim();
}
