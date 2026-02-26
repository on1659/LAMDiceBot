# LAMDiceBot 팀 회의록

**일시**: 2026-02-26
**주제**: WebSocket 재연결 시 방 삭제 버그 — ZScaler 프록시 환경 대응
**참석자**: 서버 아키텍트, 클라이언트 개발자, 네트워크 전문가, QA 엔지니어, 보안/인프라 담당
**회의 방식**: 5인 전문가 독립 분석 → 교차 검토 → 합의 도출

---

## 1. 현황 요약

**사건**: 2026-02-26 실서버에서 사용자 김영태가 방을 3번 연속 잃어버리는 사건 발생.

**로그 분석 결과**:
- 2/23(정상): disconnect가 수분 간격으로 산발적 발생 → 방 생존
- 2/26(장애): 모든 사용자(3~8명)가 동일 초에 동시 disconnect → 방 삭제
- 접속 IP가 전부 ZScaler 프록시(165.225.x.x)로 변경됨 — 코드 변경 없이 환경 변화로 발생

**근본 원인 2가지**:
1. **클라이언트**: 1회용 connect 리스너 패턴 (`socket.off()`) — 첫 connect 이후 해제되어 auto-reconnect 시 joinRoom 미전송
2. **서버**: 빈 방 즉시 삭제 + disconnect 대기 시간 5초가 프록시 환경에서 부족

---

## 2. 독립 분석 결과

### 2-1. 서버 아키텍트

| # | 문제 | 원인 | 심각도 |
|---|------|------|--------|
| A1 | 빈 방 즉시 삭제 | chat.js disconnect 타이머 만료 시 grace period 없이 바로 삭제 | 긴급 |
| A2 | 대기 시간 부족 | transport close 5초 대기 — ZScaler 재연결 지연이 5초 초과 | 높음 |
| A3 | grace period 미구현 | 빈 방이 돼도 30초 정도 유예 없이 바로 삭제 | 높음 |

### 2-2. 클라이언트 개발자

| # | 문제 | 원인 | 심각도 |
|---|------|------|--------|
| B1 | reconnect 후 방 복귀 안 됨 | `socket.on('connect', fn)` + `socket.off(fn)` 1회용 패턴 | 긴급 |
| B2 | dice setServerId 누락 | roulette/crane과 달리 dice는 reconnect 시 setServerId 미전송 | 높음 |
| B3 | horse-app connect 핸들러 | logging만 있고 rejoin 로직 없음 | 높음 |

### 2-3. 네트워크 전문가

- ZScaler SSL inspection proxy는 WebSocket 세션을 주기적으로 일괄 리셋함
- 기업 정책 변경(2/26) 이후 리셋 주기가 짧아진 것으로 추정
- 모든 사용자가 동일 프록시를 통과 → 동시 disconnect 불가피
- 클라이언트에서 능동 재입장 로직 없이는 구조적으로 방 소실 반복됨

### 2-4. QA 엔지니어

**검증된 엣지 케이스**:

| 시나리오 | 예상 동작 | 위험도 |
|----------|----------|--------|
| 정상 새로고침(F5) | socket 재생성 → 영구 리스너 첫 connect에 발동 → joinRoom | 안전 |
| 자발적 방 나가기 | sessionStorage 삭제 → reconnect 시 rejoin 안 함 | 안전 |
| 탭 닫기 | sessionStorage 소멸 → 15초 후 정상 제거 | 안전 |
| 서버 재시작 | roomError 응답 → sessionStorage 삭제 → 로비 복귀 | 안전 |
| 이중 joinRoom | 서버가 existingUser + tabId 재연결 경로로 처리 | 안전 |
| 부분 reconnect (5명 중 3명) | 성공 3명 rejoin, 나머지 15초 후 제거 | 안전 |
| grace period 중 호스트 재할당 | 빈 방이면 첫 재입장자가 호스트 — 허용 동작 | 허용 |
| grace timer race condition | `if (room._graceTimer) return` 가드로 방지 | 안전 |

### 2-5. 보안/인프라 담당

- grace timer 취소 위치 검토: `const room = rooms[roomId]` 직후 배치 시 서버 격리 체크 실패해도 타이머가 취소되어 방 고아 상태 위험
- **수정**: 모든 유효성 검사(서버 격리, 비밀번호, 최대인원) 통과 후에만 취소

---

## 3. 합의 결과

| 수정 | 역할 | 방어선 |
|------|------|--------|
| disconnect 타이머 5초→15초 | 개별 유저의 방 내 존속 시간 연장 | 1차 방어 |
| 방 삭제 grace period 30초 | 빈 방 즉시 삭제 방지 | 2차 방어 |
| 클라이언트 자동 rejoin (socket.off 제거) | reconnect 후 실제로 방에 복귀 | **근본 해결** |

---

## 4. 주요 결정 및 근거

- **grace period를 chat.js disconnect 경로에만 적용** (leaveRoom 자발적 퇴장에는 미적용): 사용자가 능동적으로 나가는 경우는 즉시 삭제가 맞음
- **socket.off 제거 방식 채택** (connect 핸들러 추가가 아닌): 기존 코드 구조를 최대한 유지하면서 최소 변경으로 해결
- **grace timer 취소는 유효성 검사 이후**: 서버 격리 체크 실패 시 타이머가 취소됐지만 유저는 입장 못 해 방이 고아 상태로 남는 버그 방지

---

## 5. 구현

impl 문서: [2026-02-26-websocket-reconnect-fix-impl.md](../../impl/2026-02-26-websocket-reconnect-fix-impl.md)
