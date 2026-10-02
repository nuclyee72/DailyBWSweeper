/**
 * puzzle.js — 모드 정의 + 시드로 판 만들기.
 * 데일리·지난 퍼즐은 날짜로, 자유 연습은 무작위 시드로 만든다. 같은 시드면 누가 만들어도 같은 판.
 * 시작 칸도 시드로 정해 미리 열어 둔다 (첫 클릭 위치에 따라 판이 달라지지 않게).
 */
import { createBoard, placeContents } from '../core/board.js';
import { rngFromSeed } from '../core/random.js';

/**
 * lasers = 레이저(= 특수 칸) 수, mismatch = 반전기로만 맞힐 수 있게 보장하는 반대 색 목표 수,
 * inverters = 색 반전기 수, lives = 라이프(실수 허용 횟수), distBounds = 통계 완성 시간 분포 구간(분)
 */
/** 통계 완성 시간 분포 — '~10분', 10~20분은 2분씩 5구간, '20분~' (두 모드 같이) */
const DIST_BOUNDS = [10, 12, 14, 16, 18, 20];

export const MODES = {
  standard: {
    id: 'standard',
    label: '스탠다드',
    cols: 12,
    rows: 12,
    mines: 24,
    lasers: 3,
    mismatch: 1,
    inverters: 1,
    lives: 5,
    distBounds: DIST_BOUNDS,
  },
  extended: {
    id: 'extended',
    label: '익스텐디드',
    cols: 16,
    rows: 16,
    mines: 38,
    lasers: 5,
    mismatch: 1,
    inverters: 2,
    lives: 5,
    distBounds: DIST_BOUNDS,
  },
};

export const modeOf = (id) => MODES[id] ?? MODES.standard;

export function modeDesc(mode) {
  return `${mode.cols}×${mode.rows} · 레이저 ${mode.lasers} · 지뢰 ${mode.mines}`;
}

/** 시드 문자열: 데일리·지난 퍼즐 'daily:standard:2026-09-27', 자유 연습 'free:…' */
export const dailySeed = (modeId, date) => `daily:${modeId}:${date}`;

/**
 * 이 날짜부터의 데일리 · 지난 퍼즐과 모든 자유 연습은 처음 레이저 직선 위에 반전기를 두지 않는다.
 * 그 전 날짜는 저장된 진행(칸 번호)이 그 판 기준이라 판을 예전 그대로 만든다.
 */
const INVERTER_OFF_LINES_FROM = '2026-09-29';
function inverterOffLines(seed) {
  const m = /^daily:[^:]+:(\d{4}-\d{2}-\d{2})$/.exec(seed);
  return !m || m[1] >= INVERTER_OFF_LINES_FROM;
}

/** 시드로 판을 만든다. 반환한 판의 startIdx는 처음에 열어 둘 칸. */
export function makeBoard(modeId, seed) {
  const mode = modeOf(modeId);
  const rng = rngFromSeed(seed);
  const { lasers, mismatch, inverters } = mode;
  const board = createBoard(mode.cols, mode.rows, { lasers, mismatch, inverters }, rng);
  // 시작 칸: 가장자리 두 줄 안쪽 아무 곳
  const x = 2 + Math.floor(rng() * (mode.cols - 4));
  const y = 2 + Math.floor(rng() * (mode.rows - 4));
  const startIdx = y * mode.cols + x;
  placeContents(board, mode.mines, startIdx, rng, { maxRounds: 150, inverterOffLines: inverterOffLines(seed) });
  board.startIdx = startIdx;
  return board;
}
