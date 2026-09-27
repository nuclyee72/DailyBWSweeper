/**
 * hubApi.js — ProjectDaily 허브(/ProjectDaily/)가 카드 안에서 이 게임의 통계를 보여 줄 때 쓰는 모듈.
 * 게임 통계창과 같은 계산(storage · share)을 그대로 쓴다. DOM은 건드리지 않는다.
 * (다른 게임과 같은 모양: stats · calendarShareText · todayShareText)
 */
import { dateStrKST } from './daily/dateUtil.js';
import { summarize, loadProgress, distBuckets } from './daily/storage.js';
import { buildCalendarShareText, buildShareText, GAME_TITLE } from './daily/share.js';
import { modeOf } from './game/puzzle.js';

/** 숫자 4개 + 분포 막대 */
export function stats(mode) {
  const s = summarize(dateStrKST(), mode);
  const buckets = distBuckets(mode);
  return {
    played: s.played, winRate: s.winRate, curStreak: s.curStreak, maxStreak: s.maxStreak,
    distTitle: '완성 시간',
    dist: buckets.map((label, i) => ({ label, count: s.distribution[i], fail: i === buckets.length - 1 })),
  };
}

/** 📋 달력 공유 문구 */
export function calendarShareText(modeId, year, month) {
  const mode = modeOf(modeId);
  const { results } = summarize(dateStrKST(), mode.id);
  return buildCalendarShareText({ results, year, month, label: mode.label });
}

/** 오늘 결과 공유 문구 — 오늘 그 모드를 아직 안 끝냈으면 null */
export async function todayShareText(modeId) {
  const mode = modeOf(modeId);
  const today = dateStrKST();
  const p = loadProgress(today, mode.id);
  if (!p || p.status === 'playing') return null;
  const result = { won: p.status === 'solved', total: p.total, hit: p.hit, seconds: Math.round(p.elapsed / 1000), lives: p.lives };
  return buildShareText({ title: [GAME_TITLE, mode.label, today].join(' · '), result });
}
