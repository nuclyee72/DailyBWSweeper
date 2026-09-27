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
} from './core/board.js';
import {
  buildBoardDom,
  renderAll,
  renderCell,
  drawLasers,
  drawPreview,
  clearPreview,
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
const ui = { inputMode: 'open', hoverIdx: -1, generating: false };
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
  setInputMode('open');
  $('ds-mode-label').textContent = `${modeOf(modeId).label} · ${whereLabel(session)}`;
  $('btn-new-free').hidden = kind !== 'free';
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
  closePanel($('freeplay-mode-modal'));
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
  if (session.kind === 'daily') {
    const { won, seconds } = targetResult();
    recordResult(session.date, won ? 'solved' : 'failed', seconds, session.modeId);
  }
  persist();
  setTimeout(showResultModal, lostBy ? 450 : 350);
}

// ── 입력 ──
function setInputMode(mode) {
  ui.inputMode = mode;
  for (const btn of document.querySelectorAll('[data-input-mode]')) {
    const on = btn.dataset.inputMode === mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  for (const m of ['open', 'mark', 'laser']) gameScreen.classList.toggle(`mode-${m}`, m === mode);
  updatePreview();
}

function onCellClick(i) {
  if (!session || session.finished || ui.generating) return;
  const { board } = session;
  const cell = board.cells[i];

  if (ui.inputMode === 'laser') {
    if (!cell.revealed || !toggleActive(board, i)) return;
    // 이 거울 때문에 레이저가 터지면: 라이프가 남아 있으면 되돌리고, 레이저가 닿은 칸을 알려 준다
    const boom = board.emitters.map((em) => traceLaser(board, em)).find((t) => BOOM_ENDS.has(t.end));
    if (boom && session.lives > 1) {
      cell.active = !cell.active;
      loseLife(boom.cellIdx, boom.end === 'wrong' ? 'wrongTarget' : 'laser', boom.emitter.color);
      return;
    }
    if (boom) session.lives = 0;
    refresh();
    persist();
    return;
  }
  if (cell.revealed) return;
  if (ui.inputMode === 'mark') {
    openPalette(i);
    return;
  }
  if (cell.mark) return; // 지뢰 표시가 달린 칸은 열지 않는다 (표시 먼저 삭제)

  // 지뢰를 열면: 라이프가 남아 있으면 열지 않은 것으로 하고, 그 칸이 무슨 색 지뢰인지 알려 준다
  if (cell.isMine && session.lives > 1) {
    loseLife(i, 'mine');
    return;
  }
  if (cell.isMine) session.lives = 0;

  const { exploded } = revealCell(board, i);
  if (exploded) {
    revealAllOnLoss(board);
    session.explodedIdx = i;
    const { traces } = computeLasers(board);
    session.traces = traces;
    renderAll(session.cellEls, board);
    renderExploded();
    drawLasers(laserSvg, board, traces);
    updateHud();
    finish('mine');
    return;
  }
  refresh();
  persist();
}

/**
 * 실수 — 라이프 1개를 잃고 행동은 없던 일로. 그 행동으로 알 수 있었던 정보는 남긴다:
 *   지뢰를 열었거나 레이저가 지뢰에 닿았으면 그 칸을 "알아낸 지뢰"로 드러내고,
 *   레이저가 반대 색 특수 칸에 닿았으면 그 특수 칸을 연다.
 */
function loseLife(cellIdx, kind, laserColor = null) {
  const { board } = session;
  const cell = board.cells[cellIdx];
  session.lives -= 1;
  cell.revealed = true;
  cell.mark = null;
  if (cell.isMine) cell.known = true;
  refresh();
  const el = session.cellEls[cellIdx];
  el.classList.remove('is-life-lost');
  void el.offsetWidth; // 애니메이션 다시 시작
  el.classList.add('is-life-lost');

  const colorName = (c) => (c === 'black' ? '검' : '흰');
  const what = {
    mine: `${colorName(cell.mineColor)} 지뢰였어요`,
    laser: `${colorName(laserColor)} 레이저가 ${colorName(cell.mineColor)} 지뢰에 닿았어요 — 거울을 되돌렸어요`,
    wrongTarget: `${colorName(laserColor)} 레이저가 ${colorName(cell.special)} 특수 칸에 닿았어요 — 거울을 되돌렸어요`,
  }[kind];
  showToast(`💔 라이프 -1 · ${what}`);
  persist();
}

let toastTimer = 0;
function showToast(text) {
  const t = $('life-toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function openPalette(i) {
  if (!session || session.finished || session.board.cells[i].revealed) return;
  palette.open(session.cellEls[i], i, session.board.cells[i].mark, zoom.scale);
  updatePreview(); // 팔레트가 떠 있는 동안엔 미리보기를 숨긴다
}

function onMarkPicked(i, mark) {
  if (!setMark(session.board, i, mark)) return;
  renderCell(session.cellEls[i], session.board.cells[i]);
  persist();
  updatePreview();
}

/** 거울 모드에서 마우스가 올라간 칸의 거울을 켜고 끄면 레이저가 어떻게 꺾일지 미리 보여준다 */
function updatePreview() {
  const i = ui.hoverIdx;
  if (!session || ui.inputMode !== 'laser' || i < 0 || !canToggle(session.board, i) || palette.isOpen()) {
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
}

// ── 결과 모달 ──
const LOST_REASON = {
  mine: '라이프를 모두 잃었어요 — 마지막에 지뢰를 밟았어요.',
  laser: '라이프를 모두 잃었어요 — 마지막에 같은 색 레이저가 지뢰에 닿았어요.',
  wrongTarget: '라이프를 모두 잃었어요 — 마지막에 레이저가 반대 색 특수 칸에 닿았어요.',
};

function showResultModal() {
  if (!session?.finished) return;
  const mode = modeOf(session.modeId);
  const result = targetResult();
  $('daily-result-title').textContent = result.won ? '🎯 클리어!' : '💥 게임 오버';
  const note = session.kind === 'daily' ? '' : ' (기록에는 반영되지 않아요)';
  const reason = result.won ? '' : `\n${LOST_REASON[session.lostBy] ?? ''}`;
  $('daily-result-detail').textContent = `${mode.label} · ${whereLabel(session)}\n${buildSummaryLine(result)}${note}${reason}`;
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
  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('.ds-cell');
    if (cell) onCellClick(Number(cell.dataset.idx));
  });
  grid.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ds-cell');
    if (!cell) return;
    e.preventDefault();
    openPalette(Number(cell.dataset.idx));
  });
  // 거울 미리보기는 마우스에서만 (터치는 탭 뒤에 hover가 남아 헷갈린다)
  grid.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const cell = e.target.closest('.ds-cell');
    setHover(cell ? Number(cell.dataset.idx) : -1);
  });
  grid.addEventListener('pointerleave', () => setHover(-1));

  palette = createMarkPalette(document.querySelector('.board-stage'), onMarkPicked);
  // 터치: 두 손가락 확대, 한 손가락 이동. 확대돼 있으면 '맞춤' 버튼
  zoom = createZoomPan(document.querySelector('.board-area'), document.querySelector('.board-stage'), {
    onChange: (scale) => {
      $('btn-fit').classList.toggle('show', scale > 1);
      document.querySelector('.board-area').classList.toggle('is-zoomed', scale > 1);
    },
  });
  $('btn-fit').addEventListener('click', () => zoom.reset());

  // 레이저 좌표는 실제 칸 크기에 맞춰 계산하므로 창 크기가 바뀌면 다시 그린다
  window.addEventListener('resize', () => {
    if (!session) return;
    drawLasers(laserSvg, session.board, session.traces);
    updatePreview();
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

  // 랜딩
  for (const btn of document.querySelectorAll('[data-daily]')) btn.addEventListener('click', () => startDaily(btn.dataset.daily));
  $('btn-free-play').addEventListener('click', () => openPanel($('freeplay-mode-modal')));
  for (const btn of document.querySelectorAll('[data-free]')) btn.addEventListener('click', () => startFreePlay(btn.dataset.free));
  $('freeplay-close').addEventListener('click', () => closePanel($('freeplay-mode-modal')));
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
  for (const id of ['daily-result-modal', 'game-help-modal', 'freeplay-mode-modal']) {
    $(id).addEventListener('click', (e) => { if (e.target.id === id) closePanel($(id)); });
  }
  $('daily-stats-modal').addEventListener('click', (e) => { if (e.target.id === 'daily-stats-modal') closeStatsModal(); });

  // 키보드: 1·2·3 입력 모드, Esc 모달 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const id of ['daily-result-modal', 'game-help-modal', 'freeplay-mode-modal']) closePanel($(id));
      closeStatsModal();
      return;
    }
    if (gameScreen.classList.contains('hidden') || palette.isOpen() || document.querySelector('.modal-overlay.show')) return;
    const mode = { 1: 'open', 2: 'mark', 3: 'laser' }[e.key];
    if (mode) setInputMode(mode);
  });

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
