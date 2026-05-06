# 다리건너기 Bonus Race — 동시 도달 무승부 처리 회의

**일시**: 2026-05-05
**참여**: 지민 (PD) · 현우 (기획) · 승호 (UX) · 다은 (UI) — 1단계 (기획/UI)
**프로그래머 (태준/미래/윤서) 미합류**: 결정 후 2단계에서 합류 예정

---

## 1. 안건

같은 turn에 user 여러 명이 progress 6 도달 시 누가 꼴등인지 결정 모호.

### Case 분류
- Case 1: A: 5→6(+1), B: 4→6(+2) — advance 다름
- Case 2/3: 둘 다 progress 같음 + advance 같음 — 진짜 동시

### 옵션
- A. 자연 해소 (advance 다름은 큰 쪽 1등, 진짜 동시만 sudden death)
- B. 모든 동시 sudden death
- C. random tie-break
- D. 출발 위치 우선

---

## 2. 팀원별 의견 요약

### 지민 (PD)
- **추천: 옵션 A**
- 코드 변경 0.5일, 일정 영향 무시 가능
- 기존 sudden death 인프라 재활용 = 비용 0
- 옵션 B는 게임 호흡 끊김, C는 정당화 부담, D는 스코프 크립

### 현우 (기획)
- **추천: 옵션 A** + 사용자 스토리:
  > 유저로서 나는 "쟤 보너스 +2 받았으니까 1등" 직관적으로 납득되길 원한다
- 술자리 템포 유지 위해 sudden death 빈도 < 10% 권장
- 성공 지표: "왜 내가 꼴등?" 채팅 발생률 < 5%

### 승호 (UX)
- **추천: 옵션 A 강력 지지**
- 핵심 원칙: **"보이는 것 = 결과"** (보너스 적중자 = 더 빨리 골인 = 1등)
- ⚠️ **finish slot reset 위험**: "골인 = 게임 끝" 멘탈 모델 깨짐
- **대안: col 6 진입 직전 정지 + 후진 walk** (역방향 walk 애니)
- 카메라 흔들림 + alert 사운드 + 라벨 pulse

### 다은 (UI)
- **추천: 옵션 A**
- ⚠️ finish slot reset = "끌려간다" 인상 → 좌절감
- **대안: col 5 holding** (cyan→magenta 색 전환 + 진동)
- SuddenDeathOverlay 신설 (옐로우+마젠타, 글리치 텍스트, 0.5일 공수)
- 결투자 외 user는 blur(4px) + opacity 0.4 → 시선 집중
- bonus-pad launch frame 재활용 → 신규 sprite 0개

---

## 3. 합의 사항

| 항목 | 합의 |
|------|------|
| 결정 옵션 | **옵션 A (자연 해소)** — 4명 만장일치 |
| Case 1 처리 | advance 큰 user가 1등 (자연스러움) |
| Case 2/3 처리 | 그 N명만 sudden death loop |
| **finish slot reset 폐기** | UX/UI 공통 우려 — col 5 holding으로 변경 |
| 시각 임팩트 | SuddenDeathOverlay (희소 이벤트 강조) |
| 신규 sprite | 0개 (bonus-pad launch frame 재활용) |
| 캐릭터 표정/색 | 변화 X (게임 결과 누설 방지) |
| 다른 user 후퇴 시각 | blur + opacity 0.4 |

---

## 4. 충돌 지점

### 화이트 플래시 vs 슬로우모션 (승호 ↔ 다은)
- **다은 제안**: 화이트 플래시 150ms (시선 차단 → 상황 전환)
- **승호 우려**: 광과민성/멀미 위험
- **승호 대안**: 슬로우모션 0.3x for 200ms
- → **사용자 결정 필요**

### 라벨 색상 (승호 ↔ 다은)
- **다은**: 옐로우(#FFEB3B) + 마젠타 outline + 글리치 텍스트
- **승호**: 빨강 그라데이션 + 흰 테두리 (긴장감)
- → **사용자 결정 필요** (또는 기획 의도 확인)

---

## 5. 서로 던진 질문

| 질문자 | 대상 | 질문 |
|--------|------|------|
| 지민 | 승호 | advance 1프레임 시차가 "확실한 1등"으로 인지되나? |
| 현우 | 다은 | 마지막 turn advance 차이를 결과 화면에서 어떻게 시각화? |
| 승호 | 다은 | sudden death 라벨 별도 overlay vs gameStatus 교체? |
| 다은 | 승호 | 화이트 플래시 광과민성 안전 vs 슬로우모션 어느 쪽? |

---

## 6. 권장 다음 액션 (담당자 제안)

| # | 액션 | 담당 | 공수 |
|---|------|------|------|
| 1 | 사용자에게 추가 결정 받기 | 이더 (지금) | 즉시 |
| 2 | server `processWave` 동시 도달 분기 (Case 2/3만 sudden death) | 태준 (백엔드) | 1h |
| 3 | 클라 finish slot reset 폐기 → col 5/6 직전 정지 + 후진 walk | 미래 (프론트) | 2h |
| 4 | SuddenDeathOverlay 컴포넌트 신설 | 다은 + 미래 | 0.5d |
| 5 | 카메라 흔들림 + 슬로우모션 0.3x | 미래 | 1h |
| 6 | (선택) sudden_death_alert.mp3 신규 사운드 | 별도 결정 | TBD |
| 7 | Case 1/2/3 시나리오 QA | 윤서 | 반일 |

**총 예상 공수: 1.5일**

---

## 7. 결론 (사용자에게 보고할 내용)

**옵션 A 채택 (만장일치)** + 추가 결정 필요사항:

1. ⚠️ **finish slot reset 폐기** — col 5에서 정지 (UX/UI 공통 우려 반영)
2. ❓ 화이트 플래시 vs 슬로우모션 (광과민성 안전)
3. ❓ 라벨 색상 — 옐로우+마젠타 vs 빨강
4. ❓ sudden_death_alert.mp3 신규 제작 여부

**구현 순서**: server 룰 변경 (Case 2/3 sudden death) → 클라 col 5 holding → SuddenDeathOverlay → 시각 polish → QA.
