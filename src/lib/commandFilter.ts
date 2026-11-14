import { defaultFilter } from "cmdk";

/**
 * cmdk filter that matches each typed word on its own, in any order.
 * cmdk's default scores the whole query as one in-order subsequence, so "dumb incl" misses
 * "Incline Dumbbell Press". Here every word must match (score > 0); scores multiply, so items
 * matching all words strongly still rank first.
 *
 * When an item has keywords, only the keywords are scored: item values here are ids (often UUIDs),
 * and fuzzy subsequence matching would let words like "dead" or "face" hit their hex digits.
 */
export function wordFilter(value: string, search: string, keywords?: string[]): number {
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const v = keywords?.length ? "" : value;
  let score = 1;
  for (const w of words) {
    const s = defaultFilter(v, w, keywords);
    if (!s) return 0;
    score *= s;
  }
  return score;
}
