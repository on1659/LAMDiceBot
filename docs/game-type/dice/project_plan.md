# 주사위 게임 Project Plan

## Recent Updates

### 2026-01-29: 사운드 on/off 체크박스 추가

#### 작업 내용
- 주사위 게임에 **🔊 사운드** 체크박스 추가 (기본값: 끔)
- `localStorage`에 `diceSoundEnabled` 키로 설정 저장
- `getDiceSoundEnabled()` 함수로 사운드 재생 여부 제어

#### 수정 파일
- `dice-game-multiplayer.html`: connection-sound-row, 체크박스, localStorage 동기화

---

### 2026-01-27: 중복 닉네임 자동 처리

#### 작업 내용
- 같은 이름이 이미 있으면 자동으로 `_1`, `_2` 접미사 추가
- 아이디 유효성 검사 구현 (한글, 영문 소문자, 숫자, `_`, `-` 허용)
- 재사용 가능한 `validateUserId()` 함수 분리

#### 수정 파일
- `dice-game-multiplayer.html`: UI 및 유효성 검사
- `server.js`: `generateUniqueUserName()` 함수 추가

---

### 2026-01-01: 주사위 게임 기반 플랫폼 안정화

#### 작업 내용
- 시드 기반 공정 난수 생성 (`seededRandom`) 구현
- 하이/로우/니어 3가지 기본 룰 승자 판정
- GPT 커스텀 룰 판정 API 연동
- 드라마틱 애니메이션 시스템 (하이/로우/니어 확률적 연출)
- 자동 게임 종료 (모든 참여자 굴림 완료 시)
- 굴림 진행 상황 실시간 표시
- 채팅-주사위 결과 연동 (`/주사위` 명령어)

---

## 기능 요약

| 기능 | 상태 | 설명 |
|------|------|------|
| 방 생성/입장 | ✅ 완료 | 게임 타입별 방 분기 |
| 준비/시작/종료 | ✅ 완료 | 호스트 제어, 최소 2명 |
| 주사위 굴리기 | ✅ 완료 | 시드 기반 공정 RNG |
| 범위 설정 | ✅ 완료 | 사용자별 1~100,000 |
| 하이/로우/니어 룰 | ✅ 완료 | 자동 승자 판정 |
| 커스텀 룰 (GPT) | ✅ 완료 | OpenAI API 연동 |
| 애니메이션 연출 | ✅ 완료 | 확률적 드라마틱 효과 |
| 채팅 통합 | ✅ 완료 | 이모지 반응, /주사위 명령 |
| 주문받기 | ✅ 완료 | 메뉴 자동완성 |
| 사운드 | ✅ 완료 | on/off 토글 |
| 룰 엔진 최적화 | 📋 제안 | API 호출 99% 감소 계획 |

## 향후 작업

1. AI 룰 엔진 최적화 (`docs/feature-proposals/07-ai-rule-engine-optimization.md`)
2. 업적/뱃지 시스템
3. 리플레이 시스템
4. 커스텀 테마/스킨

## 참고 파일

- `dice-game-multiplayer.html`: 클라이언트 전체
- `server.js`: 서버 로직
- `chat-shared.js`, `order-shared.js`, `ready-shared.js`: 공유 모듈
- `AutoTest/dice/`: 자동 테스트
- `docs/feature-proposals/`: 기능 제안서
