/**
 * 歌詞フレーズから助詞を除外してキーワードを抽出し、曲テーマを推定する。
 * ブラウザ・Node 両方で利用可能（APIキー不要）。
 */

/** ユーザー指定: 画像検索の助詞・口語（セグメント単位で除外） */
export const LYRICS_IMAGE_PARTICLE_STOPWORDS = new Set([
  "の",
  "に",
  "を",
  "は",
  "が",
  "で",
  "と",
  "も",
  "へ",
  "や",
  "か",
  "な",
  "だ",
  "です",
  "ます",
  "この",
  "その",
  "あの",
  "ある",
  "いる",
]);

/** 意味が薄い単独形（助詞除去後も検索主役から外す） */
const LYRICS_IMAGE_WEAK_STANDALONE = new Set(["並み", "くらい", "ほど", "など", "ばかり", "だけ"]);

// 助詞・接続助詞・指示詞など（除外して語を切り出す）
const PARTICLES =
  /[のをにがはとでへからまでよりかもやねのでってではではずにばかりだけほどなどこのそのあのどのそのあれこれ]|^[\s　]+|[\s　]+$/g;

// 記号・読点（分割用）
const PUNCT_SPLIT = /[、。！？\!\?・\s　]+/g;

/** 1フレーズから助詞を除いたキーワード候補を抽出（重複なし） */
function extractKeywordsFromPhrase(phrase: string): string[] {
  const normalized = phrase.replace(PARTICLES, " ").replace(PUNCT_SPLIT, " ");
  const tokens = normalized
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return [...new Set(tokens)];
}

/** 全フレーズからキーワードを集約（出現回数付き） */
export function aggregateKeywords(phrases: string[]): { word: string; count: number }[] {
  const count = new Map<string, number>();
  for (const phrase of phrases) {
    for (const word of extractKeywordsFromPhrase(phrase)) {
      count.set(word, (count.get(word) ?? 0) + 1);
    }
  }
  return [...count.entries()]
    .map(([word, n]) => ({ word, count: n }))
    .sort((a, b) => b.count - a.count);
}

/** 日本語キーワード → 検索用英語テーマの簡易マッピング（物・場所・動き・感情を厚めに） */
const JA_TO_EN: Record<string, string> = {
  始まり: "beginning",
  始まった: "start",
  今日: "today",
  慌ただしい: "chaos",
  衝撃: "impact",
  情熱: "passion",
  青春: "youth",
  オフィス: "office",
  空気: "air",
  酸素: "oxygen",
  ストレス: "stress",
  上司: "boss",
  怪物: "monster",
  仕事: "work",
  会社: "office",
  恋: "love",
  夢: "dream",
  夜: "night",
  朝: "morning",
  街: "city",
  空: "sky",
  海: "ocean",
  山: "mountain",
  心: "heart",
  涙: "tears",
  笑顔: "smile",
  光: "light",
  闇: "dark",
  風: "wind",
  雨: "rain",
  雪: "snow",
  花: "flower",
  夏: "summer",
  冬: "winter",
  春: "spring",
  秋: "autumn",
  奪う: "take",
  かっさらう: "take",
  かっさらっていく: "take",
  さらっていく: "sweep",
  さらって: "sweep",
  さらう: "sweep",
  レッドカード: "red card",
  出される: "referee",
  出された: "referee",
  サッカー: "soccer",
  ペン: "pen",
  ぺん: "pen",
  書類: "papers",
  舞い: "flying",
  舞う: "dance",
  宙: "floating",
  宙返り: "somersault",
  深海魚: "deep sea",
  深海魚並み: "deep sea",
  溜息: "sigh",
  ため息: "sigh",
  長い: "long",
  並み: "like",
  書く: "writing",
  飛ぶ: "flying",
  落ちる: "falling",
  走る: "running",
  泣く: "crying",
  笑う: "laughing",
  怒り: "anger",
  悲しみ: "sadness",
  喜び: "joy",
  不安: "anxiety",
  希望: "hope",
  絶望: "despair",
  部屋: "room",
  窓: "window",
  机: "desk",
  椅子: "chair",
  電車: "train",
  駅: "station",
  道路: "road",
  森: "forest",
  川: "river",
  星: "stars",
  月: "moon",
  太陽: "sun",
  炎: "fire",
  煙: "smoke",
  嵐: "storm",
  波: "waves",
  砂: "sand",
  鳥: "bird",
  猫: "cat",
  犬: "dog",
  魚: "fish",
  花火: "fireworks",
  祭り: "festival",
  戦い: "battle",
  勝利: "victory",
  敗北: "defeat",
  時計: "clock",
  紙: "paper",
  文字: "letters",
  音: "sound",
  静けさ: "silence",
  騒ぎ: "noise",
  夢中: "ecstasy",
  ドラマチック: "dramatic",
};

/** 画像検索の英語主役から除外（一人称・呼びかけなど） */
const SKIP_JA_TOKEN_FOR_IMAGE_PRIME = new Set([
  "俺",
  "私",
  "僕",
  "僕ら",
  "君",
  "きみ",
  "あなた",
  "自分",
]);

type IntlSegmenterConstructor = new (
  locale: string,
  options?: { granularity?: "grapheme" | "word" | "sentence" }
) => {
  segment(input: string): Iterable<{ segment: string; isWordLike?: boolean }>;
};

function getJapaneseWordSegmenter(): InstanceType<IntlSegmenterConstructor> | null {
  try {
    const I = (Intl as unknown as { Segmenter?: IntlSegmenterConstructor }).Segmenter;
    if (typeof I !== "function") return null;
    return new I("ja-JP", { granularity: "word" });
  } catch {
    return null;
  }
}

/**
 * フレーズを助詞・指定語でノイズ除去し、意味語のトークン列にする（日本語のまま）。
 * 検索候補生成の直前で currentPhrase に適用する想定。
 */
export function tokenizeLyricsRemovingParticles(text: string): string[] {
  const raw = text.normalize("NFKC").trim();
  if (!raw) return [];

  const seg = getJapaneseWordSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const { segment, isWordLike } of seg.segment(raw)) {
      if (isWordLike === false) continue;
      const s = segment.trim();
      if (!s) continue;
      if (LYRICS_IMAGE_PARTICLE_STOPWORDS.has(s)) continue;
      if (LYRICS_IMAGE_WEAK_STANDALONE.has(s)) continue;
      if (SKIP_JA_TOKEN_FOR_IMAGE_PRIME.has(s)) continue;
      if (s.length === 1 && /^[\u3040-\u309f\u30a0-\u30ff]$/u.test(s)) continue;
      out.push(s);
    }
    if (out.length > 0) return [...new Set(out)];
  }

  const fallback = extractKeywordsFromPhrase(raw).filter(
    (w) =>
      !LYRICS_IMAGE_PARTICLE_STOPWORDS.has(w) &&
      !LYRICS_IMAGE_WEAK_STANDALONE.has(w) &&
      !SKIP_JA_TOKEN_FOR_IMAGE_PRIME.has(w)
  );
  return [...new Set(fallback)];
}

/** 形のゆらぎで JA_TO_EN を照会 */
function japaneseTokenEnglishLookup(token: string): string | undefined {
  for (const c of japaneseTokenLookupCandidates(token)) {
    const en = JA_TO_EN[c];
    if (en) return en;
  }
  return undefined;
}

function japaneseTokenLookupCandidates(token: string): string[] {
  const t = token.normalize("NFKC").trim();
  const out: string[] = [t];
  if (t.length >= 2) {
    const noTeIku = t.replace(/っていく$/u, "う").replace(/ていく$/u, "う").replace(/でいく$/u, "う");
    if (noTeIku !== t) out.push(noTeIku);
    const te = t.replace(/ている$/u, "る").replace(/てる$/u, "る").replace(/でいる$/u, "る");
    if (te !== t) out.push(te);
    const r = t.replace(/(される|された|られている|られて)$/u, "");
    if (r !== t && r.length >= 1) out.push(r);
  }
  return [...new Set(out)];
}

/**
 * 助詞除去済み日本語トークンを、辞書ベースで英語検索語に変換（複合語はスペース区切りで展開）。
 */
export function japaneseImageTokensToEnglishTerms(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokens) {
    const en = japaneseTokenEnglishLookup(tok);
    if (!en) continue;
    for (const w of en.trim().toLowerCase().split(/\s+/)) {
      if (w.length < 2) continue;
      if (seen.has(w)) continue;
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/**
 * currentPhrase → 助詞除去 → キーワード化 → 英語（画像API用・最優先クエリ断片）
 */
export function buildLyricsPrimeEnglishForImageSearch(segmentLyrics: string): string {
  const tokens = tokenizeLyricsRemovingParticles(segmentLyrics);
  return japaneseImageTokensToEnglishTerms(tokens).join(" ");
}

/** 検索の主役から外しがちな弱い語（助詞的・抽象的） */
const WEAK_JA_FOR_SEARCH = new Set([
  "こと",
  "もの",
  "よう",
  "そう",
  "ため",
  "など",
  "みたい",
  "とき",
  "ほど",
  "くらい",
  "ばかり",
  "だけ",
  "まま",
  "これ",
  "それ",
  "あれ",
  "ここ",
  "そこ",
  "なに",
  "何",
  "だれ",
  "誰",
  "いま",
  "今",
  "まえ",
  "あと",
  "なんか",
  "なんで",
  "もっと",
  "ずっと",
  "わたし",
  "私",
  "ぼく",
  "僕",
  "ぼくら",
  "きみ",
  "君",
  "あなた",
  "みんな",
  "つぎ",
  "次",
  "いちばん",
  "一番",
  "みじかい",
  "短い",
  "ながい",
  "長い",
  "たかい",
  "高い",
  "ひくい",
  "低い",
  "おなじ",
  "同じ",
  "ちがう",
  "違う",
  "すべて",
  "全部",
  "すこし",
  "少し",
  "とても",
  "すごく",
  "まだ",
  "もう",
  "また",
  "やっと",
  "すぐ",
  "いつも",
  "たぶん",
  "多分",
  "きっと",
  "ほんとう",
  "本当",
  "やっぱり",
  "やはり",
  "そして",
  "でも",
  "だから",
  "から",
  "まで",
  "より",
  "みたいな",
  "なんて",
  "って",
  "くらい",
  "ばかり",
  "など",
  "ごと",
  "ごとに",
  "うえ",
  "上",
  "した",
  "下",
  "なか",
  "中",
  "そと",
  "外",
  "あいだ",
  "間",
  "みぎ",
  "右",
  "ひだり",
  "左",
]);

function containsKanji(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s);
}

function isMostlyHiragana(s: string): boolean {
  if (s.length === 0) return false;
  const h = (s.match(/[\u3040-\u309f]/g) ?? []).length;
  return h / s.length > 0.7;
}

function scoreLyricTokenForSearch(word: string, count: number): number {
  let s = count * 2.5;
  if (WEAK_JA_FOR_SEARCH.has(word)) s -= 12;
  if (JA_TO_EN[word]) s += 10;
  if (containsKanji(word)) s += 3;
  if (word.length >= 3) s += 1.5;
  if (word.length === 2 && isMostlyHiragana(word)) s -= 4;
  return s;
}

/** ラテン語の単語を歌詞から拾う（カタカナ英語は別処理しにくいので英字列のみ） */
function extractLatinWords(text: string): string[] {
  const out: string[] = [];
  const re = /[a-zA-Z]{3,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const w = m[0].toLowerCase();
    if (w.length >= 3 && w.length <= 24) out.push(w);
  }
  return [...new Set(out)];
}

/**
 * 画像検索向けに歌詞キーワードを優先度付けし、日本語・英語の短い列を返す。
 * 物・場所・動き・感情（辞書マッチ・漢字を含む具体語）を上げ、弱い語は落とす。
 */
export function prioritizeLyricsForImageSearch(phrases: string[]): {
  jaRanked: string[];
  enRanked: string[];
} {
  const agg = aggregateKeywords(phrases);
  const latin = extractLatinWords(phrases.join("\n"));

  const rows = agg
    .map(({ word, count }) => ({
      word,
      count,
      score: scoreLyricTokenForSearch(word, count),
      en: (JA_TO_EN[word] ?? word).trim().toLowerCase().replace(/\s+/g, " "),
    }))
    .filter((r) => r.word.length >= 2 && r.score > 0 && !WEAK_JA_FOR_SEARCH.has(r.word));

  rows.sort((a, b) => b.score - a.score);

  const jaRanked: string[] = [];
  const enRanked: string[] = [];
  const seenJa = new Set<string>();
  const seenEn = new Set<string>();

  for (const r of rows) {
    if (jaRanked.length >= 14) break;
    if (seenJa.has(r.word)) continue;
    const enNorm = r.en.replace(/[^a-z0-9-]/g, "");
    const enOk = enNorm.length >= 2;
    if (enOk && seenEn.has(enNorm)) continue;
    seenJa.add(r.word);
    jaRanked.push(r.word);
    if (enOk) {
      seenEn.add(enNorm);
      enRanked.push(r.en.split(" ")[0] ?? r.en);
    }
  }

  for (const w of latin) {
    if (enRanked.length >= 14) break;
    if (seenEn.has(w)) continue;
    seenEn.add(w);
    enRanked.push(w);
  }

  return { jaRanked, enRanked };
}

/**
 * キーワードリストから曲テーマ（英語）を推定。
 * マッピングにあればその英語、なければキーワードをそのまま（検索で使える場合もある）。
 */
export function estimateTheme(keywords: { word: string; count: number }[]): string[] {
  const seen = new Set<string>();
  const theme: string[] = [];
  for (const { word } of keywords) {
    const en = JA_TO_EN[word];
    const term = (en ?? word).trim().toLowerCase();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    theme.push(term);
  }
  return theme;
}

/**
 * フレーズキュー全体を解析してキーワード集約とテーマ推定を行う。
 */
export function parseLyricsTheme(phrases: string[]): {
  keywords: { word: string; count: number }[];
  themeWords: string[];
  themeString: string;
} {
  const keywords = aggregateKeywords(phrases);
  const themeWords = estimateTheme(keywords);
  const themeString = themeWords.slice(0, 10).join(" ");
  return { keywords, themeWords, themeString };
}
