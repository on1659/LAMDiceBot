# Race Script 포맷 명세 v1

경마 레이스 디렉터(B안) Phase 1 산출물. 서버가 저작하고 클라가 재생하는 와이어 계약.

- 공용 평가 모듈: `js/shared/race-script-engine.js` (서버 검증기 · 클라 재생기 공용)
- 상위 플랜: [horse-race-dramatic-finish.md](horse-race-dramatic-finish.md)
- 현행 재생 세만틱 조사: 이 문서 §6 "현행 대비 표"

## 설계 원칙 — 왜 이 형태인가

### 1. 위치는 누적이 아니라 `pos(t)` 직접 샘플링

현행은 `currentPos += speed * deltaTime`으로 **누적 적분**한다. 그래서:
- 프레임률·`deltaTime` 편차가 위치 오차로 쌓인다 (그래서 서버가 150ms 결승 간격을
  안전마진으로 깔아야 했다 — `docs/meeting/applied/2026-04-18-horse-150ms-gap-impl.md`)
- 임의 시점으로 건너뛸 수 없어 catch-up이 "16ms씩 다시 밟기" 루프를 돈다
- 서버·클라가 같은 공식을 두 벌 유지해야 한다 (dual-sim 표류)

스크립트 체제에서는 **속도 세그먼트에서 위치를 닫힌 형태로 계산**한다. 세그먼트
경계마다 누적 거리를 미리 넣어두면 임의 `t`의 위치가 O(log n) 조회 + 상수 시간
적분으로 나온다.

```
세그먼트 i: [t0, t1), 속도 v0 → v1 선형 보간
  구간 내 s에서:  v(s) = v0 + (v1 - v0) * (s - t0) / (t1 - t0)
  위치:          pos(s) = posAt[i] + v0*(s-t0) + (v1-v0)*(s-t0)²/(2*(t1-t0))
```

결과: **드리프트 0, seek 공짜, 단일 SSOT.** 150ms 간격 규칙도 안전마진 목적이
사라진다(접전 연출 목적으로만 선택 사용).

### 2. 연출은 "구간 선언", 매 프레임 루틴은 재생기 로컬

wobble(`wobblePhase += 0.3` 사인), reverse(`scaleX(-1)`), 카메라 lerp는 프레임
의존이라 키프레임화가 불가능하다. 스크립트는 **"t1~t2 구간에 wobble"** 만 선언하고,
그 안의 매 프레임 수학은 재생기가 현행 코드 그대로 실행한다. 위치만 스크립트가
소유하므로 연출이 결과에 영향을 줄 수 없다(= 공정성 계약이 코드 구조로 보장된다).

### 3. 마커는 이벤트형 / 상태형으로 분리

임의 시점 합류(관전 catch-up, 탭 복귀, 다시보기 진입)에서:
- **상태형**(`state`): 그 시점에 진행 중이면 **재구성**한다 (💤 루프, rest 스프라이트,
  비네트, scaleX 반전)
- **이벤트형**(`event`): 지나갔으면 **스킵**한다 (플래시, 사운드, 중계 한 줄)

현행 `isCatchingUp` 억제 + `reconcileAfterCatchUp` 복원 관례를 데이터로 승격한 것.

## 스키마

```jsonc
{
  "v": 1,                        // 포맷 버전 — 구버전 탭 거부 판정
  "raceId": "…",                 // record.id와 동일 (다시보기 조회 키)
  "trackDistanceMeters": 700,
  "pixelsPerMeter": 10,
  "startPosition": 10,
  "finishLine": 7000,            // = trackDistanceMeters * pixelsPerMeter (파생값이지만 명시)
  "stakeRank": 3,                // 판돈이 갈리는 등수 (first=1, last=runnerCount, 룰렛=targetRank)
  "simDurationMs": 26000,        // 시뮬 시간 총 길이
  "wallDurationMs": 28400,       // timeScale 반영 벽시계 길이 — 워치독·타이밍 가드의 canonical 값
  "seed": 123456,                // 재생기 로컬 난수(먼지 방향 등 결과 무관 연출)용

  "horses": [
    {
      "horseIndex": 0,
      "vehicleId": "horse",
      "visualWidth": 56,         // 완주 판정에 쓰이므로 스크립트가 소유 (클라 카탈로그 의존 제거)
      "rank": 1,                 // 최종 순위 (1-based, drawRankings 결과)
      "runner": true,            // false = 무베팅 정지마
      "segments": [
        // t: 세그먼트 시작 시뮬시각(ms), v0/v1: 시작·끝 속도(px/ms), p: t 시점 누적 위치(px)
        { "t": 0,     "v0": 0.18, "v1": 0.21, "p": 10 },
        { "t": 500,   "v0": 0.21, "v1": 0.19, "p": 107.5 }
        // 마지막 세그먼트의 끝 = finishSimMs
      ],
      "finishJudgedSimMs": 25200, // 오른쪽 끝이 결승선 통과 (순위 확정 시점)
      "finishSimMs": 25800        // 왼쪽 끝 통과 (완전 정지)
    }
  ],

  "markers": [
    {
      "id": "m1",
      "kind": "state",           // "state" | "event"
      "t": 20000,                // 시뮬시각
      "dur": 1800,               // state만: 지속. event는 생략
      "horse": 0,                // 대상 말 (전역 연출이면 생략)
      "type": "sleep",           // §4 마커 타입 어휘
      "beat": "D1",              // 소속 비트 (없으면 L0 소형 연출)
      "camera": {                // 선택 — 카메라 힌트
        "target": 0,
        "force": true,           // 사용자 카메라 오버라이드 (L1 비트만)
        "holdMs": 2500,
        "label": "📷 하이라이트 카메라"
      },
      "say": [                   // 선택 — 중계 멘트 시퀀스 (마커 t 기준 오프셋)
        { "at": 0,    "text": "…", "holdMs": 2000 },
        { "at": 1200, "text": "…", "holdMs": 2500 }
      ]
    }
  ],

  "timeScale": [                 // 구간별 재생 배율 (슬로모션도 스크립트가 소유)
    { "t": 0,     "scale": 1 },
    { "t": 24000, "scale": 0.2 },
    { "t": 25600, "scale": 1 }
  ]
}
```

### 필드 계약

| 필드 | 계약 |
|------|------|
| `segments` | `t` 오름차순, 빈틈 없음. 마지막 세그먼트는 `finishSimMs` 이후를 덮는 정지 구간 |
| `v0`/`v1` | px/ms. **음수 허용** (slip·reverse의 후진). 재생기는 `max(startPosition, pos)` 클램프 |
| `p` | 세그먼트 시작 시각의 누적 위치. 저작 시 계산해 넣는다 (재생기 부담 0) |
| `rank` | 1-based. `finishJudgedSimMs` 순서와 **반드시 일치** (validate가 단언) |
| `timeScale` | 구간별 상수. `t` 오름차순, 첫 항목은 `t=0` |
| `markers` | `t` 오름차순 권장(필수 아님). `state` 마커의 `[t, t+dur)`가 활성 구간 |

## 마커 타입 어휘

2계층이다 — 신규 비트 프리미티브 ∪ 기존 기믹 시각 타입 (엔지니어링 리뷰 E-C3).

**비트 프리미티브** (신규 저작 어휘)

| type | kind | 연출 |
|------|------|------|
| `sleep` | state | 정지 + rest 스프라이트 + 💤 말풍선 루프 + 스포트라이트 |
| `wake` | event | 화들짝 기상 (D1 해소) |
| `spotlight` | state | 대상 강조 + 주변 톤다운 (모바일 판독성 전역 큐) |
| `vignette` | state | 비네트 색/강도 (현행 슬로모 비네트 일반화) |
| `flash` | event | 결승 판독 플래시 |
| `freeze` | state | 프리즈 프레임 (D3 📸 판독 홀드) |
| `charge` | state | 스퍼트 충전 예고 오라 (D4 텔레그래프) |
| `caption` | event | 트랙 내 캡션 1줄 (전체화면·PiP 동반) |
| `sfx` | event | 사운드 큐 |

**레거시 기믹 시각 타입** (현행 연출 그대로 재사용)

`stop` `slow` `sprint` `slip` `wobble` `obstacle` `item_boost` `item_trap`
`reverse` `reverse_boost` `item_rocket` `item_ice` `evolution` `evolution_fake`
(+ `_boost` 체인). 전부 `kind: "state"`.

⚠️ `wobble`·`reverse`는 매 프레임 로컬 루틴 — 재생기가 현행 수학을 그대로 돌린다.
동시 활성 시 wobble의 `translateY`가 reverse의 `scaleX(-1)`을 덮는 현행 동작까지
재현한다 (`js/horse-race.js:4400-4404`).

## 시뮬 시간 ↔ 벽시계 시간

`timeScale`이 있으므로 두 시계가 다르다. 재생기는 벽시계 경과를 받아 시뮬시각을
구해야 한다.

```
wallAt[i] = 구간 i 시작의 누적 벽시계
구간 i 안:  wall = wallAt[i] + (tSim - t[i]) / scale[i]
역변환:     tSim = t[i] + (wall - wallAt[i]) * scale[i]
```

`wallDurationMs`가 **워치독 상한과 `raceAnimationComplete` 타이밍 가드의 유일한
기준**이다 (엔지니어링 리뷰 B-4/D-1).

## 검증 계약 (`validate`)

서버가 스크립트를 내보내기 전 반드시 통과해야 하는 단언:

| 코드 | 단언 |
|------|------|
| `RANK_MISMATCH` | `finishJudgedSimMs` 정렬 순서 == `rank` 순서 |
| `SEGMENT_GAP` | 세그먼트 t 연속·오름차순, `p` 누적값이 적분과 일치 |
| `TELEPORT` | 구간 속도 절대값이 상한 이하 (순간이동 방지) |
| `NO_CAUSE_DELTA` | 체감 임계 이상 속도 변화에 원인 마커 동반 (디자인 리뷰 D-H3) |
| `L0_GAP_CAP` | 진행 ~75%까지 stakeRank 경계 격차 상한 (독주 판 면제) |
| `L0_LEAD_CHANGE` | 선두 교체 최소 1회 (runnerCount ≥ 2일 때) |
| `SLOWMO_BUDGET` | 판당 슬로모 벽시계 총합·최저 배율 사용 횟수 상한 |
| `FINISH_ORDER` | 완주 시각이 순위와 모순 없음, 미완주 러너 없음 |

위반 시 **스크립트만** 재생성한다 — `drawRankings` 결과는 불변(공정성 계약).
완화 사다리: L1 비트 드롭 → L0 완화 → 무드라마 폴백. 폴백률은 로그 + 임계 경고.

## 현행 대비 표

| 항목 | 현행 | 스크립트 체제 |
|------|------|---------------|
| 순위 결정 | 서버 시뮬 창발 | `drawRankings` 추첨 (연출과 분리) |
| 클라 도착 순서 | 이미 서버 `rank` 사용 (`:4500`) | 동일 — 변화 없음 |
| 위치 | 누적 적분 (`+= v*dt`) | `pos(t)` 직접 샘플링 |
| 결승선 순위 강제 | `finishStun` 자빠짐 클램프 (`:4455`) | 불필요 (스크립트가 순서 보장) — 단 연출로는 선택 사용 가능 |
| 150ms 최소 간격 | 드리프트 안전마진 (필수) | 접전 연출 옵션 (선택) |
| catch-up | 16ms씩 재밟기 루프 | 시각 seek + 상태형 마커 재구성 |
| 슬로모 | 클라 자체 판정 (트리거 조건 하드코딩) | `timeScale` 트랙 |
| 다시보기 | record의 시드·기믹으로 재시뮬 | 같은 스크립트 재생 |
| 서버·클라 공식 | 두 벌 (LCG 미러) | 한 벌 (`js/shared/race-script-engine.js`) |

### 현행 조사에서 발견된 결함 (이 작업으로 자연 해소)

- 클라 슬로모 폴백값(`leader 15m/0.4`)이 서버 config(`10m/0.2`)와 불일치 —
  서버 값이 안 오는 경로(리플레이 등)에서 다른 연출이 나온다
- 리더 슬로모는 오른쪽 끝(`:3825`), 꼴등 슬로모는 왼쪽 끝(`:3961`) 기준 — 비대칭
- `reverse_boost` 시각 연출이 두 곳에 중복 정의 (`:4208`, `:4367`)
- 1등 `scale(1.1)` 골인 연출이 다음 프레임 transform 리셋 가드에 지워짐 (`:4856`)
