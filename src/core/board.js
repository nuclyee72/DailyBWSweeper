/**
 * board.js — 흑백 지뢰찾기 판 모델.
 *
 * - 지뢰: 검/흰. 칸마다 주변 검지뢰 수·흰지뢰 수를 따로 센다.
 * - 특수 칸(검/흰): 숫자에는 검·흰 양쪽에 1씩 세지만, 눌러도 터지지 않고 드러난다.
 * - 칸 방향: 칸마다 대각선으로 검/흰 삼각형이 갈려 있고 방향은 무작위·고정 (blackCorner).
 * - 레이저: 판 가장자리에서 검/흰 레이저가 쏘아진다. 연 칸을 눌러 "활성화"하면 그 칸이 거울이 된다.
 *   모든 판정은 레이저의 "지금 색"으로 한다 (색 반전기를 지나면 바뀐다).
 *       활성 칸의 삼각형: 같은 색이면 그대로 통과, 반대 색이면 대각선에 튕긴다.
 *       특수 칸: 멈추지 않고 통과. 같은 색이면 지나가며 명중, 반대 색이면 폭발.
 *       지뢰: 같은 색이면 폭발, 반대 색이면 그대로 통과.
 * - 빈칸(주변 검·흰 모두 0): 회색. 거울이 될 수 없고 레이저는 그대로 지나간다.
 *   빈칸 중 일부는 색 반전기 — 항상 켜져 있고, 가로·세로 어느 방향으로 지나가든 레이저 색이 바뀐다 (검 ↔ 흰).
 * - 클리어: 모든 특수 칸이 열려 있고 같은 색 레이저가 닿아 있으면.
 *   안 연 특수 칸은 레이저가 닿아도 드러나지 않는다.
 */

export const COLOR = { BLACK: 'black', WHITE: 'white' };

const flip = (color) => (color === COLOR.BLACK ? COLOR.WHITE : COLOR.BLACK);

/** 레이저가 이렇게 끝나면 폭발(패배): 같은 색 지뢰, 반대 색 특수 칸 */
export const BOOM_ENDS = new Set(['mine', 'wrong']);

/** 플레이어가 안 연 칸에 다는 지뢰 표시. 표시가 달린 칸은 눌러도 열리지 않는다 (실수 방지). */
export const MARKS = ['mine-black', 'mine-white'];

/** 표시가 실제 칸과 맞는지 */
function markMatches(cell) {
  if (cell.mark === 'mine-black') return cell.isMine && cell.mineColor === COLOR.BLACK;
  if (cell.mark === 'mine-white') return cell.isMine && cell.mineColor === COLOR.WHITE;
  return true;
}

/** 검 삼각형이 붙은 모서리 */
export const CORNER = { TL: 0, TR: 1, BR: 2, BL: 3 };

/** 방향: 0 오른쪽, 1 아래, 2 왼쪽, 3 위 */
export const DX = [1, 0, -1, 0];
export const DY = [0, 1, 0, -1];
const R = 0, D = 1, L = 2, U = 3;

/** 대각선 모양: 검 모서리가 TL/BR이면 '/', TR/BL이면 '\' */
export function isSlash(blackCorner) {
  return blackCorner === CORNER.TL || blackCorner === CORNER.BR;
}

/** 방향 d로 움직이는 레이저가 이 칸에서 들어가는 삼각형의 색 */
export function enteredColor(blackCorner, d) {
  let corner;
  if (isSlash(blackCorner)) corner = d === R || d === D ? CORNER.TL : CORNER.BR;
  else corner = d === D || d === L ? CORNER.TR : CORNER.BL;
  return corner === blackCorner ? COLOR.BLACK : COLOR.WHITE;
}

/** 대각선에 튕긴 뒤의 방향 */
export function reflect(blackCorner, d) {
  // '/' : 오른→위, 아래→왼, 왼→아래, 위→오른   '\' : 오른→아래, 아래→오른, 왼→위, 위→왼
  return isSlash(blackCorner) ? [U, L, D, R][d] : [D, R, U, L][d];
}

function idx(board, x, y) {
  return y * board.cols + x;
}

function inBounds(board, x, y) {
  return x >= 0 && y >= 0 && x < board.cols && y < board.rows;
}

function neighborIdxs(board, x, y) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(board, nx, ny)) out.push(idx(board, nx, ny));
    }
  }
  return out;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 레이저 발사기를 고른다. 모두 lasers개 — 검·흰이 적어도 하나씩, 나머지는 무작위 색.
 * 맨 가장자리 줄은 피하고(한쪽으로만 꺾일 수 있어 풀이가 잘 안 나온다),
 * 같은 방향 줄끼리는 서로 붙지 않게 한다.
 * 발사기 = { color, x, y, dir } — (x, y)는 레이저가 처음 들어가는 칸.
 */
function chooseEmitters(cols, rows, lasers, rng) {
  const colors = [COLOR.BLACK, COLOR.WHITE];
  while (colors.length < lasers) colors.push(rng() < 0.5 ? COLOR.BLACK : COLOR.WHITE);
  shuffle(colors, rng);

  const used = new Set();
  const emitters = [];
  for (const color of colors) {
    for (let tries = 0; tries < 400; tries++) {
      const side = Math.floor(rng() * 4); // 0 왼쪽, 1 위, 2 오른쪽, 3 아래
      const horizontal = side === 0 || side === 2;
      const len = horizontal ? rows : cols;
      const n = 1 + Math.floor(rng() * (len - 2));
      const p = horizontal ? 'r' : 'c';
      if (used.has(p + n) || used.has(p + (n - 1)) || used.has(p + (n + 1))) continue;
      used.add(p + n);
      if (side === 0) emitters.push({ color, x: 0, y: n, dir: R });
      else if (side === 2) emitters.push({ color, x: cols - 1, y: n, dir: L });
      else if (side === 1) emitters.push({ color, x: n, y: 0, dir: D });
      else emitters.push({ color, x: n, y: rows - 1, dir: U });
      break;
    }
  }
  return emitters;
}

/** 발사기가 아무것도 활성화 안 된 판에서 곧게 지나가는 칸들 */
function emitterLine(board, em) {
  const out = [];
  let x = em.x;
  let y = em.y;
  while (inBounds(board, x, y)) {
    out.push(idx(board, x, y));
    x += DX[em.dir];
    y += DY[em.dir];
  }
  return out;
}

/**
 * 비어 있는 판. 방향·발사기는 바로 정하고, 지뢰·특수 칸·반전기는 첫 클릭 뒤 placeContents()로.
 * cfg = { lasers: 레이저(=특수 칸) 수, mismatch: 반대 색 목표 수, inverters: 색 반전기 수 }
 */
export function createBoard(cols, rows, cfg, rng = Math.random) {
  const cells = new Array(cols * rows);
  for (let i = 0; i < cells.length; i++) {
    cells[i] = {
      blackCorner: Math.floor(rng() * 4),
      isMine: false,
      mineColor: null,
      special: null, // COLOR.BLACK | COLOR.WHITE | null
      inverter: false, // 빈칸 중 색 반전기
      revealed: false,
      mark: null, // 플레이어 표시: MARKS 중 하나 | null
      active: false, // 거울·반전기 활성화
      lit: false, // 특수 칸: 같은 색 레이저가 닿아 있음
      wrongMark: false, // 게임 오버 때만: 실제와 다른 표시
      countBlack: 0,
      countWhite: 0,
    };
  }
  return {
    cols,
    rows,
    cfg,
    cells,
    emitters: chooseEmitters(cols, rows, cfg.lasers, rng),
    specialIdxs: [],
    inverterIdxs: [],
    mined: false,
    totalMines: 0,
    blackTotal: 0,
    whiteTotal: 0,
    gameOver: false,
    won: false,
    solvable: false,
    solution: null, // placeContents()가 찾은 풀이 — [{ emitter, specialIdx, actives }] + .order
  };
}

/**
 * 레이저 em이 특수 칸 targetIdx를 지나 판 밖으로 안전하게 빠져나가는 최단 경로.
 * 상태 (칸, 방향, 목표 지남 여부, 지금 색)로 BFS — 칸마다 지나감 / 거울로 튕김을 고른다.
 * 반전기는 항상 켜져 있어 지나가면 무조건 색이 바뀐다.
 * 다른 레이저 경로와는 곧게 가로지르는 것만 허용한다:
 *   used.actives(다른 경로가 켠 칸)에는 들어가지 않고, used.cells(다른 경로가 지나는 칸)는 켜지 않는다.
 * allowInvert=false면 반전기 칸을 벽으로 보고 반전기를 지나지 않는 경로만 찾는다 (반전기가 꼭 필요한지 검사할 때).
 * anyBlank=true면 아무 빈칸 하나에서 한 번 색을 바꿀 수 있다고 본다 (반전기 자리를 고를 때 — placed에 그 칸).
 * 반환: { cells: 지나간 칸들, actives: 켜야 하는 거울 (발사기 쪽부터), inverts: 지난 반전기 수, placed } | null
 * (한 경로가 같은 칸을 두 번 지나며 서로 다른 선택을 하는 경우는 무시하는 근사 — verifySolution이 걸러낸다)
 */
function findPath(board, em, targetIdx, used, { allowInvert = true, anyBlank = false } = {}) {
  const prev = new Map(); // key → { from, act: null | 'mirror' | 'invert' | 'place' }
  const queue = [[em.x, em.y, em.dir, 0, em.color, null, null]];
  let found = null;
  while (queue.length) {
    const [x, y, d, passed, color, from, act] = queue.shift();
    if (!inBounds(board, x, y)) {
      // 목표를 지난 뒤 판 밖으로 나가면 성공
      if (passed) {
        found = from;
        break;
      }
      continue;
    }
    const i = idx(board, x, y);
    if (used.actives.has(i)) continue;
    const key = ((i * 4 + d) * 2 + passed) * 2 + (color === COLOR.BLACK ? 0 : 1);
    if (prev.has(key)) continue;
    prev.set(key, { from, act });

    const cell = board.cells[i];
    if (cell.special && cell.special !== color) continue;
    if (cell.isMine && cell.mineColor === color) continue;
    const nextPassed = passed || i === targetIdx ? 1 : 0;
    const free = !used.cells.has(i);

    // 반전기(항상 켜짐): 지나가는 수밖에 없고, 지나가면 색이 바뀐다
    if (cell.inverter) {
      if (allowInvert) queue.push([x + DX[d], y + DY[d], d, nextPassed, flip(color), key, 'invert']);
      continue;
    }
    queue.push([x + DX[d], y + DY[d], d, nextPassed, color, key, null]);
    // 거울: 지뢰·특수 칸·빈칸은 거울이 될 수 없다
    if (free && !cell.isMine && !cell.special && !isBlank(cell) && enteredColor(cell.blackCorner, d) !== color) {
      const nd = reflect(cell.blackCorner, d);
      queue.push([x + DX[nd], y + DY[nd], nd, nextPassed, color, key, 'mirror']);
    }
    // 반전기 자리 고르기: 이 빈칸에 반전기를 둔다고 보고 색을 바꿔 본다 (한 번만)
    if (free && anyBlank && color === em.color && isBlank(cell)) {
      queue.push([x + DX[d], y + DY[d], d, nextPassed, flip(color), key, 'place']);
    }
  }
  if (found === null) return null;

  const cells = new Set();
  const actives = [];
  const placed = [];
  let inverts = 0;
  for (let k = found; k !== null; k = prev.get(k).from) {
    cells.add(Math.floor(k / 16));
    const { from, act } = prev.get(k);
    if (act === 'mirror') actives.push(Math.floor(from / 16));
    else if (act === 'invert') inverts++;
    else if (act === 'place') placed.push(Math.floor(from / 16));
  }
  return { cells, actives: actives.reverse(), inverts, placed };
}

/**
 * 반대 색 목표 중 적어도 하나는 반전기 없이는 절대 맞힐 수 없는가.
 * (다른 경로 제약 없이 찾아도 없으면, 실제 판에서도 반전기를 써야만 한다)
 */
function inverterRequired(board) {
  const none = { cells: new Set(), actives: new Set() };
  return board.intended.some(({ emitter, specialIdx }) => {
    const color = board.cells[specialIdx].special;
    if (color === emitter.color) return false;
    return board.emitters
      .filter((em) => em.color === color)
      .every((em) => !findPath(board, em, specialIdx, none, { allowInvert: false }));
  });
}

/**
 * 특수 칸 mismatch개를 짝 레이저와 반대 색으로 바꾼다.
 * 후보: 반대 색으로 바꿨을 때 그 색 레이저 누구도 반전기 없이는 맞힐 수 없는 칸 — 그래야 반전기가 꼭 필요하다.
 * 반환: mismatch개를 바꿨으면 true
 */
function flipTargets(board, mismatch, rng) {
  const none = { cells: new Set(), actives: new Set() };
  let flipped = 0;
  for (const { emitter, specialIdx } of shuffle([...board.intended], rng)) {
    if (flipped >= mismatch) break;
    const cell = board.cells[specialIdx];
    cell.special = flip(emitter.color);
    const reachable = board.emitters.some(
      (em) => em.color === cell.special && findPath(board, em, specialIdx, none, { allowInvert: false }),
    );
    if (reachable) cell.special = emitter.color;
    else flipped++;
  }
  return flipped >= mismatch;
}

/**
 * 색 반전기를 빈칸에 놓는다.
 * 반대 색 목표마다, 그 짝 레이저가 지나가며 색을 바꿔 목표까지 갈 수 있는 빈칸을 골라 반전기로 삼는다
 * (무작위 빈칸에 두면 쓸 수 있는 자리에 놓일 일이 드물다). 남는 개수는 아무 빈칸에나.
 * 반환: 모든 반대 색 목표에 쓸 반전기를 놓았으면 true
 */
function placeInverters(board, count, rng) {
  const blanks = shuffle(board.cells.map((c, i) => i).filter((i) => isBlank(board.cells[i])), rng);
  const none = { cells: new Set(), actives: new Set() };
  board.inverterIdxs = [];

  const mismatched = board.intended.filter(({ emitter, specialIdx }) => board.cells[specialIdx].special !== emitter.color);
  for (const { emitter, specialIdx } of mismatched) {
    if (board.inverterIdxs.length >= count) return false;
    // 아무 빈칸에서나 한 번 색을 바꿀 수 있다고 보고 경로를 찾은 뒤, 실제로 색을 바꾼 칸을 반전기로
    const path = findPath(board, emitter, specialIdx, none, { anyBlank: true });
    const spot = path?.placed[0];
    if (spot === undefined) return false;
    board.cells[spot].inverter = true;
    board.inverterIdxs.push(spot);
  }
  for (const b of blanks) {
    if (board.inverterIdxs.length >= count) break;
    if (board.cells[b].inverter) continue;
    board.cells[b].inverter = true;
    board.inverterIdxs.push(b);
  }
  return true;
}

/**
 * 발사기 k ↔ 특수 칸 k(배치할 때 정한 짝)로 서로 부딪히지 않는 경로를 모두 찾는다.
 * 먼저 찾은 경로가 뒤 경로를 막을 수 있으니 순서를 몇 가지로 바꿔 시도한다.
 * 반환: [{ emitter, specialIdx, actives }] (+ .order) | null
 */
function solve(board, rng) {
  const pairs = board.intended.map(({ emitter, specialIdx }) => [emitter, specialIdx]);
  const orders = [pairs, [...pairs].reverse()];
  for (let k = 0; k < 6; k++) orders.push(shuffle([...pairs], rng));
  // 배치 때 정한 짝이 막히면 다른 짝짓기도 시도 — 어느 레이저가 어느 특수 칸을 맞혀도 된다.
  // (반대 색 목표는 inverterRequired로 이미 "반전기 없이는 못 맞힘"이 보장돼 있다)
  const targets = board.intended.map((p) => p.specialIdx);
  for (let k = 0; k < 10; k++) {
    const perm = shuffle([...targets], rng);
    orders.push(shuffle(board.emitters.map((em, j) => [em, perm[j]]), rng));
  }

  for (const order of orders) {
    const used = { cells: new Set(), actives: new Set() };
    const solution = [];
    for (const [em, si] of order) {
      const path = findPath(board, em, si, used);
      if (!path) break;
      path.cells.forEach((c) => used.cells.add(c));
      path.actives.forEach((a) => used.actives.add(a));
      solution.push({ emitter: em, specialIdx: si, actives: path.actives, inverts: path.inverts });
    }
    if (solution.length === order.length && verifySolution(board, solution)) return solution;
  }
  return null;
}

/**
 * 풀이를 검증한다.
 * 1) 켤 칸을 모두 켜면 모든 레이저가 배정된 특수 칸을 지나 판 밖으로 무사히 나가는가
 * 2) 하나씩 켜 나가는 동안 한 번도 폭발하지 않는 순서가 있는가
 * 통과하면 그 순서를 solution.order로 남긴다.
 */
function verifySolution(board, solution) {
  const activeIdxs = [...new Set(solution.flatMap((s) => s.actives))];
  for (const a of activeIdxs) board.cells[a].active = true;
  const ok = solution.every((s) => {
    const t = traceLaser(board, s.emitter);
    return t.end === 'exit' && t.hits.includes(s.specialIdx);
  });
  for (const a of activeIdxs) board.cells[a].active = false;
  if (!ok) return false;

  const order = findSafeOrder(board, activeIdxs);
  if (!order) return false;
  solution.order = order;
  return true;
}

/**
 * 칸을 하나씩 켜는 순서 중, 매 단계 어떤 레이저도 폭발하지 않는 것 (DFS + 실패 상태 기억).
 * 칸이 많으면 탐색량이 커지므로 노드 수 상한을 둔다 — 넘으면 이 풀이는 버린다.
 */
function findSafeOrder(board, activeIdxs) {
  const n = activeIdxs.length;
  if (n > 28) return null;
  const full = n === 0 ? 0 : 2 ** n - 1;
  const dead = new Set();
  const order = [];
  let budget = 6000;
  const safe = () => board.emitters.every((em) => !BOOM_ENDS.has(traceLaser(board, em).end));

  const dfs = (mask) => {
    if (mask === full) return true;
    if (dead.has(mask) || --budget < 0) return false;
    for (let k = 0; k < n; k++) {
      const bit = 2 ** k;
      if (Math.floor(mask / bit) % 2 === 1) continue;
      const cell = board.cells[activeIdxs[k]];
      cell.active = true;
      const ok = safe() && (order.push(activeIdxs[k]), dfs(mask + bit) || (order.pop(), false));
      cell.active = false;
      if (ok) return true;
    }
    dead.add(mask);
    return false;
  };

  // DFS 안에서 켠 칸은 되돌아올 때마다 끄므로, 끝나면 판은 원래대로
  return dfs(0) ? [...order] : null;
}

/**
 * 지뢰·특수 칸·반전기를 배치한다 (첫 클릭 직후).
 * - 첫 클릭 칸과 이웃, 발사기의 처음 직선 경로에는 지뢰·특수 칸을 두지 않는다.
 * - 반전기를 꼭 써야 하고, 검증된 풀이가 있는 판이 나올 때까지 다시 뽑는다.
 *   발사기 배치가 풀이 가능성을 크게 좌우하므로 몇 번 안 되면 발사기 위치까지 다시 뽑는다.
 * - 시간 안에 못 찾으면 마지막으로 "반전기 필수" 조건을 빼고 만든다 (풀 수 없는 판은 내지 않는다).
 */
export function placeContents(board, mineCount, firstClickIdx, rng = Math.random, { maxRounds = 0 } = {}) {
  // maxRounds를 주면 시간 대신 횟수로 끊는다 — 데일리처럼 누가 만들어도 같은 판이 나와야 할 때 (기기 속도와 무관)
  const deadline = Date.now() + 3000;
  const more = (round) => (maxRounds ? round < maxRounds : Date.now() < deadline);
  for (let round = 0; more(round); round++) {
    if (round > 0) board.emitters = chooseEmitters(board.cols, board.rows, board.cfg.lasers, rng);
    placeContentsOnce(board, mineCount, firstClickIdx, rng);
    if (board.solvable) return;
  }
  const strict = board.cfg;
  board.cfg = { ...strict, mismatch: 0 };
  for (let round = 0; round < 20 && !board.solvable; round++) {
    board.emitters = chooseEmitters(board.cols, board.rows, board.cfg.lasers, rng);
    placeContentsOnce(board, mineCount, firstClickIdx, rng);
  }
  board.cfg = strict;
}

/** 칸마다 주변 검·흰 수를 센다. 특수 칸은 양쪽에 1씩. */
function computeCounts(board) {
  for (let y = 0; y < board.rows; y++) {
    for (let x = 0; x < board.cols; x++) {
      const cell = board.cells[idx(board, x, y)];
      cell.countBlack = 0;
      cell.countWhite = 0;
      if (cell.isMine || cell.special) continue;
      for (const ni of neighborIdxs(board, x, y)) {
        const n = board.cells[ni];
        if (n.special) {
          cell.countBlack++;
          cell.countWhite++;
        } else if (n.isMine) {
          if (n.mineColor === COLOR.BLACK) cell.countBlack++;
          else cell.countWhite++;
        }
      }
    }
  }
}

/** 빈칸: 지뢰·특수 칸이 아니고 주변 검·흰이 모두 0 — 회색, 거울이 될 수 없다 (반전기일 수는 있다) */
export function isBlank(cell) {
  return !cell.isMine && !cell.special && cell.countBlack === 0 && cell.countWhite === 0;
}

function placeContentsOnce(board, mineCount, firstClickIdx, rng) {
  const { lasers, mismatch, inverters } = board.cfg;
  const firstX = firstClickIdx % board.cols;
  const firstY = Math.floor(firstClickIdx / board.cols);
  const lineCells = new Set(board.emitters.flatMap((em) => emitterLine(board, em)));
  const safe = new Set([firstClickIdx, ...neighborIdxs(board, firstX, firstY), ...lineCells]);

  let pool = [];
  for (let i = 0; i < board.cells.length; i++) if (!safe.has(i)) pool.push(i);
  if (pool.length < lasers + mineCount) {
    pool = [];
    for (let i = 0; i < board.cells.length; i++) {
      if (i !== firstClickIdx && !lineCells.has(i)) pool.push(i);
    }
  }

  board.solvable = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    for (const c of board.cells) {
      c.isMine = false;
      c.mineColor = null;
      c.special = null;
      c.inverter = false;
      // 첫 클릭 전엔 어떤 칸의 방향도 보이지 않았으므로 같이 다시 뽑는다 (첫 시도는 원래 방향 유지)
      if (attempt > 0) c.blackCorner = Math.floor(rng() * 4);
    }
    shuffle(pool, rng);

    // 특수 칸: 우선 발사기 k의 짝으로 같은 색. (특수 칸 색은 숫자에 영향이 없다 — 양쪽 모두로 센다)
    board.intended = board.emitters.map((emitter, k) => {
      const specialIdx = pool[k];
      board.cells[specialIdx].special = emitter.color;
      return { emitter, specialIdx };
    });
    board.specialIdxs = board.intended.map((p) => p.specialIdx);

    for (const mi of pool.slice(lasers, lasers + mineCount)) {
      board.cells[mi].isMine = true;
      board.cells[mi].mineColor = rng() < 0.5 ? COLOR.BLACK : COLOR.WHITE;
    }
    // 숫자가 정해져야 빈칸(거울이 못 되는 칸·반전기 후보)이 정해진다
    computeCounts(board);
    // mismatch개를 반대 색으로 바꾼다 — 반대 색으로 바꿔도 그 색 레이저가 반전기 없이는 못 맞히는 것 중에서
    if (!flipTargets(board, mismatch, rng)) continue;
    if (mismatch > 0 && !inverterRequired(board)) continue;
    if (!placeInverters(board, inverters, rng)) continue;
    board.solution = solve(board, rng);
    board.solvable = board.solution !== null;
    if (board.solvable) break;
  }

  let blackTotal = 0;
  let whiteTotal = 0;
  for (const c of board.cells) {
    if (c.isMine && c.mineColor === COLOR.BLACK) blackTotal++;
    else if (c.isMine) whiteTotal++;
  }

  board.mined = true;
  board.totalMines = blackTotal + whiteTotal;
  board.blackTotal = blackTotal;
  board.whiteTotal = whiteTotal;
}

/**
 * 칸을 연다. 지뢰면 터짐, 특수 칸이면 드러나기만, 검+흰 합이 0이면 이어진 0 칸까지 번져서 연다.
 * (특수 칸 이웃은 항상 1/1 이상이라 번지다가 특수 칸이 열리는 일은 없다.)
 */
export function revealCell(board, startIdx) {
  if (board.gameOver) return { exploded: false };
  const start = board.cells[startIdx];
  if (start.revealed || start.mark) return { exploded: false };

  if (start.isMine) {
    start.revealed = true;
    board.gameOver = true;
    board.won = false;
    return { exploded: true };
  }
  if (start.special) {
    start.revealed = true;
    return { exploded: false };
  }

  const stack = [startIdx];
  const seen = new Set();
  while (stack.length) {
    const i = stack.pop();
    if (seen.has(i)) continue;
    seen.add(i);
    const cell = board.cells[i];
    if (cell.revealed || cell.mark || cell.isMine || cell.special) continue;
    cell.revealed = true;
    if (cell.countBlack === 0 && cell.countWhite === 0) {
      const x = i % board.cols;
      const y = Math.floor(i / board.cols);
      for (const ni of neighborIdxs(board, x, y)) if (!seen.has(ni)) stack.push(ni);
    }
  }
  return { exploded: false };
}

/** 켜고 끌 수 있는 칸인지: 연 칸 중 거울이 되는 칸 (지뢰·특수 칸·빈칸·반전기 제외 — 반전기는 항상 켜져 있다) */
export function canToggle(board, i) {
  const cell = board.cells[i];
  if (board.gameOver || !cell.revealed || cell.isMine || cell.special) return false;
  return !isBlank(cell);
}

/**
 * 칸 i를 켜고 끄면 레이저가 어떻게 바뀌는지 — 보이는 정보만으로 계산 (판은 그대로 둔다).
 * 반환: { now, next } 각각 발사기 순서의 레이저 경로
 */
export function previewToggle(board, i) {
  const cell = board.cells[i];
  const now = board.emitters.map((em) => traceLaser(board, em, { visibleOnly: true }));
  cell.active = !cell.active;
  const next = board.emitters.map((em) => traceLaser(board, em, { visibleOnly: true }));
  cell.active = !cell.active;
  return { now, next };
}

/** 연 거울 칸을 켜고 끈다. 바뀌었으면 true. */
export function toggleActive(board, i) {
  if (!canToggle(board, i)) return false;
  const cell = board.cells[i];
  cell.active = !cell.active;
  return true;
}

/** 안 연 칸에 지뢰 표시를 단다 (mark = MARKS 중 하나 | null 삭제). 바뀌었으면 true. */
export function setMark(board, i, mark) {
  if (board.gameOver) return false;
  const cell = board.cells[i];
  if (cell.revealed || cell.mark === mark) return false;
  cell.mark = mark;
  return true;
}

export function countMarks(board, mark) {
  let n = 0;
  for (const c of board.cells) if (!c.revealed && c.mark === mark) n++;
  return n;
}

/**
 * 레이저 한 줄기를 따라간다.
 * segments: 색이 같은 구간들 [{ color, points }] — 판 좌표(칸 1개 = 1) 꺾은선.
 *   발사기(판 밖)에서 시작해 튕긴 칸·반전기 칸 중심을 지나 끝점까지. 반전기에서 다음 구간이 시작된다.
 * points: 구간을 이은 전체 꺾은선
 * end: 'exit' 판 밖으로 | 'mine' 같은 색 지뢰 폭발 | 'wrong' 반대 색 특수 칸 폭발
 * hits: 지나간 같은 색 특수 칸들 (명중). 레이저는 특수 칸에서 멈추지 않으므로 끝점으로 위치를 알 수 없다.
 * cells: 지나간 칸들 (레이저 강조 표시용)
 * visibleOnly: 플레이어에게 보이는 정보(켜진 거울, 열린 칸 — 반전기는 레이저 색이 바뀌는 게 늘 보이므로 포함)만으로 따라간다 — 미리보기용.
 *   안 연 칸의 지뢰·특수 칸을 무시하므로 숨은 정보가 새지 않는다.
 */
export function traceLaser(board, em, { visibleOnly = false } = {}) {
  let x = em.x;
  let y = em.y;
  let d = em.dir;
  let color = em.color;
  let seg = { color, points: [[x + 0.5 - DX[d] * 0.8, y + 0.5 - DY[d] * 0.8]] };
  const segments = [seg];
  const hits = [];
  const cells = [];
  const maxSteps = board.cols * board.rows * 8 + 4;

  const finish = (end, cellIdx, last) => {
    seg.points.push(last);
    const points = segments.flatMap((s, k) => (k === 0 ? s.points : s.points.slice(1)));
    return { emitter: em, segments, points, end, cellIdx, hits, cells };
  };

  for (let step = 0; step < maxSteps && inBounds(board, x, y); step++) {
    const i = idx(board, x, y);
    const cell = board.cells[i];
    const center = [x + 0.5, y + 0.5];
    const known = !visibleOnly || cell.revealed;
    cells.push(i);

    // 같은 색 지뢰는 폭발, 반대 색 지뢰는 그대로 지나간다
    if (known && cell.isMine && cell.mineColor === color) return finish('mine', i, center);
    // 특수 칸: 반대 색은 폭발, 같은 색은 명중하고 그대로 지나간다
    if (known && cell.special && cell.special !== color) return finish('wrong', i, center);
    if (known && cell.special && !hits.includes(i)) hits.push(i);

    if (cell.inverter) {
      // 반전기(항상 켜짐): 색이 바뀌고 곧게 지나간다
      seg.points.push(center);
      color = flip(color);
      seg = { color, points: [center] };
      segments.push(seg);
    } else if (cell.active && enteredColor(cell.blackCorner, d) !== color) {
      // 거울: 반대 색 삼각형으로 들어가면 튕기고, 같은 색이면 그대로 지나간다
      d = reflect(cell.blackCorner, d);
      seg.points.push(center);
    }
    x += DX[d];
    y += DY[d];
  }
  return finish('exit', -1, [x + 0.5 - DX[d] * 0.2, y + 0.5 - DY[d] * 0.2]);
}

/**
 * 모든 레이저를 다시 계산하고 명중·폭발·클리어를 판정한다.
 * 명중한 특수 칸은 lit만 켜지고 드러나지는 않는다.
 */
export function computeLasers(board) {
  for (const c of board.cells) c.lit = false;
  const traces = board.emitters.map((em) => traceLaser(board, em));

  let hitIdx = -1;
  let hitKind = null; // 'mine' | 'wrong'
  for (const t of traces) {
    for (const h of t.hits) board.cells[h].lit = true; // 드러내지는 않는다 — 열어야 보인다
    if (BOOM_ENDS.has(t.end) && hitIdx < 0) {
      hitIdx = t.cellIdx;
      hitKind = t.end;
    }
  }

  if (board.mined && !board.gameOver) {
    if (hitIdx >= 0) {
      board.gameOver = true;
      board.won = false;
    } else if (board.specialIdxs.length && board.specialIdxs.every((i) => board.cells[i].lit && board.cells[i].revealed)) {
      board.gameOver = true;
      board.won = true;
    }
  }
  return { traces, hitIdx, hitKind };
}

/** 패배 시: 모든 지뢰·특수 칸 공개, 실제와 다른 표시는 wrongMark */
export function revealAllOnLoss(board) {
  for (const cell of board.cells) {
    if (cell.isMine || cell.special) cell.revealed = true;
    if (cell.mark && !markMatches(cell)) cell.wrongMark = true;
  }
}
