/**
 * markPalette.js — 칸 표시 팔레트.
 * 칸을 둘러싼 잘린 도넛(12시 → 5시, 시계 방향)을 세 조각으로 나눠 검 지뢰 · 흰 지뢰 · 삭제 를 고른다.
 * 바깥(투명 막)을 누르거나 Esc를 누르면 닫힌다. 열려 있는 동안 1~3 키로도 고를 수 있다.
 */
import { MARK_GLYPH } from './renderer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 12시부터 시계 방향 순서 */
const OPTIONS = [
  { mark: 'mine-black', label: '검 지뢰' },
  { mark: 'mine-white', label: '흰 지뢰' },
  { mark: null, label: '삭제' },
];

const START_DEG = -90; // 12시 (화면 좌표: 0° = 3시, 시계 방향이 +)
const STEP_DEG = 150 / OPTIONS.length; // 12시 → 5시 = 150°를 조각 수로 나눔
const GAP_DEG = 2;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function polar(c, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [c + r * Math.cos(a), c + r * Math.sin(a)];
}

/** 도넛 조각 경로: 바깥 호(시계 방향) → 안쪽 호(반시계 방향) */
function sectorPath(c, rIn, rOut, a0, a1) {
  const [x0, y0] = polar(c, rOut, a0);
  const [x1, y1] = polar(c, rOut, a1);
  const [x2, y2] = polar(c, rIn, a1);
  const [x3, y3] = polar(c, rIn, a0);
  return `M${x0},${y0} A${rOut},${rOut} 0 0 1 ${x1},${y1} L${x2},${y2} A${rIn},${rIn} 0 0 0 ${x3},${y3} Z`;
}

/**
 * @param stageEl 판과 레이저 레이어를 담은 .board-stage (position: relative)
 * @param onPick (cellIdx, mark|null) => void
 */
export function createMarkPalette(stageEl, onPick) {
  // 막은 팔레트와 같은 쌓임 맥락(게임 화면)에 둬야 팔레트가 막 위에 올라온다
  const backdrop = document.createElement('div');
  backdrop.className = 'mark-backdrop';
  backdrop.hidden = true;
  stageEl.appendChild(backdrop);

  const svg = svgEl('svg', { class: 'mark-palette', role: 'menu', 'aria-label': '칸 표시' });
  svg.style.display = 'none';
  stageEl.appendChild(svg);

  let openIdx = -1;
  let lingerTimer = 0;

  /**
   * 닫는다. 투명 막은 잠깐 더 남겨 둔다 — 터치에서 손을 뗀(pointerup) 순간 닫으면
   * 뒤따라 오는 click이 막 아래 칸에 떨어져 칸이 열릴 수 있기 때문.
   */
  function close() {
    if (openIdx < 0) return;
    openIdx = -1;
    svg.classList.remove('is-open');
    svg.style.display = 'none';
    clearTimeout(lingerTimer);
    lingerTimer = setTimeout(() => { backdrop.hidden = true; }, 350);
  }

  /** 주 버튼(왼쪽 클릭·터치)을 뗄 때만 — 맥에선 우클릭 메뉴가 누를 때 떠서, 떼는 순간 바로 닫히면 안 된다 */
  const isPrimaryRelease = (e) => e.button === 0;

  function pick(k) {
    const idx = openIdx;
    close();
    if (idx >= 0) onPick(idx, OPTIONS[k].mark);
  }

  /**
   * cellEl 둘레에 팔레트를 연다. currentMark 조각은 강조한다.
   * zoom: 판 확대 배율 — 팔레트는 판 안에 있어 같이 커지므로 1/zoom으로 되돌려 화면 크기를 일정하게 한다.
   */
  function open(cellEl, cellIdx, currentMark, zoom = 1) {
    const s = cellEl.offsetWidth * zoom; // 화면에 보이는 칸 크기
    const rIn = Math.max(s * 0.75, 26);
    const rOut = rIn + Math.max(s * 0.8, 40);
    const pad = 4;
    const c = rOut + pad;
    const size = c * 2;

    svg.innerHTML = '';
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    // 칸은 .board-stage 기준으로 배치된다 (offsetParent = .board-stage)
    svg.style.left = `${cellEl.offsetLeft + s / 2 - c}px`;
    svg.style.top = `${cellEl.offsetTop + cellEl.offsetHeight / 2 - c}px`;
    svg.style.transformOrigin = `${c}px ${c}px`;
    svg.style.setProperty('--pal-scale', String(1 / zoom));

    OPTIONS.forEach((opt, k) => {
      const a0 = START_DEG + k * STEP_DEG + GAP_DEG / 2;
      const a1 = a0 + STEP_DEG - GAP_DEG;
      const current = opt.mark === currentMark || (opt.mark === null && !currentMark);
      const g = svgEl('g', {
        class: `mark-option${opt.mark ? ` mark-option-${opt.mark.endsWith('black') ? 'black' : 'white'}` : ''}${current ? ' is-current' : ''}`,
        role: 'menuitem',
        'aria-label': opt.label,
      });
      const title = svgEl('title');
      title.textContent = `${opt.label} (${k + 1})`;
      g.appendChild(title);
      g.appendChild(svgEl('path', { d: sectorPath(c, rIn, rOut, a0, a1), class: 'mark-sector' }));

      const [tx, ty] = polar(c, (rIn + rOut) / 2, (a0 + a1) / 2);
      const glyph = svgEl('text', {
        x: tx,
        y: ty,
        class: `mark-glyph ${opt.mark ? `mark-glyph-${opt.mark.endsWith('black') ? 'black' : 'white'}` : 'mark-glyph-delete'}`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-size': Math.max(15, Math.min(24, (rOut - rIn) * 0.42)),
      });
      glyph.textContent = opt.mark ? MARK_GLYPH[opt.mark] : '✕';
      g.appendChild(glyph);

      // 터치에서는 click이 가끔 안 따라오므로 손을 뗄 때 고른다
      g.addEventListener('pointerup', (e) => {
        if (!isPrimaryRelease(e)) return;
        e.stopPropagation();
        pick(k);
      });
      g.addEventListener('click', (e) => e.stopPropagation());
      svg.appendChild(g);
    });

    openIdx = cellIdx;
    clearTimeout(lingerTimer);
    backdrop.hidden = false;
    svg.style.display = '';
    // 다음 프레임에 열림 애니메이션
    requestAnimationFrame(() => svg.classList.add('is-open'));
  }

  // 바깥을 누르면 닫기만 한다 (뒤의 칸이 눌리지 않도록 투명 막이 받는다)
  backdrop.addEventListener('pointerup', (e) => {
    if (isPrimaryRelease(e)) close();
  });
  backdrop.addEventListener('click', close);
  backdrop.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('keydown', (e) => {
    if (openIdx < 0) return;
    if (e.key === 'Escape') {
      close();
      e.stopPropagation();
    } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= OPTIONS.length) {
      pick(Number(e.key) - 1);
    }
  });

  return { open, close, isOpen: () => openIdx >= 0 };
}
