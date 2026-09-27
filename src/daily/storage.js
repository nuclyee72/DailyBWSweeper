/**
 * storage.js — 데일리 진행 상태 + 통계 localStorage 저장/복원.
 * (DailyWordship/src/daily/storage.js와 같은 구조 — 분포는 완성 시간 구간으로)
 * 모든 접근은 try/catch로 감싼다(프라이빗 모드/차단 브라우저에서도 게임은 되게).
 */
import { shiftDateStr } from './dateUtil.js';
import { modeOf } from '../game/puzzle.js';

const PROGRESS_KEY = (date, mode) => `bwsweeper:progress:${mode}:${date}`;
const STATS_KEY = (mode) => `bwsweeper:stats:${mode}`;

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 실패해도 진행엔 지장 없음 */ }
}

// ── 진행 상태 ──

/**
 * @typedef {object} Progress
 * @property {string} date
 * @property {'playing'|'solved'|'failed'} status
 * @property {number[]} revealed  연 칸 (판은 시드로 다시 만들 수 있으니 플레이어가 한 일만 남긴다)
 * @property {number[]} active    켠 거울
 * @property {Record<number,string>} marks  지뢰 표시
 * @property {number} elapsed     걸린 시간(ms)
 * @property {string|null} lostBy 'mine' | 'laser' | 'wrongTarget'
 * @property {number} explodedIdx
 */

/** @returns {Progress|null} */
export function loadProgress(date, mode) {
  return readJSON(PROGRESS_KEY(date, mode));
}

export function saveProgress(progress, mode) {
  writeJSON(PROGRESS_KEY(progress.date, mode), progress);
}

// ── 통계 ──

/** { results: { [date]: { status: 'solved'|'failed', seconds: number } } } */
export function loadStats(mode) {
  const s = readJSON(STATS_KEY(mode));
  return s && s.results ? s : { results: {} };
}

/** 그 날의 결과를 기록한다. 지난 퍼즐·자유 연습은 이 함수를 호출하지 않는다. */
export function recordResult(date, status, seconds, mode) {
  const s = loadStats(mode);
  s.results[date] = { status, seconds };
  writeJSON(STATS_KEY(mode), s);
  return s;
}

// ── 집계 (통계창) ──

/** 완성 시간 분포 구간 이름 — distBounds(분) [2,4,6,10,15] → '~2분' '2~4분' … '15분~' '실패' */
export function distBuckets(mode) {
  const bounds = modeOf(mode).distBounds;
  return [
    ...bounds.map((hi, i) => (i ? `${bounds[i - 1]}~${hi}분` : `~${hi}분`)),
    `${bounds[bounds.length - 1]}분~`,
    '실패',
  ];
}

export function bucketIndexFor(status, seconds, mode) {
  const bounds = modeOf(mode).distBounds;
  if (status !== 'solved') return bounds.length + 1;
  const i = bounds.findIndex((hi) => seconds <= hi * 60);
  return i < 0 ? bounds.length : i;
}

/**
 * @param {string} todayStr 현재 KST 날짜 — 연승 계산 기준
 * @returns {{ played, wins, winRate, curStreak, maxStreak, distribution: number[], results }}
 */
export function summarize(todayStr, mode) {
  const { results } = loadStats(mode);
  const dates = Object.keys(results).sort();
  const played = dates.length;
  let wins = 0;
  const distribution = new Array(distBuckets(mode).length).fill(0);
  for (const d of dates) {
    const r = results[d];
    if (r.status === 'solved') wins++;
    distribution[bucketIndexFor(r.status, r.seconds, mode)]++;
  }

  // 최고 연승: 날짜가 하루씩 이어지면서 solved인 최장 구간
  let maxStreak = 0, run = 0, prev = null;
  for (const d of dates) {
    const consecutive = prev && shiftDateStr(prev, 1) === d;
    run = results[d].status === 'solved' ? (consecutive ? run + 1 : 1) : 0;
    if (run > maxStreak) maxStreak = run;
    prev = d;
  }

  // 현재 연승: 오늘(또는 어제)부터 뒤로 이어지는 solved
  let curStreak = 0;
  let cursor = results[todayStr] ? todayStr : shiftDateStr(todayStr, -1);
  while (results[cursor] && results[cursor].status === 'solved') {
    curStreak++;
    cursor = shiftDateStr(cursor, -1);
  }

  return {
    played,
    wins,
    winRate: played ? Math.round((wins / played) * 100) : 0,
    curStreak,
    maxStreak,
    distribution,
    results,
  };
}
