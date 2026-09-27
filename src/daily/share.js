/**
 * share.js — 결과 공유 텍스트 + 월별 달력 공유 (DailyWordship/src/daily/share.js와 같은 방식).
 */

export const GAME_TITLE = '데일리 흑백 지뢰찾기';

/** 초 → 'm:ss' */
export function formatSeconds(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 특수 칸마다 한 칸 — 🟩 명중(열어서 확인) / ⬛ 못 맞힘. 위치는 드러나지 않는다.
 * @param {{ total: number, hit: number }} targets
 */
export function buildTargetRow({ total, hit }) {
  return '🟩'.repeat(hit) + '⬛'.repeat(Math.max(0, total - hit));
}

/** 결과 요약 한 줄 — '🎯 3/3 · ⏱ 4:12 · ❤️ 4' (실패면 💥, 예전 기록엔 라이프가 없다) */
export function buildSummaryLine({ won, total, hit, seconds, lives }) {
  const life = lives == null ? '' : ` · ❤️ ${lives}`;
  return `${won ? '🎯' : '💥'} ${hit}/${total} · ⏱ ${formatSeconds(seconds)}${life}`;
}

/** 공유용 전체 텍스트. title 예: '데일리 흑백 지뢰찾기 · 스탠다드 · 2026-09-27' */
export function buildShareText({ title, result }) {
  return [title, buildSummaryLine(result), buildTargetRow(result), ''].join('\n');
}

const CAL_EMOJI = { solved: '🟩', fail: '🟥', miss: '⬜', pad: '⬛' };

/**
 * 통계 달력을 이모지 텍스트로. results = { 'YYYY-MM-DD': { status, ... } }
 * 성공 🟩 · 실패 🟥 · 안 함 ⬜ · 달 밖(주 정렬용) ⬛
 */
export function buildCalendarShareText({ results, year, month, label = '' }) {
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(CAL_EMOJI.pad);
  let wins = 0, fails = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r = results[ds];
    if (r && r.status === 'solved') { cells.push(CAL_EMOJI.solved); wins++; }
    else if (r) { cells.push(CAL_EMOJI.fail); fails++; }
    else cells.push(CAL_EMOJI.miss);
  }
  while (cells.length % 7 !== 0) cells.push(CAL_EMOJI.pad);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7).join(''));

  const head = `${GAME_TITLE}${label ? ` · ${label}` : ''} · ${year}-${String(month).padStart(2, '0')}`;
  return [head, `✅ ${wins}  ❌ ${fails}`, '', ...rows, ''].join('\n');
}
