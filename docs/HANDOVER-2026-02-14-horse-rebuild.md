# LAMDiceBot 인수인계 노트 (2026-02-14)

브랜치: `feature/horse-rebuild`
현재 HEAD: `ef107c1`

## 1) 지금까지 완료된 작업

### 라우팅/호환
- `/horse-race`를 React 경마 앱 진입점으로 사용하도록 정리
- `horse-app/dist` 없으면 레거시 `horse-race-multiplayer.html`로 fallback
- 기존 URL `/horse-race-multiplayer.html` 접근 시 `/horse-race`로 리다이렉트
- 주사위 페이지의 경마 이동 링크를 `/horse-race?...`로 교체

### 테스트/검증 스크립트
- `test-file-separation.js`를 React/레거시 양쪽을 허용하도록 분기 처리
- `/horse-race` 기준으로 테스트 경로 업데이트

### horse-app (React) 기능 이관
- 기존 pending 흐름 자동 처리
  - `pendingHorseRaceRoom`, `pendingHorseRaceJoin` 읽어서 자동 create/join
  - `horseRaceUserName` 복원
- 기본 채팅/주문 패널 추가
  - `ChatPanel`, `OrderPanel`
  - `newMessage`, `orderStarted`, `orderEnded` 이벤트 동기화
- 헤더 기능 추가
  - 랭킹 버튼(`RankingModule` 연동, 없으면 `/statistics` fallback)
  - 사운드 토글(`SoundManager` mute/unmute)
- 튜토리얼 1차 추가
  - 첫 진입 오버레이 + 도움말 버튼 재오픈
- `GameLayout` phase 렌더링 구조 단순화
- 전역 모듈 접근 분리
  - `src/utils/externalModules.ts`

## 2) 배포/환경 메모
- Railway 프로덕션 브랜치: `feature/horse-rebuild` (사용자 확인)
- 사용자 공유 최신 배포 ID: `8ec3ce33-2bda-4c53-a31b-5456fcfea761`
- 테스트 주소: `https://lamtest.up.railway.app`

## 3) 남은 작업 (우선순위)

### P1 (리팩토링 완결)
1. 공통 레이어 분리 고도화
   - 채팅/준비/주문/랭킹/사운드 상태 접근 패턴 통일
   - `window` 의존 직접 접근 제거(필요 시 util 경유)
2. 소켓 이벤트 타입 정밀화
   - `unknown`으로 둔 order/chat payload 명확한 타입으로 교체
3. horse-app UI 상태 결합도 축소
   - 표시 로직과 이벤트 처리 로직 더 분리

### P2 (기능 완성도)
4. 채팅 디테일
   - 이모티콘/리액션 표시 & 업데이트
   - 시스템 메시지 타입 표시
5. 주문 디테일
   - 주문 목록/정렬/요약 상태 연동
6. 랭킹 UI 연동 검증
   - 서버/자유랭킹, 검색, 탭 전환 동작 점검

### P3 (QA)
7. 회귀 QA 시나리오 전체 실행
   - 입장/준비/선택/카운트다운/레이스/결과
   - 채팅/주문/랭킹/사운드/나가기
   - 레거시 fallback 경로

## 4) 작업 시 주의사항
- `main` 직접 푸시 금지, `feature/horse-rebuild`에서 진행
- 레거시 호환 절대 깨지지 않게 유지(redirect/fallback)
- 커밋 단위 작게 (한 의도 = 한 커밋)
- 매 변경 후 최소 `horse-app` 빌드 검증

## 5) 빠른 검증 명령어
```bash
cd ~/Work/LAMDiceBot/horse-app
npm run build

cd ~/Work/LAMDiceBot
node -c routes/api.js
node -c test-file-separation.js
```

## 6) 최근 핵심 커밋
- `ef107c1` refactor(horse-app): isolate global module access in utility
- `45259f7` refactor(horse-app): simplify phase layout rendering in GameLayout
- `31b09c9` feat(horse-app): add first-run tutorial overlay and help entry
- `d408f23` feat(horse-app): add header ranking button and sound toggle
- `6ab2250` feat(horse-app): add basic chat/order panels with socket event sync

---
필요하면 다음 담당자는 이 문서 기준으로 P1 → P2 → P3 순서로 진행하면 됨.
