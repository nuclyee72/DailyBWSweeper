/**
 * random.js — 시드로 같은 수열을 내는 난수 (데일리: 같은 날짜면 누구에게나 같은 판).
 */

/** 문자열 → 32비트 시드 (FNV-1a) */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — [0, 1) 균등 난수 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFromSeed = (seedStr) => mulberry32(hashString(seedStr));
