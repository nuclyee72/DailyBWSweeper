/**
 * markPalette.js — 칸 표시 팔레트.
 * 칸을 둘러싼 잘린 도넛(150°)을 세 조각으로 나눠 검 지뢰 · 흰 지뢰 · 삭제 를 고른다.
 * - 화면 좌표(position: fixed)에 그린다 — 판을 확대해도 잘리지 않고 크기가 일정하다.
 * - 펼치는 방향은 화면 안에 다 들어오는 쪽으로 고른다 (기본: 마우스는 오른쪽, 터치는 손가락에 안 가리는 위쪽).
 * - 누른 채 조각까지 끌어서 놓으면 바로 고른다 (터치 길게 누르기 · 우클릭 끌기). 조각 밖에서 놓으면 열린 채로 남는다.
 * 바깥(투명 막)을 누르거나 Esc를 누르면 닫힌다. 열려 있는 동안 1~3 키로도 고를 수 있다.
 */
import { MARK_GLYPH } from './renderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 펼치는 순서 (검 지뢰가 위쪽에 오도록 — directionOf 참고) */
const OPTIONS = [
  { mark: 'mine-black', label: '검 지뢰' },
  { mark: 'mine-white', label: '흰 지뢰' },
  { mark: null, label: '삭제' },
];

const SPAN_DEG = 150;
const STEP_DEG = SPAN_DEG / OPTIONS.length;
const GAP_DEG = 2;
const EDGE = 6; // 화면 가장자리 여유 (px)
const DRAG_SLOP = 6;

/** 도넛 가운데 방향 후보 (화면 좌표: 0° = 3시, 시계 방향이 +). 앞에 있을수록 먼저 고른다. */
const MID_MOUSE = [-15, 195, -90, 90, -45, 225, 45, 135];
const MID_TOUCH = [-90, -45, 225, -15, 195, 45, 135, 90];

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** 도넛 조각 경로 (a0 → a1 시계 방향): 바깥 호 → 안쪽 호 */
function sectorPath(c, rIn, rOut, a0, a1) {
  const [x0, y0] = polar(c, c, rOut, a0);
  const [x1, y1] = polar(c, c, rOut, a1);
  const [x2, y2] = polar(c, c, rIn, a1);
  const [x3, y3] = polar(c, c, rIn, a0);
  return `M${x0},${y0} A${rOut},${rOut} 0 0 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 0 0 ${x3},${y3} Z`;
}

/**
 * 가운데 방향 mid의 조각별 [시작각, 끝각]. 왼쪽으로 펼칠 땐 반시계로 놓아
 * 어느 쪽이든 검 지뢰가 위(12시 쪽)부터 온다.
 */
function sectorsFor(mid) {
  const leftward = Math.cos((mid * Math.PI) / 180) < -0.01;
  return OPTIONS.map((_, k) => {
    const a0 = leftward ? mid + SPAN_DEG / 2 - (k + 1) * STEP_DEG : mid - SPAN_DEG / 2 + k * STEP_DEG;
    return [a0 + GAP_DEG / 2, a0 + STEP_DEG - GAP_DEG / 2];
  });
}

/** 칸 가운데 (cx, cy)에서 mid 방향으로 펼쳤을 때 화면 밖으로 나가는 넓이 (0이면 다 들어온다) */
function overflowOf(mid, cx, cy, rIn, rOut) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let a = mid - SPAN_DEG / 2; a <= mid + SPAN_DEG / 2 + 0.01; a += SPAN_DEG / 10) {
    for (const r of [rIn, rOut]) {
      const [x, y] = polar(cx, cy, r, a);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  const W = window.innerWidth;
  const H = window.innerHeight;
  return Math.max(0, EDGE - x0) + Math.max(0, x1 - (W - EDGE)) + Math.max(0, EDGE - y0) + Math.max(0, y1 - (H - EDGE));
}

/**
 * @param layerEl 팔레트·투명 막을 넣을 곳 (게임 화면)
 * @param onPick (cellIdx, mark|null) => void
 */
export function createMarkPalette(layerEl, onPick) {
  const backdrop = document.createElement('div');
  backdrop.className = 'mark-backdrop';
  backdrop.hidden = true;
  layerEl.appendChild(backdrop);

  const svg = svgEl('svg', { class: 'mark-palette', role: 'menu', 'aria-label': '칸 표시' });
  svg.style.display = 'none';
  layerEl.appendChild(svg);

  let openIdx = -1;
  let optionEls = [];
  /** 누른 채 끌어서 고르는 중: { id, x0, y0, moved, hover } */
  let drag = null;
  /** 끌기를 끝낸 pointerup — 같은 이벤트가 조각·투명 막에 또 닿아도 무시한다 */
  let handledUp = null;
  /**
   * 터치는 손을 뗀(pointerup) 뒤에 브라우저가 click을 따로 보낸다. 그 click이 팔레트·투명 막을 걷은 자리의
   * 칸에 떨어져 칸이 열리거나, 길게 누르고 뗀 뒤 투명 막에 떨어져 팔레트가 닫히지 않게 한 번 삼킨다.
   * 다음 손짓(pointerdown)이 먼저 오면 풀린다 — 곧바로 다른 칸을 눌러도 막히지 않게.
   */
  let swallowUntil = 0;
  const swallowTrailingClick = (e) => {
    if (e && e.pointerType && e.pointerType !== 'mouse') swallowUntil = performance.now() + 800;
  };
  document.addEventListener('pointerdown', () => { swallowUntil = 0; }, true);
  document.addEventListener('click', (e) => {
    if (performance.now() >= swallowUntil) return;
    swallowUntil = 0;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  /** 닫는다 (e: 닫게 한 pointer 이벤트 — 터치면 뒤따르는 click을 삼킨다) */
  function close(e = null) {
    drag = null;
    if (openIdx < 0) return;
    openIdx = -1;
    svg.classList.remove('is-open');
    svg.style.display = 'none';
    backdrop.hidden = true;
    swallowTrailingClick(e);
  }

  /** 주 버튼(왼쪽 클릭·터치)을 뗄 때만 — 맥에선 우클릭 메뉴가 누를 때 떠서, 떼는 순간 바로 닫히면 안 된다 */
  const isPrimaryRelease = (e) => e.button === 0;

  function pick(k, e = null) {
    const idx = openIdx;
    close(e);
    if (idx >= 0) onPick(idx, OPTIONS[k].mark);
  }

  /** 화면 좌표 아래의 조각 번호 (없으면 -1) */
  function optionAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest?.('.mark-option');
    return el ? optionEls.indexOf(el) : -1;
  }

  function setDragHover(k) {
    optionEls.forEach((g, j) => g.classList.toggle('is-hover', j === k));
  }

  /**
   * cellEl 둘레에 팔레트를 연다. currentMark 조각은 강조한다.
   * touch: 손가락용 — 조각을 두껍게, 손가락에 가리지 않는 위쪽부터 펼친다.
   */
  function open(cellEl, cellIdx, currentMark, { touch = false } = {}) {
    const rect = cellEl.getBoundingClientRect(); // 확대까지 반영된 화면 위치·크기
    const s = rect.width;
    const cx = rect.left + s / 2;
    const cy = rect.top + rect.height / 2;
    const rIn = Math.max(s * 0.75, touch ? 30 : 26);
    const rOut = rIn + Math.max(s * 0.8, touch ? 50 : 40);
    const pad = 4;
    const c = rOut + pad;
    const size = c * 2;

    // 화면 안에 다 들어오는 첫 방향, 없으면 가장 덜 넘치는 방향
    let mid = null;
    let best = Infinity;
    for (const m of touch ? MID_TOUCH : MID_MOUSE) {
      const over = overflowOf(m, cx, cy, rIn, rOut);
      if (over < 0.5) { mid = m; break; }
      if (over < best) { best = over; mid = m; }
    }

    svg.innerHTML = '';
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    svg.style.left = `${cx - c}px`;
    svg.style.top = `${cy - c}px`;
    svg.style.transformOrigin = `${c}px ${c}px`;

    optionEls = sectorsFor(mid).map(([a0, a1], k) => {
      const opt = OPTIONS[k];
      const current = opt.mark === currentMark || (opt.mark === null && !currentMark);
      const tone = opt.mark ? (opt.mark.endsWith('black') ? 'black' : 'white') : null;
      const g = svgEl('g', {
        class: `mark-option${tone ? ` mark-option-${tone}` : ''}${current ? ' is-current' : ''}`,
        role: 'menuitem',
        'aria-label': opt.label,
      });
      const title = svgEl('title');
      title.textContent = `${opt.label} (${k + 1})`;
      g.appendChild(title);
      g.appendChild(svgEl('path', { d: sectorPath(c, rIn, rOut, a0, a1), class: 'mark-sector' }));

      const [tx, ty] = polar(c, c, (rIn + rOut) / 2, (a0 + a1) / 2);
      const glyph = svgEl('text', {
        x: tx,
        y: ty,
        class: `mark-glyph ${tone ? `mark-glyph-${tone}` : 'mark-glyph-delete'}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': Math.max(15, Math.min(24, (rOut - rIn) * 0.42)),
      });
      glyph.textContent = opt.mark ? MARK_GLYPH[opt.mark] : '✕';
      g.appendChild(glyph);

      // 터치에서는 click이 가끔 안 따라오므로 손을 뗄 때 고른다
      g.addEventListener('pointerup', (e) => {
        if (e === handledUp || !isPrimaryRelease(e)) return;
        e.stopPropagation();
        pick(k, e);
      });
      g.addEventListener('click', (e) => e.stopPropagation());
      svg.appendChild(g);
      return g;
    });

    openIdx = cellIdx;
    backdrop.hidden = false;
    svg.style.display = '';
    // 다음 프레임에 열림 애니메이션
    requestAnimationFrame(() => svg.classList.add('is-open'));
  }

  /** 지금 누르고 있는 손가락·버튼을 떼는 곳의 조각을 고른다 (팔레트를 연 직후에 부른다) */
  function beginDrag(e) {
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, hover: -1 };
  }

  // 끌기 추적은 document capture 단계 — 터치는 누른 칸에 붙잡혀(implicit capture) 이벤트가 칸으로 가기 때문
  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > DRAG_SLOP) drag.moved = true;
    const k = optionAt(e.clientX, e.clientY);
    if (k !== drag.hover) {
      drag.hover = k;
      setDragHover(k);
      if (k >= 0) navigator.vibrate?.(6);
    }
  }, true);
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = e.type === 'pointerup' ? optionAt(e.clientX, e.clientY) : -1;
    drag = null;
    setDragHover(-1);
    handledUp = e; // 조각 밖에서 놓았으면 열린 채로 둔다 (투명 막이 이 이벤트로 닫지 않게)
    swallowTrailingClick(e);
    if (k >= 0) pick(k, e);
  };
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', endDrag, true);

  // 바깥을 누르면 닫기만 한다 (뒤의 칸이 눌리지 않도록 투명 막이 받는다)
  backdrop.addEventListener('pointerup', (e) => {
    if (e !== handledUp && isPrimaryRelease(e)) close(e);
  });
  backdrop.addEventListener('click', () => close());
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());
  svg.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (openIdx < 0) return;
    // 같은 document의 다른 키 처리(입력 모드 1·2·3 등)까지 가지 않게
    if (e.key === 'Escape') {
      close();
      e.stopImmediatePropagation();
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= OPTIONS.length) {
      pick(Number(e.key) - 1);
      e.stopImmediatePropagation();
    }
  });

  return { open, close, beginDrag, isOpen: () => openIdx >= 0 };
}
