/**
 * renderer.js — 판(div 격자) + 레이저 레이어(SVG).
 * 칸 구조: <button.ds-cell.o{0-3}> [검 숫자] [흰 숫자] [아이콘]
 *   o0~o3 = 검 삼각형이 붙은 모서리 (왼쪽 위 / 오른쪽 위 / 오른쪽 아래 / 왼쪽 아래)
 * SVG는 칸 1개 = 1 단위 좌표계 (fitViewBox가 칸 사이 틈까지 맞춘다),
 * 판 밖으로 나가는 발사기·끝점은 overflow로 보인다.
 */
import { isSlash, isBlank } from '../core/board.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function buildBoardDom(container, board) {
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${board.cols}, 1fr)`;

  const cellEls = new Array(board.cells.length);
  for (let i = 0; i < board.cells.length; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ds-cell';
    btn.dataset.idx = String(i);
    btn.tabIndex = -1; // 키보드는 방향키 커서로 다룬다 (Tab으로 칸 256개를 지나가지 않게)

    const nBlack = document.createElement('span');
    nBlack.className = 'ds-n ds-n-black';
    const nWhite = document.createElement('span');
    nWhite.className = 'ds-n ds-n-white';
    const icon = document.createElement('span');
    icon.className = 'ds-icon';

    btn.append(nBlack, nWhite, icon);
    container.appendChild(btn);
    cellEls[i] = btn;
  }
  return cellEls;
}

/**
 * 색 반전기 아이콘: X에서 네 끄트머리만 남긴 모양 + 가운데 반은 검·반은 흰 동그라미.
 * (가로·세로 어느 쪽으로 지나가든 색이 바뀐다는 뜻)
 */
export const INVERTER_SVG = `<svg class="inv-icon" viewBox="0 0 100 100" aria-hidden="true">
  <path class="inv-tips" d="M10 10 L28 28 M90 10 L72 28 M10 90 L28 72 M90 90 L72 72"/>
  <circle class="inv-core-w" cx="50" cy="50" r="16"/>
  <path class="inv-core-b" d="M50 34 A16 16 0 0 0 50 66 Z"/>
  <circle class="inv-core-ring" cx="50" cy="50" r="16"/>
</svg>`;

/** 표시별 글자 — 색은 CSS(.mark-black / .mark-white)의 동그라미 배지 */
export const MARK_GLYPH = {
  'mine-black': '⚑',
  'mine-white': '⚑',
};

export function renderCell(el, cell) {
  const revealed = cell.revealed;
  const mineShown = revealed && cell.isMine;
  const specialShown = revealed && !!cell.special;
  const blank = revealed && isBlank(cell);
  const inverterShown = blank && cell.inverter;
  const split = revealed && !cell.isMine && !cell.special && !blank;

  // 방향은 첫 클릭 때 다시 뽑힐 수 있으므로 매번 맞춘다
  for (let k = 0; k < 4; k++) el.classList.toggle(`o${k}`, k === cell.blackCorner);
  el.classList.toggle('is-revealed', revealed);
  const markShown = !revealed && cell.mark;
  el.classList.toggle('is-marked', !!markShown);
  el.classList.toggle('mark-black', !!markShown && cell.mark.endsWith('black'));
  el.classList.toggle('mark-white', !!markShown && cell.mark.endsWith('white'));
  el.classList.toggle('is-blank', blank);
  el.classList.toggle('is-split', split);
  el.classList.toggle('is-inverter', inverterShown);
  el.classList.toggle('is-active', (split || inverterShown) && cell.active);
  el.classList.toggle('is-mine', mineShown);
  el.classList.toggle('is-known', mineShown && !!cell.known);
  el.classList.toggle('is-mine-black', mineShown && cell.mineColor === 'black');
  el.classList.toggle('is-mine-white', mineShown && cell.mineColor === 'white');
  el.classList.toggle('is-special', specialShown);
  el.classList.toggle('is-special-black', specialShown && cell.special === 'black');
  el.classList.toggle('is-special-white', specialShown && cell.special === 'white');
  el.classList.toggle('is-lit', specialShown && cell.lit);
  el.classList.toggle('is-wrong-mark', cell.wrongMark);

  const [nBlack, nWhite, icon] = el.children;
  nBlack.textContent = split && cell.countBlack > 0 ? String(cell.countBlack) : '';
  nWhite.textContent = split && cell.countWhite > 0 ? String(cell.countWhite) : '';

  if (inverterShown) {
    if (!icon.querySelector('.inv-icon')) icon.innerHTML = INVERTER_SVG;
    return;
  }
  let iconText = '';
  if (mineShown) iconText = '✖';
  else if (specialShown) iconText = cell.lit ? '✦' : '◎';
  else if (cell.wrongMark) iconText = '✕';
  else if (markShown) iconText = MARK_GLYPH[cell.mark];
  if (icon.textContent !== iconText || icon.firstElementChild) icon.textContent = iconText;
}

export function renderAll(cellEls, board) {
  for (let i = 0; i < board.cells.length; i++) renderCell(cellEls[i], board.cells[i]);
}

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * 레이저 좌표계를 실제 칸 배치에 맞춘다.
 * 레이저 좌표는 "칸 1개 = 1"이지만 칸 사이에 틈(gap)이 있으므로, 칸 간격(pitch = 칸 + 틈) 단위로 두고
 * 틈 절반만큼 밀어서 칸 중심이 정확히 x + 0.5에 오게 한다: px = u × pitch − gap/2
 */
function fitViewBox(svg, board) {
  const grid = svg.parentElement.querySelector('.board-grid');
  const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
  // 화면 확대(transform)와 무관한 레이아웃 크기 — 판 테두리 안쪽 폭 = 레이저 레이어 폭
  const w = grid.clientWidth;
  const pitch = (w + gap) / board.cols;
  if (!(pitch > 0)) {
    svg.setAttribute('viewBox', `0 0 ${board.cols} ${board.rows}`);
    return;
  }
  const off = gap / 2 / pitch;
  svg.setAttribute('viewBox', `${off} ${off} ${board.cols - gap / pitch} ${board.rows - gap / pitch}`);
}

function mirrorLine(board, i, cls) {
  const inset = 0.14;
  const x = i % board.cols;
  const y = Math.floor(i / board.cols);
  const [x1, y1, x2, y2] = isSlash(board.cells[i].blackCorner)
    ? [x + inset, y + 1 - inset, x + 1 - inset, y + inset]
    : [x + inset, y + inset, x + 1 - inset, y + 1 - inset];
  return svgEl('line', { x1, y1, x2, y2, class: cls, 'data-cell': i });
}

/** 레이저 한 줄기. 색 반전기에서 색이 바뀌므로 색이 같은 구간마다 따로 그린다. */
function laserGroup(board, t, k, extraClass = '') {
  // 연 특수 칸에 명중했을 때만 흐르는 효과 — 안 연 칸 명중은 겉으로 드러내지 않는다
  const litShown = t.hits.some((h) => board.cells[h].revealed);
  const g = svgEl('g', {
    class: `laser laser-end-${t.end}${litShown ? ' laser-lit' : ''}${extraClass}`,
    'data-em': k,
  });
  for (const seg of t.segments) {
    const sg = svgEl('g', { class: `laser-${seg.color}` });
    const pts = seg.points.map(([px, py]) => `${px},${py}`).join(' ');
    sg.appendChild(svgEl('polyline', { points: pts, class: 'laser-halo' }));
    sg.appendChild(svgEl('polyline', { points: pts, class: 'laser-core' }));
    g.appendChild(sg);
  }
  return g;
}

/** 거울(활성 칸의 대각선)과 레이저 경로를 다시 그린다. 미리보기는 지운다. */
export function drawLasers(svg, board, traces) {
  svg.innerHTML = '';
  fitViewBox(svg, board);

  const main = svgEl('g', { class: 'lasers-main' });
  board.cells.forEach((cell, i) => {
    // 반전기는 꺾지 않으므로 대각선을 그리지 않는다 (칸 자체가 초록 테두리로 켜짐을 보여준다)
    if (cell.active && cell.revealed && !cell.inverter) main.appendChild(mirrorLine(board, i, 'mirror'));
  });
  traces.forEach((t, k) => {
    const g = laserGroup(board, t, k);
    const [sx, sy] = t.points[0];
    const emitterDot = svgEl('g', { class: `laser-${t.emitter.color}` });
    emitterDot.appendChild(svgEl('circle', { cx: sx, cy: sy, r: 0.2, class: 'laser-emitter' }));
    g.appendChild(emitterDot);
    const [ex, ey] = t.points[t.points.length - 1];
    if (t.end === 'mine' || t.end === 'wrong') {
      g.appendChild(svgEl('circle', { cx: ex, cy: ey, r: 0.34, class: 'laser-boom' }));
    }
    main.appendChild(g);
  });
  svg.appendChild(main);
  svg.appendChild(svgEl('g', { class: 'lasers-preview' }));
}

/**
 * 칸 cellIdx의 거울을 켜고 끄면 어떻게 되는지 미리 보여준다.
 * 바뀌는 레이저는 지금 경로를 흐리게, 바뀐 경로를 점선으로. 켜질 거울은 점선, 꺼질 거울은 흐리게.
 * now/next는 보이는 정보와 내 지뢰 표시만으로 계산한 경로 (board.previewToggle) — 숨은 지뢰는 드러나지 않는다.
 */
export function drawPreview(svg, board, cellIdx, now, next) {
  clearPreview(svg);
  const layer = svg.querySelector('.lasers-preview');
  if (!layer) return;
  const cell = board.cells[cellIdx];
  if (cell.inverter) {
    // 반전기: 켜질 때만 점선 고리로 표시
    if (!cell.active) {
      const x = cellIdx % board.cols;
      const y = Math.floor(cellIdx / board.cols);
      layer.appendChild(svgEl('circle', { cx: x + 0.5, cy: y + 0.5, r: 0.36, class: 'inverter-preview' }));
    }
  } else if (!cell.active) {
    layer.appendChild(mirrorLine(board, cellIdx, 'mirror mirror-preview'));
  } else {
    svg.querySelector(`.lasers-main .mirror[data-cell="${cellIdx}"]`)?.classList.add('is-dimmed');
  }

  next.forEach((t, k) => {
    if (JSON.stringify(t.segments) === JSON.stringify(now[k].segments)) return;
    svg.querySelector(`.lasers-main .laser[data-em="${k}"]`)?.classList.add('is-dimmed');
    const g = laserGroup(board, t, k, ' laser-preview');
    if (t.end === 'mine' || t.end === 'wrong') {
      const [ex, ey] = t.points[t.points.length - 1];
      g.appendChild(svgEl('circle', { cx: ex, cy: ey, r: 0.34, class: 'laser-boom' }));
    }
    layer.appendChild(g);
  });
}

/** 레이저 강조: emitterIdxs 번째 레이저만 노랗게 (나머지는 원래대로) */
export function highlightLasers(svg, emitterIdxs) {
  const on = new Set(emitterIdxs.map(String));
  for (const g of svg.querySelectorAll('.lasers-main .laser')) g.classList.toggle('is-hl', on.has(g.dataset.em));
}

export function clearPreview(svg) {
  svg.querySelector('.lasers-preview')?.replaceChildren();
  svg.querySelectorAll('.lasers-main .is-dimmed').forEach((el) => el.classList.remove('is-dimmed'));
}
