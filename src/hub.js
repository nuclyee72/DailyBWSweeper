/**
 * hub.js — ProjectDaily 허브(/ProjectDaily/)와 이어 주는 연결부. (게임 공통, 같은 파일)
 *
 * - 허브(/ProjectDaily/)의 버튼은 `?open=<랜딩 버튼 id>`로 이 페이지를 연다 → 로드 직후 그 버튼을 대신 눌러 준다.
 * - 허브의 지난 퍼즐 달력은 `?archive=YYYY-MM-DD&mode=<모드>`로 연다 → main.js가 넘긴 playArchive로 바로 시작.
 * - 허브의 자유 연습 모드 고르기는 `?free=<모드>`로 연다 → main.js가 넘긴 playFree로 바로 시작.
 * - 허브에서 들어온 탭에서는 "메인 화면" 역할을 허브가 하므로, 게임의 랜딩 메인으로 돌아가는
 *   대신 허브로 보낸다(leaveToHub). 주소로 직접 들어온 경우엔 지금까지처럼 게임 랜딩을 쓴다.
 * - 허브는 통계를 카드 안에서 직접 보여 주며, 그 계산은 src/hubApi.js를 불러 쓴다.
 */
// 절대 경로: 허브 안(/ProjectDaily/DailySudoku/)에서도, 예전 주소(/DailySudoku/)에서도 같은 허브로 간다
const HUB_URL = '/ProjectDaily/';
const FROM_HUB_KEY = (slug) => `daily-hub:from:${slug}`;

let hubSlug = '';
let fromHub = false;

// 다크 모드는 허브·세 게임이 같이 쓴다 — 어디서 바꾸든 전부 같은 값으로 저장
const DARK_KEYS = ['daily-dark-mode', 'sudoku-dark-mode', 'trilateral-dark-mode', 'wordship-dark-mode', 'bwsweeper-dark-mode'];
export function saveDarkMode(on) {
  try { DARK_KEYS.forEach((k) => localStorage.setItem(k, on ? '1' : '0')); } catch { /* 무시 */ }
}

// 허브로 돌아갈 때 방문 기록을 쌓지 않는다 — 안 그러면 휴대폰 "뒤로"가 방금 나온 게임으로 되돌아간다.
// 바로 앞 기록이 허브면 그리로 되돌아가고, 아니면 지금 기록을 허브로 바꿔 끼운다.
export function goHub() {
  let prevIsHub = false;
  try { prevIsHub = history.length > 1 && new URL(document.referrer).pathname === HUB_URL; } catch { /* referrer 없음 */ }
  if (prevIsHub) history.back();
  else location.replace(`${HUB_URL}#${hubSlug}`);
}

/** 허브에서 들어온 탭이면 허브로 보내고 true — 호출부는 true면 원래의 랜딩 전환을 건너뛴다 */
export function leaveToHub() {
  if (!fromHub) return false;
  goHub();
  return true;
}

/**
 * main.js 맨 끝(이벤트 연결·첫 화면 표시가 끝난 뒤)에서 한 번 호출
 * @param {{ playArchive?: (date: string, mode: string) => void, playFree?: (mode: string) => void }} [opts]
 */
export function initHub(slug, { playArchive, playFree } = {}) {
  hubSlug = slug;
  const params = new URLSearchParams(location.search);
  const openId = params.get('open');
  const archiveDate = params.get('archive');
  const freeMode = params.get('free');
  const launched = Boolean(openId || archiveDate || freeMode);
  try {
    if (launched) sessionStorage.setItem(FROM_HUB_KEY(slug), '1');
    fromHub = sessionStorage.getItem(FROM_HUB_KEY(slug)) === '1';
  } catch { fromHub = launched; }

  document.querySelectorAll('[data-hub-link]').forEach((a) => { a.href = `${HUB_URL}#${slug}`; });

  if (!launched) return;
  // 새로고침해도 다시 실행되지 않게 주소창에서 지운다
  history.replaceState(null, '', location.pathname + location.hash);

  if (archiveDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(archiveDate)) playArchive?.(archiveDate, params.get('mode') || 'standard');
    return;
  }
  if (freeMode) {
    playFree?.(freeMode);
    return;
  }

  // 랜딩 메인의 버튼만 허용 (임의 id 클릭 방지)
  const btn = document.getElementById(openId);
  if (!(btn instanceof HTMLButtonElement) || !btn.closest('#landing-main')) return;
  btn.click();

  // 통계만 보러 온 경우: 통계 창을 닫으면 (게임 화면이 아니라면) 허브로 돌아간다
  if (openId === 'btn-landing-stats') {
    const modal = document.getElementById('daily-stats-modal');
    const landing = document.getElementById('landing-screen');
    if (!modal || !landing) return;
    const obs = new MutationObserver(() => {
      if (modal.classList.contains('show')) return;
      obs.disconnect();
      if (!landing.classList.contains('hidden')) goHub();
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
}
