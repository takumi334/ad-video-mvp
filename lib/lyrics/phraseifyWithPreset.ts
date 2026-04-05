/**
 * 曲調・表示テンポプリセットに基づく歌詞フレーズ化。
 * 句読点で分割したうえで、mergeShortBelow / splitLongAbove に従って結合・分割する。
 */
import type { PresetParams } from "./displayPresets";

const PUNCTUATIONS = "、。！？.!?";
const BRACKET_PAIRS: [string, string][] = [["(", ")"], ["[", "]"], ["「", "」"]];

function splitByPunctuation(s: string): string[] {
  const result: string[] = [];
  let buf = "";
  const bracketStack: string[] = [];
  for (const c of s) {
    if (bracketStack.length > 0) {
      buf += c;
      const pair = BRACKET_PAIRS.find(([o]) => o === bracketStack[bracketStack.length - 1]);
      if (pair && c === pair[1]) bracketStack.pop();
      continue;
    }
    const openPair = BRACKET_PAIRS.find(([o]) => c === o);
    if (openPair) {
      bracketStack.push(openPair[0]);
      buf += c;
      continue;
    }
    if (PUNCTUATIONS.includes(c)) {
      buf += c;
      if (buf.trim()) result.push(buf);
      buf = "";
    } else {
      buf += c;
    }
  }
  if (buf.trim()) result.push(buf);
  return result;
}

function splitLongPhrase(s: string): [string, string] {
  const spaceIdx = s.indexOf(" ");
  const commaIdx = s.indexOf("、");
  const periodIdx = s.indexOf("。");
  let splitIdx = -1;
  if (spaceIdx >= 0) splitIdx = spaceIdx;
  else if (commaIdx >= 0) splitIdx = commaIdx;
  else if (periodIdx >= 0) splitIdx = periodIdx;
  if (splitIdx < 0) splitIdx = Math.floor(s.length / 2);
  const a = s.slice(0, splitIdx + 1).trim();
  const b = s.slice(splitIdx + 1).trim();
  return [a || s.slice(0, 1), b || ""];
}

/**
 * 歌詞全文を、プリセットに従ってフレーズに分割する。
 * - まず句読点で分割
 * - mergeShortBelow 以下なら次と結合（長め表示）
 * - splitLongAbove 超なら分割（細かく切替）
 */
export function phraseifyWithPreset(text: string, params: PresetParams): string[] {
  const { mergeShortBelow, splitLongAbove } = params;
  const raw = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const parts: string[] = [];
  for (const line of raw) {
    parts.push(...splitByPunctuation(line));
  }

  const merged: string[] = [];
  let i = 0;
  while (i < parts.length) {
    let s = parts[i] ?? "";
    while (mergeShortBelow > 0 && s.length <= mergeShortBelow && i + 1 < parts.length) {
      i++;
      s += parts[i] ?? "";
    }
    while (s.length > splitLongAbove) {
      const [a, b] = splitLongPhrase(s);
      merged.push(a);
      s = b;
    }
    if (s) merged.push(s);
    i++;
  }
  return merged;
}
