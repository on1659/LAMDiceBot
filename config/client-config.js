// 클라이언트 조정 가능 상수 — 튜닝 시 이 파일만 읽으면 됨
// HTML에서 다른 shared JS보다 먼저 로드해야 함

// ─── 서버 선택 UI (server-select-shared.js) ───
const SS_MEMBERS_REFRESH_INTERVAL = 5000; // 멤버 목록 갱신 주기 (ms)
const SS_JOIN_TIMEOUT = 10000;            // 서버 입장 응답 대기 시간 (ms)
const SS_TOAST_DURATION = 2000;           // 토스트 메시지 표시 시간 (ms)
const SS_TOAST_FADE_MS = 300;             // 토스트 페이드아웃 시간 (ms)
const SS_MEMBERS_DOT_DELAY = 300;         // 멤버 빨간점 표시 딜레이 (ms, DOM 렌더링 대기)

// ─── 태그라인 롤러 (tagline-roller.js) ───
const TAGLINE_INTERVAL_MS = 7000;  // 문구 전환 주기 (ms)
const TAGLINE_TRANSITION_MS = 700; // 전환 애니메이션 시간 (ms)
const TAGLINE_ERASE_STEP_MS = 80;  // 글자 지우기 단계 딜레이 (ms)
const TAGLINE_TYPE_STEP_MS = 50;   // 글자 입력 단계 딜레이 (ms)
