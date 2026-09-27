/**
 * dateUtil.js — 데일리 경계는 KST(UTC+9) 아침 06:00 고정.
 * (06:00~다음날 05:59:59 가 같은 "그 날"). 브라우저·Node 공용 (Date 표준 API만).
 *
 * 계산 트릭: "KST 06:00 경계"는 "UTC+3 자정 경계"와 같다(9시간 - 6시간 = 3시간).
 * 그래서 오프셋을 3시간으로 두고 UTC 자정 기준으로 날짜/카운트다운을 뽑는다.
 */
const RESET_HOUR_KST = 6;
const DAY_OFFSET_MS = (9 - RESET_HOUR_KST) * 60 * 60 * 1000; // = UTC+3

/** 주어진 시각(기본: 지금) 기준 "데일리 날짜"를 'YYYY-MM-DD'로 (경계 = KST 06:00) */
export function dateStrKST(at = Date.now()) {
  const d = new Date(at + DAY_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD'를 하루 이동 */
export function shiftDateStr(dateStr, deltaDays) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const moved = new Date(base + deltaDays * 86400000);
  const yy = moved.getUTCFullYear();
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(moved.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** 다음 데일리 리셋(KST 06:00)까지 남은 ms */
export function msUntilNextReset(at = Date.now()) {
  const shifted = at + DAY_OFFSET_MS;
  const dayMs = shifted % 86400000;
  return 86400000 - dayMs;
}

/** ms → "HH:MM:SS" */
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
