/**
 * main.js — 흑백 지뢰찾기.
 * 화면 구성은 데일리 워드십과 같다: 랜딩(데일리 카드 · 자유 연습 · 지난 퍼즐 · 통계 · 다크 모드),
 * 게임(위쪽 바 + 판 + 입력 모드 패널), 결과·통계·게임 방법 모달.
 * 데일리 판은 날짜 시드로 브라우저에서 만든다 — 누구에게나 같은 판.
 */
import {
  BOOM_ENDS,
  traceLaser,
  revealCell,
  toggleActive,
  canToggle,
  previewToggle,
  setMark,
  computeLasers,
  revealAllOnLoss,
  chordTargets,
} from './core/board.js';
import {
  buildBoardDom,
  renderAll,
  renderCell,
  drawLasers,
  drawPreview,
  clearPreview,
  highlightLasers,
  INVERTER_SVG,
} from './ui/renderer.js';
import { createMarkPalette } from './ui/markPalette.js';
import { createZoomPan } from './ui/zoomPan.js';
import { modeOf, modeDesc, dailySeed, makeBoard } from './game/puzzle.js';
import { dateStrKST, shiftDateStr, msUntilNextReset, formatCountdown } from './daily/dateUtil.js';
import { loadProgress, saveProgress, recordResult, summarize, distBuckets } from './daily/storage.js';
import { GAME_TITLE, formatSeconds, buildShareText, buildSummaryLine, buildTargetRow, buildCalendarShareText } from './daily/share.js';
import { initHub, leaveToHub, saveDarkMode } from './hub.js';

const DAILY_FIRST_DATE = '2026-09-20'; // 지난 퍼즐에서 고를 수 있는 가장 이른 날짜
const TODAY = () => dateStrKST();
const SEEN_HELP_KEY = 'bwsweeper:seen-help';
const SAFE_TAP_KEY = 'bwsweeper:safe-tap';
const LONG_PRESS_MS = 380;
const TOUCH_SLOP = 8; // 이만큼 움직이면 길게 누르기·누름 표시를 그만둔다 (판 끌기로 본다)

const $ = (id) => document.getElementById(id);
const openPanel = (el) => el.classList.add('show');
const closePanel = (el) => el.classList.remove('show');

const landingScreen = $('landing-screen');
const landingMain = $('landing-main');
const landingArchive = $('landing-archive');
const landingCard = document.querySelector('.landing-card');
const gameScreen = $('game-screen');
const grid = $('board-grid');
const laserSvg = $('laser-layer');

/**
 * 지금 하고 있는 판.
 * @type {{ kind: 'daily'|'archive'|'free', modeId: string, date: string, seed: string, board: object,
 *   cellEls: HTMLElement[], traces: object[], elapsedBase: number, startedAt: number|null,
 *   finished: boolean, lostBy: string|null, explodedIdx: number, lives: number } | null}
 */
let session = null;
const ui = {
  inputMode: 'open',
  hoverIdx: -1, // 마우스가 올라간 칸
  touchIdx: -1, // 터치로 누르고 있는 칸
  lastTouchIdx: -1, // 마지막으로 터치한 칸 (확대 버튼이 그 칸을 가운데로)
  pendingIdx: -1, // 터치 두 번 탭: 한 번 누르고 확정을 기다리는 칸
  cursorIdx: -1, // 키보드 커서
  cursorOn: false, // 키보드로 움직였으면 true — 마우스를 움직이면 false
  shift: false, // Shift를 누르는 중 — 어느 모드에서든 거울 미리보기
  lastPointer: 'mouse', // 마지막으로 판을 누른 입력 종류 (click 이벤트만으로는 알 수 없을 때가 있다)
  longPressed: false, // 길게 눌러 팔레트를 열었으면 뒤따르는 click은 무시
  safeTap: false, // 설정: 터치로 열 때도 두 번 눌러 확정
  generating: false,
  answer: null,
};
let palette = null;
let zoom = null;
let timerId = 0;

// 자동 테스트·디버깅용
window.__duo = {
  get board() { return session?.board ?? null; },
  get traces() { return session?.traces ?? []; },
  get session() { return session; },
  get inputMode() { return ui.inputMode; },
  get generating() { return ui.generating; },
  get pendingIdx() { return ui.pendingIdx; },
  get zoomScale() { return zoom?.scale ?? 1; },
  get paletteOpen() { return palette?.isOpen() ?? false; },
};

// ── 판 만들기 ──
/** 판 생성은 익스텐디드에서 1초 넘게 걸릴 수 있다 — 안내를 먼저 그린 뒤 만든다 */
function generate(modeId, seed) {
  ui.generating = true;
  $('gen-toast').classList.add('show');
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(makeBoard(modeId, seed));
      } catch (err) {
        reject(err);
      } finally {
        ui.generating = false;
        $('gen-toast').classList.remove('show');
      }
    }, 30);
  });
}

// ── 화면 전환 ──
function showLanding() {
  pauseTimer();
  persist();
  palette?.close();
  gameScreen.classList.add('hidden');
  landingScreen.classList.remove('hidden');
  landingMain.hidden = false;
  landingArchive.hidden = true;
  $('landing-free').hidden = true;
  landingCard.classList.remove('landing-card--archive');
  refreshLandingCard();
}

function showGame() {
  landingScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

// ── 게임 시작 ──
function whereLabel(s) {
  if (s.kind === 'daily') return s.date;
  if (s.kind === 'archive') return `${s.date} 지난 퍼즐`;
  return '자유 연습';
}

function baseLabel() {
  return `${modeOf(session.modeId).label} · ${whereLabel(session)}`;
}

function sessionTitle() {
  const mode = modeOf(session.modeId);
  return [GAME_TITLE, mode.label, session.kind === 'free' ? '자유 연습' : session.date].join(' · ');
}

function openGame({ kind, modeId, date, seed, board, progress = null }) {
  session = {
    kind,
    modeId,
    date,
    seed,
    board,
    cellEls: buildBoardDom(grid, board),
    traces: [],
    elapsedBase: 0,
    startedAt: null,
    finished: false,
    lostBy: null,
    explodedIdx: -1,
    lives: modeOf(modeId).lives,
  };

  if (progress) applyProgress(progress);
  else revealCell(board, board.startIdx);

  palette.close();
  zoom.reset();
  closePanel($('daily-result-modal'));
  ui.answer = null;
  // 칸 DOM을 새로 만들었으니 칸에 달아 둔 표시(확정 대기·커서·누름)는 처음부터
  for (const cls of Object.keys(cellMarks)) cellMarks[cls] = -1;
  ui.pendingIdx = -1;
  ui.cursorIdx = -1;
  ui.cursorOn = false;
  ui.touchIdx = -1;
  ui.lastTouchIdx = -1;
  gameScreen.classList.remove('viewing-answer');
  setInputMode('open');
  $('ds-mode-label').textContent = baseLabel();
  $('btn-new-free').hidden = kind !== 'free';
  $('btn-view-answer').textContent = '정답 보기';
  $('btn-view-answer').hidden = !(session.finished && board.solution);
  showGame();
  refresh();
  if (session.finished) setTimeout(showResultModal, 200);
  else startTimer();
  persist();
}

/** 저장해 둔 진행을 판에 되살린다 (판은 시드로 똑같이 다시 만들었다) */
function applyProgress(p) {
  const { board } = session;
  for (const i of p.revealed) board.cells[i].revealed = true;
  for (const i of p.active) board.cells[i].active = true;
  for (const [i, mark] of Object.entries(p.marks ?? {})) board.cells[i].mark = mark;
  session.elapsedBase = p.elapsed ?? 0;
  session.lives = p.lives ?? session.lives;
  // 실수로 알아낸 지뢰(하던 중에 드러난 지뢰)는 "알아낸 지뢰"로 표시
  if (p.status === 'playing') for (const c of board.cells) if (c.revealed && c.isMine) c.known = true;
  if (p.status !== 'playing') {
    session.finished = true;
    session.lostBy = p.lostBy ?? null;
    session.explodedIdx = p.explodedIdx ?? -1;
    board.gameOver = true;
    board.won = p.status === 'solved';
    if (!board.won) revealAllOnLoss(board);
  }
}

async function startDaily(modeId) {
  if (ui.generating) return;
  const date = TODAY();
  const seed = dailySeed(modeId, date);
  $('daily-load-note').hidden = false;
  $('daily-error').textContent = '';
  try {
    const board = await generate(modeId, seed);
    const saved = loadProgress(date, modeId);
    openGame({ kind: 'daily', modeId, date, seed, board, progress: saved?.seed === seed ? saved : null });
  } catch (err) {
    $('daily-error').textContent = '퍼즐을 만들지 못했어요. 다시 시도해 주세요.';
    console.error(err);
  } finally {
    $('daily-load-note').hidden = true;
  }
}

async function startFreePlay(modeId) {
  if (ui.generating) return;
  const seed = `free:${Date.now()}:${Math.random()}`;
  const board = await generate(modeId, seed);
  openGame({ kind: 'free', modeId, date: '자유 연습', seed, board });
}

async function startArchive(modeId, date) {
  if (ui.generating) return;
  const seed = dailySeed(modeId, date);
  const board = await generate(modeId, seed);
  openGame({ kind: 'archive', modeId, date, seed, board });
}

// ── 진행 저장 (데일리만) ──
function targetResult() {
  const { board } = session;
  const hit = board.specialIdxs.filter((si) => board.cells[si].lit && board.cells[si].revealed).length;
  return { won: board.won, total: board.specialIdxs.length, hit, seconds: Math.round(elapsedMs() / 1000), lives: session.lives };
}

function persist() {
  if (session?.kind !== 'daily') return;
  const { board } = session;
  const lost = session.finished && !board.won;
  const revealed = [];
  const active = [];
  const marks = {};
  board.cells.forEach((c, i) => {
    // 패배 뒤 자동으로 드러낸 지뢰·특수 칸은 저장하지 않는다 (복원할 때 다시 드러낸다)
    if (c.revealed && !(lost && (c.isMine || c.special) && i !== session.explodedIdx)) revealed.push(i);
    if (c.active) active.push(i);
    if (c.mark) marks[i] = c.mark;
  });
  const result = targetResult();
  saveProgress({
    date: session.date,
    seed: session.seed,
    status: session.finished ? (board.won ? 'solved' : 'failed') : 'playing',
    revealed,
    active,
    marks,
    elapsed: elapsedMs(),
    lostBy: session.lostBy,
    explodedIdx: session.explodedIdx,
    hit: result.hit,
    total: result.total,
    lives: session.lives,
  }, session.modeId);
}

// ── 타이머 ──
function elapsedMs() {
  if (!session) return 0;
  return session.elapsedBase + (session.startedAt ? performance.now() - session.startedAt : 0);
}

function renderTime() {
  $('hud-time').textContent = formatSeconds(elapsedMs() / 1000);
}

function startTimer() {
  if (!session || session.finished) return;
  if (!session.startedAt) session.startedAt = performance.now();
  clearInterval(timerId);
  timerId = setInterval(renderTime, 500);
  renderTime();
}

function pauseTimer() {
  clearInterval(timerId);
  if (session?.startedAt) {
    session.elapsedBase = elapsedMs();
    session.startedAt = null;
  }
  if (session) renderTime();
}

// ── 판 갱신 ──
/** 레이저를 다시 계산하고 판 전체를 다시 그린다. 새로 끝났으면(클리어·레이저 폭발) 마무리한다. */
function refresh() {
  const { board } = session;
  const wasOver = board.gameOver;
  const { traces, hitIdx, hitKind } = computeLasers(board);
  session.traces = traces;

  const newlyOver = !wasOver && board.gameOver;
  if (newlyOver && !board.won) {
    revealAllOnLoss(board);
    session.explodedIdx = hitIdx;
  }
  renderAll(session.cellEls, board);
  renderExploded();
  drawLasers(laserSvg, board, traces);
  updatePreview();
  updateHighlight();
  updateHud();

  if (newlyOver) finish(board.won ? null : hitKind === 'wrong' ? 'wrongTarget' : 'laser');
}

function renderExploded() {
  if (session.explodedIdx >= 0) session.cellEls[session.explodedIdx].classList.add('is-exploded');
}

function updateHud() {
  const { hit, total } = targetResult();
  $('hud-targets').textContent = `${hit}/${total}`;
  $('hud-lives').textContent = String(session.lives);
  $('hud-lives-wrap').classList.toggle('is-low', session.lives <= 1);
  renderTime();
}

/** 클리어·패배 마무리: 시간 멈춤, 데일리는 기록, 결과 창 */
function finish(lostBy) {
  session.finished = true;
  session.lostBy = lostBy;
  pauseTimer();
  $('btn-view-answer').hidden = !session.board.solution;
  if (session.kind === 'daily') {
    const { won, seconds } = targetResult();
    recordResult(session.date, won ? 'solved' : 'failed', seconds, session.modeId);
  }
  persist();
  setTimeout(showResultModal, lostBy ? 450 : 350);
}

// ── 입력 ──
/*
 * 조작 한눈에:
 *   공통   — 누르기 = 지금 모드의 행동 (열기 · 표시 · 거울). 열기 모드에서 숫자 칸을 누르면 주변 열기.
 *   마우스 — 우클릭 = 표시 팔레트 (누른 채 조각까지 끌어서 놓으면 바로), Shift+클릭 = 거울 켜기/끄기,
 *            Shift를 누르고 있으면 어느 모드에서든 거울 미리보기.
 *   키보드 — 1·2·3 모드, 방향키 커서, Enter = 지금 모드의 행동, Space = 거울, Q·W·E = 검·흰 표시·삭제
 *            (마우스가 올라간 칸 또는 커서 칸에).
 *   터치   — 길게 누르기 = 표시 팔레트 (손을 떼지 않고 조각까지 끌어서 놓으면 바로),
 *            거울 모드는 두 번 탭 (첫 탭 = 미리보기, 같은 칸 다시 = 확정), 설정에 따라 열기도 두 번 탭.
 */

/** 칸에 하나씩만 다는 표시 (확정 대기 · 키보드 커서 · 누르는 중) — 클래스 → 칸 번호 */
const cellMarks = { 'is-pending': -1, 'is-cursor': -1, 'is-pressing': -1 };
function markCell(cls, i) {
  const prev = cellMarks[cls];
  if (prev === i) return;
  if (prev >= 0) session?.cellEls[prev]?.classList.remove(cls);
  cellMarks[cls] = i;
  if (i >= 0) session?.cellEls[i]?.classList.add(cls);
}

function setInputMode(mode) {
  ui.inputMode = mode;
  for (const btn of document.querySelectorAll('[data-input-mode]')) {
    const on = btn.dataset.inputMode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  for (const m of ['open', 'mark', 'laser']) gameScreen.classList.toggle(`mode-${m}`, m === mode);
  setPending(-1);
  updatePreview();
  updateHighlight();
}

/** 이 칸에 지금 모드로 할 수 있는 일이 있는지 (두 번 탭의 첫 탭을 받을지) */
function canActOn(i) {
  const { board } = session;
  const cell = board.cells[i];
  if (ui.inputMode === 'laser') return canToggle(board, i);
  if (ui.inputMode === 'open') return cell.revealed ? chordTargets(board, i).length > 0 : !cell.mark;
  return !cell.revealed;
}

/**
 * 칸을 눌렀다 (클릭·탭·Enter).
 * touch: 터치로 눌렀으면 거울 모드(그리고 '두 번 눌러 열기' 설정이면 열기 모드)는 첫 탭에 확정 대기만 한다.
 */
function onCellClick(i, { touch = false, shift = false } = {}) {
  if (!session || session.finished || ui.generating || ui.answer) return;
  if (shift) {
    toggleMirror(i);
    return;
  }
  const confirm = touch && (ui.inputMode === 'laser' || (ui.safeTap && ui.inputMode === 'open'));
  if (confirm && ui.pendingIdx !== i) {
    if (!canActOn(i)) {
      setPending(-1);
      return;
    }
    setPending(i);
    const cell = session.board.cells[i];
    if (ui.inputMode === 'laser') hintOnce('laser', `한 번 더 누르면 거울을 ${cell.active ? '꺼요' : '켜요'}`);
    else hintOnce('open', '한 번 더 누르면 열려요');
    return;
  }
  setPending(-1);
  act(i, { touch });
}

/** 지금 모드의 행동 */
function act(i, { touch = false } = {}) {
  const cell = session.board.cells[i];
  if (ui.inputMode === 'laser') toggleMirror(i);
  else if (ui.inputMode === 'mark') openPalette(i, { touch });
  else if (cell.revealed) chord(i);
  else openCells([i]);
}

/** 연 칸의 거울을 켜고 끈다 */
function toggleMirror(i) {
  if (!session || session.finished || ui.answer) return;
  const { board } = session;
  const cell = board.cells[i];
  if (!cell.revealed || !toggleActive(board, i)) return;
  setPending(-1);
  // 이 거울 때문에 레이저가 터지면: 라이프가 남아 있으면 되돌리고, 레이저가 닿은 칸을 알려 준다
  const boom = board.emitters.map((em) => traceLaser(board, em)).find((t) => BOOM_ENDS.has(t.end));
  if (boom && session.lives > 1) {
    cell.active = !cell.active;
    loseLife(boom.cellIdx);
    return;
  }
  if (boom) session.lives = 0;
  refresh();
  persist();
}

/** 숫자 칸 눌러 주변 열기 — 주변 지뢰 표시(와 아는 칸)가 검·흰 숫자를 다 채웠을 때만 */
function chord(i) {
  const targets = chordTargets(session.board, i);
  if (targets.length) openCells(targets);
}

/**
 * 안 연 칸들을 연다 (표시 달린 칸은 건너뛴다).
 * 지뢰를 열면: 라이프가 남아 있으면 열지 않은 것으로 하고 그 칸이 무슨 색 지뢰인지 알려 준다. 마지막 라이프면 폭발.
 */
function openCells(idxs) {
  const { board } = session;
  const lost = [];
  for (const i of idxs) {
    const cell = board.cells[i];
    if (cell.revealed || cell.mark) continue;
    if (!cell.isMine) {
      revealCell(board, i);
      continue;
    }
    if (session.lives > 1) {
      session.lives -= 1;
      cell.revealed = true;
      cell.known = true;
      lost.push(i);
      continue;
    }
    session.lives = 0;
    revealCell(board, i);
    explode(i);
    return;
  }
  refresh();
  if (lost.length) lifeLostFx(lost);
  persist();
}

/** 지뢰를 열어 끝남 */
function explode(i) {
  const { board } = session;
  revealAllOnLoss(board);
  session.explodedIdx = i;
  const { traces } = computeLasers(board);
  session.traces = traces;
  renderAll(session.cellEls, board);
  renderExploded();
  drawLasers(laserSvg, board, traces);
  updateHud();
  finish('mine');
}

/**
 * 실수 — 라이프 1개를 잃고 행동은 없던 일로. 그 행동으로 알 수 있었던 정보는 남긴다:
 *   레이저가 지뢰에 닿았으면 그 칸을 "알아낸 지뢰"로 드러내고,
 *   레이저가 반대 색 특수 칸에 닿았으면 그 특수 칸을 연다.
 */
function loseLife(cellIdx) {
  const { board } = session;
  const cell = board.cells[cellIdx];
  session.lives -= 1;
  cell.revealed = true;
  cell.mark = null;
  if (cell.isMine) cell.known = true;
  refresh();
  lifeLostFx([cellIdx]);
  persist();
}

function lifeLostFx(idxs) {
  for (const i of idxs) {
    const el = session.cellEls[i];
    el.classList.remove('is-life-lost');
    void el.offsetWidth; // 애니메이션 다시 시작
    el.classList.add('is-life-lost');
  }
  showToast(`💔 라이프 -${idxs.length}`);
  navigator.vibrate?.(60);
}

let toastTimer = 0;
function showToast(text, ms = 2600) {
  const t = $('life-toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** 조작 안내는 한 번 들어올 때 한 번만 */
const hinted = new Set();
function hintOnce(key, text) {
  if (hinted.has(key)) return;
  hinted.add(key);
  showToast(text, 2000);
}

function openPalette(i, { touch = false } = {}) {
  if (!session || session.finished || ui.answer || session.board.cells[i].revealed) return false;
  setPending(-1);
  markCell('is-pressing', -1);
  palette.open(session.cellEls[i], i, session.board.cells[i].mark, { touch });
  updatePreview(); // 팔레트가 떠 있는 동안엔 미리보기를 숨긴다
  return true;
}

function onMarkPicked(i, mark) {
  if (!setMark(session.board, i, mark)) return;
  renderCell(session.cellEls[i], session.board.cells[i]);
  persist();
  updatePreview();
}

/** 단축키 Q·W·E — 같은 표시를 한 번 더 누르면 지운다 */
function markShortcut(i, mark) {
  if (!session || session.finished || ui.answer) return;
  const cell = session.board.cells[i];
  if (cell.revealed) return;
  palette.close();
  onMarkPicked(i, mark && cell.mark === mark ? null : mark);
}

function setPending(i) {
  if (ui.pendingIdx === i) return;
  ui.pendingIdx = i;
  markCell('is-pending', i);
  updatePreview();
  updateHighlight();
}

/** 마우스·키보드가 가리키는 칸 */
function pointedIdx() {
  return ui.cursorOn ? ui.cursorIdx : ui.hoverIdx;
}

/** 거울을 미리 볼 때 (거울 모드, 또는 Shift를 누르는 중) */
const mirrorView = () => ui.inputMode === 'laser' || ui.shift;

/**
 * 거울을 켜고 끄면 레이저가 어떻게 꺾일지 미리 보여준다 —
 * 마우스를 올린 칸 · 키보드 커서 칸 · 터치로 확정을 기다리는 칸.
 */
function updatePreview() {
  if (!session) return;
  let i = -1;
  if (ui.pendingIdx >= 0 && ui.inputMode === 'laser') i = ui.pendingIdx;
  else if (mirrorView()) i = pointedIdx();
  if (i < 0 || !canToggle(session.board, i) || palette.isOpen()) {
    clearPreview(laserSvg);
    return;
  }
  const { now, next } = previewToggle(session.board, i);
  drawPreview(laserSvg, session.board, i, now, next);
}

function setHover(i) {
  if (ui.hoverIdx === i) return;
  ui.hoverIdx = i;
  updatePreview();
  updateHighlight();
}

function setShift(on) {
  if (ui.shift === on) return;
  ui.shift = on;
  gameScreen.classList.toggle('is-shift', on);
  updatePreview();
  updateHighlight();
}

/** 키보드 커서 이동 (처음엔 마우스가 올라간 칸이나 시작 칸에서) */
function moveCursor(dx, dy) {
  if (!session) return;
  const { board } = session;
  let i = ui.cursorOn ? ui.cursorIdx : ui.hoverIdx >= 0 ? ui.hoverIdx : ui.cursorIdx;
  if (i < 0) i = board.startIdx;
  else {
    const x = Math.max(0, Math.min(board.cols - 1, (i % board.cols) + dx));
    const y = Math.max(0, Math.min(board.rows - 1, Math.floor(i / board.cols) + dy));
    i = y * board.cols + x;
  }
  ui.cursorIdx = i;
  ui.cursorOn = true;
  markCell('is-cursor', i);
  updatePreview();
  updateHighlight();
}

function hideCursor() {
  if (!ui.cursorOn) return;
  ui.cursorOn = false;
  markCell('is-cursor', -1);
}

/** 거울을 미리 볼 때, 가리키는(터치는 누르고 있는) 칸을 지나가는 레이저를 노랗게 */
function updateHighlight() {
  if (!session) return;
  let i = -1;
  if (mirrorView()) i = ui.touchIdx >= 0 ? ui.touchIdx : ui.pendingIdx >= 0 ? ui.pendingIdx : pointedIdx();
  if (i < 0) {
    highlightLasers(laserSvg, []);
    return;
  }
  const ks = [];
  (ui.answer?.traces ?? session.traces).forEach((t, k) => { if (t.cells?.includes(i)) ks.push(k); });
  highlightLasers(laserSvg, ks);
}

// ── 확대 버튼 (터치 화면) ──
/** 확대 안 돼 있으면 칸이 손가락 크기(약 42px)가 되게 확대 — 확정 대기 칸이나 마지막으로 누른 칸을 가운데로 */
function toggleZoom() {
  if (!session) return;
  if (zoom.scale > 1) {
    zoom.reset({ animate: true });
    return;
  }
  const cellW = session.cellEls[0].getBoundingClientRect().width || 20;
  const target = Math.min(zoom.MAX_SCALE, Math.max(1.8, 42 / cellW));
  const focus = ui.pendingIdx >= 0 ? ui.pendingIdx : ui.lastTouchIdx;
  const r = (focus >= 0 ? session.cellEls[focus] : grid).getBoundingClientRect();
  zoom.zoomTo(target, r.left + r.width / 2, r.top + r.height / 2);
}

function setSafeTap(on) {
  ui.safeTap = on;
  $('opt-safe-tap').checked = on;
  try { localStorage.setItem(SAFE_TAP_KEY, on ? '1' : '0'); } catch { /* 무시 */ }
  if (!on && ui.inputMode === 'open') setPending(-1);
}

// ── 정답 보기 (끝난 판에서만) ──
/**
 * 판을 만들 때 검증해 둔 풀이 하나를 보여 준다 — 판 전체를 열고, 풀이의 거울을 켠 모습과 레이저 경로.
 * 실제 판은 건드리지 않고 복사본에 그린다 (진행·기록은 그대로).
 */
function showAnswer() {
  const { board } = session;
  if (!session.finished || !board.solution) return;
  const ans = structuredClone(board);
  for (const c of ans.cells) {
    c.revealed = true;
    c.active = false;
    c.mark = null;
    c.wrongMark = false;
  }
  // solution.order는 배열에 붙인 속성이라 복사본엔 없다 — 원본에서 읽는다
  for (const i of board.solution.order) ans.cells[i].active = true;
  ans.gameOver = true;
  ans.won = true;
  const { traces } = computeLasers(ans);
  ui.answer = { board: ans, traces };

  gameScreen.classList.add('viewing-answer');
  for (const el of session.cellEls) el.classList.remove('is-exploded');
  renderAll(session.cellEls, ans);
  drawLasers(laserSvg, ans, traces);
  updateHighlight();
  $('btn-view-answer').textContent = '내 판 보기';
  $('ds-mode-label').textContent = `${baseLabel()} · 정답`;
}

function hideAnswer() {
  if (!ui.answer) return;
  ui.answer = null;
  gameScreen.classList.remove('viewing-answer');
  renderAll(session.cellEls, session.board);
  renderExploded();
  drawLasers(laserSvg, session.board, session.traces);
  updateHighlight();
  $('btn-view-answer').textContent = '정답 보기';
  $('ds-mode-label').textContent = baseLabel();
}

// ── 결과 모달 ──
function showResultModal() {
  if (!session?.finished) return;
  const mode = modeOf(session.modeId);
  const result = targetResult();
  $('daily-result-title').textContent = result.won ? '🎯 클리어!' : '💥 게임 오버';
  const note = session.kind === 'daily' ? '' : ' (기록에는 반영되지 않아요)';
  $('daily-result-detail').textContent = `${mode.label} · ${whereLabel(session)}\n${buildSummaryLine(result)}${note}`;
  $('daily-result-grid').textContent = buildTargetRow(result);
  $('daily-share-note').textContent = '';
  openPanel($('daily-result-modal'));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ── 랜딩 ──
function refreshLandingCard() {
  $('landing-date').textContent = TODAY();
  for (const el of document.querySelectorAll('[data-desc]')) el.textContent = modeDesc(modeOf(el.dataset.desc));
  for (const el of document.querySelectorAll('[data-status-for]')) {
    const modeId = el.dataset.statusFor;
    const today = summarize(TODAY(), modeId).results[TODAY()];
    if (today?.status === 'solved') { el.textContent = `성공 · ${formatSeconds(today.seconds)}`; el.dataset.status = 'solved'; }
    else if (today?.status === 'failed') { el.textContent = '실패'; el.dataset.status = 'timeout'; }
    else {
      const p = loadProgress(TODAY(), modeId);
      if (p && p.status === 'playing' && p.elapsed > 1000) {
        el.textContent = `진행 중 · ${formatSeconds(p.elapsed / 1000)}`;
        el.dataset.status = 'playing';
      } else { el.textContent = '플레이 전'; el.dataset.status = 'new'; }
    }
  }
}

// ── 달력 (통계·지난 퍼즐 공용 — 데일리 워드십과 같은 모양) ──
function makeCalendar({ gridEl, titleEl, prevEl, nextEl, pick = false, onPick = null }) {
  const CAL_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  let monthOffset = 0;
  let sum = { results: {} };
  let selected = null;
  let minDate = null, maxDate = null;

  function monthYM() {
    const [ty, tm] = TODAY().split('-').map(Number);
    const b = new Date(Date.UTC(ty, tm - 1 + monthOffset, 1));
    return { y: b.getUTCFullYear(), m: b.getUTCMonth() + 1 };
  }

  function render() {
    const today = TODAY();
    const { y, m } = monthYM();
    const mm = String(m).padStart(2, '0');
    titleEl.textContent = `${y}년 ${m}월`;
    if (nextEl) nextEl.disabled = monthOffset >= 0;
    if (prevEl) prevEl.disabled = !!minDate && `${y}-${mm}` <= minDate.slice(0, 7);

    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    gridEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'cal-grid cal-head';
    for (const w of CAL_WEEKDAYS) {
      const c = document.createElement('span');
      c.className = 'cal-dow';
      c.textContent = w;
      head.appendChild(c);
    }
    gridEl.appendChild(head);

    const body = document.createElement('div');
    body.className = 'cal-grid';
    for (let i = 0; i < firstDow; i++) body.appendChild(document.createElement('span'));
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${y}-${mm}-${String(d).padStart(2, '0')}`;
      const r = sum.results[dateStr];
      const cell = document.createElement('span');
      cell.className = 'cal-cell';
      if (dateStr === today) cell.classList.add('cal-cell--today');
      if (pick && dateStr === selected) cell.classList.add('cal-cell--picked');
      const dayNum = document.createElement('span');
      dayNum.className = 'cal-day';
      dayNum.textContent = d;
      cell.appendChild(dayNum);
      if (r) {
        cell.classList.add('cal-cell--filled', r.status === 'solved' ? 'cal-cell--solved' : 'cal-cell--fail');
        const v = document.createElement('span');
        v.className = 'cal-val';
        v.textContent = r.status === 'solved' ? formatSeconds(r.seconds ?? 0) : '✕';
        cell.appendChild(v);
      } else if (dateStr > today) cell.classList.add('cal-cell--future');
      else if (minDate && dateStr < minDate) cell.classList.add('cal-cell--locked');
      else cell.classList.add('cal-cell--miss');
      if (pick && minDate && maxDate && dateStr >= minDate && dateStr <= maxDate) {
        cell.classList.add('cal-cell--pickable');
        cell.addEventListener('click', () => { selected = dateStr; render(); onPick?.(dateStr); });
      }
      body.appendChild(cell);
    }
    gridEl.appendChild(body);
  }

  prevEl?.addEventListener('click', () => { monthOffset -= 1; render(); });
  nextEl?.addEventListener('click', () => { if (monthOffset < 0) { monthOffset += 1; render(); } });

  return {
    render,
    monthYM,
    open(summary, { selected: sel = null, minDate: mn = null, maxDate: mx = null, resetMonth = true } = {}) {
      sum = summary; selected = sel; minDate = mn; maxDate = mx;
      if (resetMonth) monthOffset = 0;
      render();
    },
  };
}

// ── 지난 퍼즐 ──
let archiveSelected = null;
let archiveMode = 'standard';
const archiveCal = makeCalendar({
  gridEl: $('archive-cal'),
  titleEl: $('archive-cal-title'),
  prevEl: $('archive-cal-prev'),
  nextEl: $('archive-cal-next'),
  pick: true,
  onPick: (d) => { archiveSelected = d; $('btn-archive-play').disabled = false; $('archive-error').textContent = ''; },
});

function paintArchiveCal(resetMonth) {
  document.querySelectorAll('.archive-type').forEach((b) => b.classList.toggle('active', b.dataset.mode === archiveMode));
  archiveCal.open(summarize(TODAY(), archiveMode), {
    selected: archiveSelected, minDate: DAILY_FIRST_DATE, maxDate: shiftDateStr(TODAY(), -1), resetMonth,
  });
}

// ── 통계 모달 ──
const statsCal = makeCalendar({
  gridEl: $('daily-stats-cal'),
  titleEl: $('daily-cal-title'),
  prevEl: $('daily-cal-prev'),
  nextEl: $('daily-cal-next'),
});
let statsCountdownTimer = 0;
let statsMode = 'standard';

function renderStats() {
  document.querySelectorAll('.daily-stats-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === statsMode));
  const s = summarize(TODAY(), statsMode);
  $('stat-played').textContent = s.played;
  $('stat-winrate').textContent = s.winRate;
  $('stat-streak').textContent = s.curStreak;
  $('stat-maxstreak').textContent = s.maxStreak;
  statsCal.open(s, { minDate: DAILY_FIRST_DATE });

  const dist = $('daily-stats-dist');
  dist.innerHTML = '';
  const max = Math.max(1, ...s.distribution);
  const buckets = distBuckets(statsMode);
  buckets.forEach((label, i) => {
    const count = s.distribution[i];
    const row = document.createElement('div');
    row.className = 'ws-dist-row';
    row.innerHTML = `<span class="ws-dist-label">${label}</span>
      <span class="ws-dist-track"><span class="ws-dist-fill${i === buckets.length - 1 ? ' is-fail' : ''}" style="width:${(count / max) * 100}%"></span></span>
      <span class="ws-dist-count">${count}</span>`;
    dist.appendChild(row);
  });
  $('daily-stats-share-note').textContent = '';
  $('cal-share-note').textContent = '';
}

function openStatsModal(modeId = session?.modeId ?? 'standard') {
  statsMode = modeId;
  renderStats();
  openPanel($('daily-stats-modal'));
  clearInterval(statsCountdownTimer);
  const tick = () => { $('daily-next-countdown').textContent = formatCountdown(msUntilNextReset()); };
  tick();
  statsCountdownTimer = setInterval(tick, 1000);
}

function closeStatsModal() {
  closePanel($('daily-stats-modal'));
  clearInterval(statsCountdownTimer);
}

// ── 다크 모드 ──
function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function setDark(dark) {
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  saveDarkMode(dark); // 허브·다른 게임과 같이
  $('btn-landing-dark').textContent = dark ? '라이트 모드' : '다크 모드';
}

// ── 도움말 ──
function openHelpModal() {
  openPanel($('game-help-modal'));
}

// ── 이벤트 연결 ──
function init() {
  // 판: 칸 이벤트는 컨테이너에 한 번만 위임
  const cellIdxOf = (e) => {
    const cell = e.target.closest?.('.ds-cell');
    return cell ? Number(cell.dataset.idx) : -1;
  };
  grid.addEventListener('click', (e) => {
    if (ui.longPressed) {
      ui.longPressed = false;
      return;
    }
    const i = cellIdxOf(e);
    if (i < 0) return;
    const mouse = ui.lastPointer === 'mouse';
    onCellClick(i, { touch: !mouse, shift: mouse && e.shiftKey });
  });
  // 마우스로 누른 칸 버튼이 포커스를 가져가지 않게 (Space·Enter는 키보드 단축키로 쓴다)
  grid.addEventListener('mousedown', (e) => e.preventDefault());
  // 우클릭 메뉴는 늘 막는다. 마우스 우클릭은 pointerdown에서 이미 팔레트를 열었고
  // (윈도우는 contextmenu가 버튼을 뗄 때 온다 — 그새 끌어서 골라 닫았을 수 있다),
  // 터치 길게 누르기는 직접 잰다 (iOS는 길게 눌러도 contextmenu가 안 온다). 키보드 메뉴 키만 여기서 연다.
  let rightDownAt = -Infinity;
  grid.addEventListener('contextmenu', (e) => {
    const i = cellIdxOf(e);
    if (i < 0) return;
    e.preventDefault();
    if (ui.lastPointer === 'mouse' && performance.now() - rightDownAt > 1500 && !palette.isOpen()) openPalette(i);
  });
  grid.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return; // 터치는 탭 뒤에 hover가 남아 헷갈린다
    hideCursor();
    setHover(cellIdxOf(e));
  });
  grid.addEventListener('pointerleave', () => setHover(-1));
  // Shift는 keyup을 놓칠 수 있어서(창 밖에서 뗌) 마우스가 움직일 때도 맞춘다
  grid.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') setShift(e.shiftKey);
  });

  // 누르기 시작 — 마우스 우클릭은 팔레트(누른 채 끌어서 고르기), 터치는 누름 표시 · 레이저 강조 · 길게 누르기
  let longPress = null; // { id, x0, y0, x, y, idx, timer }
  const cancelLongPress = () => {
    if (!longPress) return;
    clearTimeout(longPress.timer);
    longPress = null;
  };
  grid.addEventListener('pointerdown', (e) => {
    const i = cellIdxOf(e);
    ui.lastPointer = e.pointerType || 'mouse';
    ui.longPressed = false;
    if (i < 0) return;
    if (e.pointerType === 'mouse') {
      if (e.button !== 2) return;
      rightDownAt = performance.now();
      if (openPalette(i)) palette.beginDrag(e);
      return;
    }
    if (!e.isPrimary) return; // 두 번째 손가락 = 핀치 (아래 window 리스너가 길게 누르기를 취소)
    ui.touchIdx = i;
    ui.lastTouchIdx = i;
    markCell('is-pressing', i);
    updateHighlight();
    cancelLongPress();
    const lp = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, idx: i, timer: 0 };
    lp.timer = setTimeout(() => {
      longPress = null;
      if (!session || session.finished || ui.answer || session.board.cells[lp.idx].revealed) return;
      ui.longPressed = true;
      zoom.cancelGesture(); // 팔레트까지 끄는 동안 판이 따라 움직이지 않게
      navigator.vibrate?.(12);
      if (openPalette(lp.idx, { touch: true })) palette.beginDrag({ pointerId: lp.id, clientX: lp.x, clientY: lp.y });
    }, LONG_PRESS_MS);
    longPress = lp;
  });
  window.addEventListener('pointerdown', (e) => {
    if (longPress && e.pointerId !== longPress.id) {
      cancelLongPress();
      markCell('is-pressing', -1);
    }
  }, true);
  window.addEventListener('pointermove', (e) => {
    if (!longPress || e.pointerId !== longPress.id) return;
    longPress.x = e.clientX;
    longPress.y = e.clientY;
    if (Math.hypot(e.clientX - longPress.x0, e.clientY - longPress.y0) > TOUCH_SLOP) {
      cancelLongPress();
      markCell('is-pressing', -1); // 판을 끄는 중 — 손을 떼도 칸이 눌리지 않는다
    }
  });
  const endTouch = (e) => {
    if (e.pointerType === 'mouse') return;
    cancelLongPress();
    markCell('is-pressing', -1);
    if (ui.touchIdx < 0) return;
    ui.touchIdx = -1;
    updateHighlight();
  };
  window.addEventListener('pointerup', endTouch);
  window.addEventListener('pointercancel', endTouch);

  palette = createMarkPalette(gameScreen, onMarkPicked);
  // 터치: 두 손가락 확대, 한 손가락 이동, 확대 버튼
  zoom = createZoomPan(document.querySelector('.board-area'), document.querySelector('.board-stage'), {
    onChange: (scale) => {
      const zoomed = scale > 1;
      $('btn-zoom').classList.toggle('active', zoomed);
      $('btn-zoom').setAttribute('aria-label', zoomed ? '판 맞춤' : '판 확대');
      $('btn-zoom').querySelector('.zoom-ico').textContent = zoomed ? '⤢' : '🔍';
      $('btn-zoom').querySelector('.zoom-txt').textContent = zoomed ? '맞춤' : '확대';
      document.querySelector('.board-area').classList.toggle('is-zoomed', zoomed);
    },
  });
  $('btn-zoom').addEventListener('click', toggleZoom);
  // 판 밖(여백)을 누르면 확정 대기를 푼다
  document.querySelector('.board-area').addEventListener('click', (e) => {
    if (!e.target.closest('.ds-cell')) setPending(-1);
  });

  // 설정: 두 번 눌러 열기
  try { ui.safeTap = localStorage.getItem(SAFE_TAP_KEY) === '1'; } catch { /* 무시 */ }
  $('opt-safe-tap').checked = ui.safeTap;
  $('opt-safe-tap').addEventListener('change', (e) => setSafeTap(e.target.checked));

  // 레이저 좌표는 실제 칸 크기에 맞춰 계산하므로 창 크기가 바뀌면 다시 그린다
  window.addEventListener('resize', () => {
    if (!session) return;
    palette.close(); // 화면 좌표에 떠 있으므로 칸 위치가 바뀌면 닫는다
    if (ui.answer) drawLasers(laserSvg, ui.answer.board, ui.answer.traces);
    else drawLasers(laserSvg, session.board, session.traces);
    updatePreview();
    updateHighlight();
  });

  // 입력 모드
  for (const btn of document.querySelectorAll('[data-input-mode]')) {
    btn.addEventListener('click', () => setInputMode(btn.dataset.inputMode));
  }

  // 게임 위쪽 바
  // 허브에서 들어왔으면 '메인 화면'은 허브로 (방문 기록을 쌓지 않고)
  const backToMain = () => {
    pauseTimer();
    persist();
    if (!leaveToHub()) showLanding();
  };
  $('btn-go-landing').addEventListener('click', backToMain);
  $('btn-game-stats').addEventListener('click', () => openStatsModal());
  $('btn-game-help').addEventListener('click', openHelpModal);
  $('btn-new-free').addEventListener('click', () => startFreePlay(session.modeId));
  $('btn-view-answer').addEventListener('click', () => (ui.answer ? hideAnswer() : showAnswer()));

  // 랜딩
  for (const btn of document.querySelectorAll('[data-daily]')) btn.addEventListener('click', () => startDaily(btn.dataset.daily));
  // 자유 연습 모드 고르기 — 랜딩 카드 안에서 메인과 바꿔 보여 준다
  $('btn-free-play').addEventListener('click', () => {
    landingMain.hidden = true;
    $('landing-free').hidden = false;
  });
  for (const btn of document.querySelectorAll('[data-free]')) btn.addEventListener('click', () => startFreePlay(btn.dataset.free));
  $('btn-free-back').addEventListener('click', backToMain);
  $('btn-landing-stats').addEventListener('click', () => openStatsModal('standard'));
  $('btn-landing-dark').addEventListener('click', () => setDark(!isDark()));

  // 지난 퍼즐
  $('btn-archive').addEventListener('click', () => {
    landingMain.hidden = true;
    landingArchive.hidden = false;
    landingCard.classList.add('landing-card--archive');
    archiveSelected = null;
    archiveMode = 'standard';
    $('btn-archive-play').disabled = true;
    $('archive-error').textContent = TODAY() <= DAILY_FIRST_DATE ? '아직 지난 퍼즐이 없어요 — 내일부터 열려요.' : '';
    paintArchiveCal(true);
  });
  document.querySelectorAll('.archive-type').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === archiveMode) return;
    archiveMode = b.dataset.mode;
    paintArchiveCal(false);
  }));
  $('btn-archive-back').addEventListener('click', backToMain);
  $('btn-archive-play').addEventListener('click', () => {
    if (archiveSelected) startArchive(archiveMode, archiveSelected);
  });

  // 결과 모달
  $('btn-daily-result-close').addEventListener('click', () => closePanel($('daily-result-modal')));
  $('btn-daily-result-stats').addEventListener('click', () => { closePanel($('daily-result-modal')); openStatsModal(); });
  $('btn-daily-result-share').addEventListener('click', async () => {
    const ok = await copyText(buildShareText({ title: sessionTitle(), result: targetResult() }));
    $('daily-share-note').textContent = ok ? '클립보드에 복사했어요!' : '복사에 실패했어요.';
  });

  // 통계 모달
  $('daily-stats-close').addEventListener('click', closeStatsModal);
  document.querySelectorAll('.daily-stats-tab').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === statsMode) return;
    statsMode = b.dataset.mode;
    renderStats();
  }));
  $('btn-cal-share').addEventListener('click', async () => {
    const { y, m } = statsCal.monthYM();
    const mode = modeOf(statsMode);
    const text = buildCalendarShareText({ results: summarize(TODAY(), mode.id).results, year: y, month: m, label: mode.label });
    $('cal-share-note').textContent = (await copyText(text)) ? '복사했어요!' : '복사 실패';
  });
  $('btn-daily-stats-share').addEventListener('click', async () => {
    const mode = modeOf(statsMode);
    const p = loadProgress(TODAY(), mode.id);
    if (!p || p.status === 'playing') { $('daily-stats-share-note').textContent = '오늘 퍼즐을 먼저 풀어주세요.'; return; }
    const result = { won: p.status === 'solved', total: p.total, hit: p.hit, seconds: Math.round(p.elapsed / 1000), lives: p.lives };
    const title = [GAME_TITLE, mode.label, TODAY()].join(' · ');
    $('daily-stats-share-note').textContent = (await copyText(buildShareText({ title, result }))) ? '복사했어요!' : '복사 실패';
  });

  // 도움말
  $('game-help-close').addEventListener('click', () => closePanel($('game-help-modal')));
  for (const el of document.querySelectorAll('[data-inverter-icon]')) el.innerHTML = INVERTER_SVG;

  // 모달 바깥(어두운 막)을 누르면 닫기
  for (const id of ['daily-result-modal', 'game-help-modal']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id) closePanel($(id)); });
  }
  $('daily-stats-modal').addEventListener('click', (e) => { if (e.target.id === 'daily-stats-modal') closeStatsModal(); });

  // 키보드: 1·2·3 입력 모드, 방향키 커서, Enter·Space·Q·W·E 칸 단축키, Shift 거울 미리보기, Esc 닫기
  // 글자 키는 e.code로 본다 — 한글 입력 상태에서도 같은 자리 키로 동작하게
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const id of ['daily-result-modal', 'game-help-modal']) closePanel($(id));
      closeStatsModal();
      setPending(-1);
      hideCursor();
      return;
    }
    if (gameScreen.classList.contains('hidden') || palette.isOpen() || document.querySelector('.modal-overlay.show')) return;
    if (e.key === 'Shift') {
      setShift(true);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const mode = { Digit1: 'open', Digit2: 'mark', Digit3: 'laser', Numpad1: 'open', Numpad2: 'mark', Numpad3: 'laser' }[e.code];
    if (mode) {
      setInputMode(mode);
      return;
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (step) {
      e.preventDefault();
      moveCursor(...step);
      return;
    }
    const t = pointedIdx();
    if (t < 0 || !session) return;
    const handle = {
      Enter: () => act(t),
      NumpadEnter: () => act(t),
      Space: () => toggleMirror(t),
      KeyQ: () => markShortcut(t, 'mine-black'),
      KeyW: () => markShortcut(t, 'mine-white'),
      KeyE: () => markShortcut(t, null),
    }[e.code];
    if (!handle || session.finished || ui.answer) return;
    e.preventDefault();
    // 마지막으로 누른 버튼(입력 모드 등)에 포커스가 남아 있으면 Space·Enter가 그 버튼도 누르므로 놓는다
    if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    handle();
  });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') setShift(false); });
  window.addEventListener('blur', () => setShift(false));

  // 탭을 떠나 있는 동안은 시간을 세지 않는다
  document.addEventListener('visibilitychange', () => {
    if (!session || gameScreen.classList.contains('hidden')) return;
    if (document.hidden) { pauseTimer(); persist(); } else startTimer();
  });
  window.addEventListener('pagehide', () => { pauseTimer(); persist(); });
}

init();
setDark(isDark());
showLanding();

// ── 허브 연결: ?open=버튼 · ?archive=날짜&mode= · ?free=모드 ──
initHub('bwsweeper', {
  playArchive: (date, mode) => {
    if (modeOf(mode).id !== mode || date < DAILY_FIRST_DATE || date >= TODAY()) return;
    startArchive(mode, date);
  },
  playFree: (mode) => {
    if (modeOf(mode).id === mode) startFreePlay(mode);
  },
});
// 처음 방문이면 게임 방법부터
try {
  if (!localStorage.getItem(SEEN_HELP_KEY)) {
    openHelpModal();
    localStorage.setItem(SEEN_HELP_KEY, '1');
  }
} catch { /* 무시 */ }
