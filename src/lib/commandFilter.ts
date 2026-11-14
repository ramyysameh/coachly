import { defaultFilter } from "cmdk";

/**
 * cmdk filter that matches each typed word on its own, in any order.
 * cmdk's default scores the whole query as one in-order subsequence, so "dumb incl" misses
 * "Incline Dumbbell Press". Here every word must match (score > 0); scores multiply, so items
 * matching all words strongly still rank first.
 */
export function wordFilter(value: string, search: string, keywords?: string[]): number {
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let score = 1;
  for (const w of words) {
    const s = defaultFilter(value, w, keywords);
    if (!s) return 0;
    score *= s;
  }
  return score;
}
