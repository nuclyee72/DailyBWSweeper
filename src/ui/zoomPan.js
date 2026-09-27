/**
 * zoomPan.js — 터치 화면에서 판 확대/이동 (스도쿠 핀치 줌과 같은 방식).
 * - 두 손가락: 가운데 점을 기준으로 확대/축소
 * - 한 손가락: 끌면 이동. 조금이라도 끌었으면 손을 뗄 때 칸이 눌리지 않게 클릭을 막는다.
 * 마우스는 건드리지 않는다 (데스크톱은 판이 한눈에 들어온다).
 *
 * viewport(.board-area) 안의 content(.board-stage)에 translate + scale을 건다 (transform-origin 0 0).
 */
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DRAG_SLOP = 8; // 이만큼 움직여야 끌기로 본다 (px)

export function createZoomPan(viewport, content, { onChange } = {}) {
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const pointers = new Map(); // 터치 pointerId → { x, y }
  let pinch = null; // { startDist, startScale }
  let pan = null; // { id, x0, y0, tx0, ty0, moved }
  let suppressClick = false;

  /** transform을 빼고 본 content의 화면 위치 */
  function layoutOrigin() {
    const r = content.getBoundingClientRect();
    return { left: r.left - tx, top: r.top - ty };
  }

  /** 판 가장자리가 화면 가운데를 넘어가지 않게 이동 범위를 제한한다 */
  function clamp() {
    const vr = viewport.getBoundingClientRect();
    const { left, top } = layoutOrigin();
    const w = content.offsetWidth * scale;
    const h = content.offsetHeight * scale;
    const cx = vr.left + vr.width / 2;
    const cy = vr.top + vr.height / 2;
    tx = Math.min(cx - left, Math.max(cx - left - w, tx));
    ty = Math.min(cy - top, Math.max(cy - top - h, ty));
  }

  function apply() {
    if (scale <= MIN_SCALE + 0.001) {
      scale = MIN_SCALE;
      tx = 0;
      ty = 0;
    } else {
      clamp();
    }
    content.style.transform = scale === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`;
    onChange?.(scale);
  }

  /** 화면 좌표 (cx, cy) 아래의 판 위치가 그대로 남도록 배율을 바꾼다 */
  function zoomAt(newScale, cx, cy) {
    const { left, top } = layoutOrigin();
    const lx = (cx - left - tx) / scale;
    const ly = (cy - top - ty) / scale;
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    tx = cx - left - lx * scale;
    ty = cy - top - ly * scale;
    apply();
  }

  function reset() {
    scale = 1;
    apply();
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // 모든 리스너는 capture 단계 — 판 안의 요소(표시 팔레트 등)가 stopPropagation 해도 손가락 추적이 끊기지 않게
  viewport.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    // 첫 손가락(primary)이면 새 손짓 — 혹시 남아 있던 손가락 기록은 버린다
    if (e.isPrimary) {
      pointers.clear();
      pinch = null;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      // 새 손짓 시작 — 이전 손짓의 클릭 막기가 남아 있으면 지운다 (클릭이 안 따라온 경우)
      suppressClick = false;
      pan = { id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, moved: false };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { startDist: dist(a, b) || 1, startScale: scale };
      pan = null;
      suppressClick = true; // 두 손가락이 닿았으면 어떤 칸도 눌리지 않게
    }
  }, true);

  viewport.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch && pointers.size >= 2) {
      e.preventDefault();
      const [a, b] = [...pointers.values()];
      zoomAt(pinch.startScale * (dist(a, b) / pinch.startDist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (pan && e.pointerId === pan.id) {
      const dx = e.clientX - pan.x0;
      const dy = e.clientY - pan.y0;
      if (!pan.moved && Math.hypot(dx, dy) > DRAG_SLOP) {
        pan.moved = true;
        suppressClick = true;
      }
      if (pan.moved && scale > 1) {
        e.preventDefault();
        tx = pan.tx0 + dx;
        ty = pan.ty0 + dy;
        apply();
      }
    }
  }, { passive: false, capture: true });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) pan = null;
  };
  viewport.addEventListener('pointerup', release, true);
  viewport.addEventListener('pointercancel', release, true);

  // 끌기·핀치 뒤에 따라오는 클릭은 칸에 닿기 전에 막는다
  viewport.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
  // 끌다가 길게 누른 것으로 판단되어 뜨는 contextmenu(표시 팔레트)도 막는다
  viewport.addEventListener('contextmenu', (e) => {
    if (pan?.moved || pinch) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  return { reset, get scale() { return scale; } };
}
