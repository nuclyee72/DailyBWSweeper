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
    distBounds: [2, 4, 6, 10, 15],
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
    distBounds: [4, 7, 10, 15, 25],
  },
};

export const modeOf = (id) => MODES[id] ?? MODES.standard;

export function modeDesc(mode) {
  return `${mode.cols}×${mode.rows} · 레이저 ${mode.lasers} · 지뢰 ${mode.mines}`;
}

/** 시드 문자열: 데일리·지난 퍼즐 'daily:standard:2026-09-27', 자유 연습 'free:…' */
export const dailySeed = (modeId, date) => `daily:${modeId}:${date}`;

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
  placeContents(board, mode.mines, startIdx, rng, { maxRounds: 150 });
  board.startIdx = startIdx;
  return board;
}
