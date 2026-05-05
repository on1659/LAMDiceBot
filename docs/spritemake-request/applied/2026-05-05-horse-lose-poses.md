# SpriteMake 의뢰: 경마 차량 15종 — Lose(패배/당첨자) 자세

작성일: 2026-05-05
요청자: LAMDiceBot 프로젝트

## Batch Overview

```text
Batch Sprite Production Request:
- Original user request: 경마 게임에서 "당첨된 사람(=벌칙자)"의 차량이 결승선 진입 시 슬프거나 기죽은 자세를 보여주는 lose 스프라이트 추가
- SpriteMake batch folder: output/horse-lose-poses-2026-05-05/
- Game / project: LAMDiceBot — 경마 (horse-race)
- Game project root: D:\Work\LAMDiceBot
- Generation provider: OpenAI Images API
- Required image model: gpt-image-2
- Scene or feature: 결승선 통과 후 "당첨된 등수" 도착 시 카메라가 비추는 슬로우모션 + 결과창에서 표시되는 패배/벌칙 스프라이트
- Shared gameplay purpose: 5초간 슬로우모션 동안 정지 자세로 표시되는 lose 프레임. "이 친구가 음료수 사줄 사람!" 임을 시각적으로 강조
- Shared visual direction:
    * 픽셀 아트풍 — 기존 차량 SVG와 동일한 chunky pixel style
    * 컬러 팔레트는 각 차량의 기본 색상 톤 유지하되, 채도 -20~30%로 낮춤 (기죽은 느낌)
    * 검은 외곽선 1~2px (기존 SVG와 동일)
    * 측면 뷰 (left-facing 또는 right-facing — 기존 차량 방향 유지)
    * 표정/포즈는 코믹·만화풍 (어두운 비극이 아니라 "아쉬워하는" 톤)
- Existing assets or style to match: js/horse-race-sprites.js 내 인라인 SVG (run/finish/victory 상태) 참조. viewBox 0 0 25 25 기준 chunky pixel 디자인
- In-game scale reference: 트랙 위 차량 = 약 60px × 45px 렌더 사이즈. 셀 안 캐릭터는 viewBox의 중앙~하단 60% 영역에 배치 (Y-baseline = 셀 하단 align)
- Output root: D:\Work\LAMDiceBot\assets\horse-race\sprites\lose\
- Preview tool folder: D:\Work\vibe\SpriteMake\output\horse-lose-poses-2026-05-05\tools\
- QA output folder: D:\Work\vibe\SpriteMake\output\horse-lose-poses-2026-05-05\qa\
```

## Required Output Per Asset

## Source 참조 (스타일 매칭 — 필수)

```text
8. Source 참조 (스타일 매칭 — 필수):
   - 메인 SVG 정의: D:\Work\LAMDiceBot\js\horse-race-sprites.js
     이 한 파일에 15종 모두 정의됨. 부스터/파워 variant가 아닌 기본 svgMap 차량 위치:
       car: L3 | rocket: L49 | bird: L91
       boat: L135 | bicycle: L169 | rabbit: L217
       turtle: L275 | eagle: L315 | scooter: L363
       helicopter: L405 | horse: L463 | knight: L886
       dinosaur: L1267 | ninja: L1677 | crab: L2027
     각 차량 객체 안에 idle/run/finish/victory state가 있음.
     run state의 frame1 SVG 마크업을 스타일 reference로 사용.
     POWER_VEHICLE_VARIANT_OVERRIDES / booster 이미지는 사용하지 않음.

   - 추가 참고 PNG (톤 reference 만):
     D:\Work\LAMDiceBot\assets\backgrounds\vehicle-flat\horse.png
     D:\Work\LAMDiceBot\assets\backgrounds\vehicle-generated\horse.png

   주의: 인라인 SVG는 viewBox 0 0 25 25 또는 0 0 60 45 등 차량마다 다름.
   생성될 lose PNG는 모두 60x45 (단일 셀) / 120x45 (2 frame atlas) 통일.
```

각 자산은 다음을 포함:

```text
- strict atlas PNG (2-frame side-by-side): {vehicleId}-lose.png
- 또는 단일 정지 프레임 PNG: {vehicleId}-lose-static.png (애니메이션 불필요시)
- manifest entry: { vehicleId, state: 'lose', frames: 2, cellSize: [60, 45], anchor: ... }
- target game asset path: assets/horse-race/sprites/lose/{vehicleId}-lose.png
- source/reference path: existing SVG (js/horse-race-sprites.js 의 해당 vehicleId run state)
- contact anchor: 셀 하단 중앙 (x=30, y=45)
- Y-axis baseline: 차량 발/바닥 끝점이 셀 하단(y=45)에 닿음
- row meanings: row 0 = lose pose
- column meanings: col 0 = pose A (예: 한숨), col 1 = pose B (예: 고개 숙임) — 2프레임 0.6s 루프
- alpha bbox report
- per-cell bbox report
- preview HTML (단일 차량별 frame loop)
- QA notes
```

## Pose 공통 규칙

모든 차량 lose 자세는 다음 중 하나(또는 조합):

```text
A. 무릎 꿇기 / 자세 낮춤 (해당되는 차량: horse, knight, ninja, dinosaur, eagle, rabbit, turtle, crab)
   - 캐릭터가 살짝 주저앉거나 무릎 꿇음
   - 머리/목 살짝 숙임

B. 멈춰있음 + 기울기 (해당되는 차량: car, rocket, boat, bicycle, scooter, helicopter, bird)
   - 차체가 살짝 기울어짐 (5~15도)
   - 엔진/바퀴/날개 정지
   - 약간 가라앉은 모습

공통 추가 효과 (모든 차량):
- 머리/차체 위에 작은 회색 한숨 구름 ☁️ 또는 💧 한 방울
- 눈이 있는 캐릭터: 눈을 ㅠ ㅠ 또는 가늘게 (sad eye) — 단순 픽셀 표현
- 채도 80% 정도로 낮춰진 팔레트
- 2프레임 애니메이션: frame0 = 기본 자세, frame1 = 살짝 통통 튀는 가벼운 변화 (위아래 1~2px 또는 한숨 구름 살짝 움직임)
```

## Batch Asset List (차량 15종)

각 차량마다 같은 cell size 60×45, atlas 120×45 (2 frames horizontal).

### 1. horse (말)

```text
Asset:
- ID: horse-lose
- Asset role: 패배(당첨자) 자세 — 무릎 꿇은 말 + 고개 숙임
- Generation provider: OpenAI Images API
- Required image model: gpt-image-2
- Target file path: assets/horse-race/sprites/lose/horse-lose.png
- Source/reference path: js/horse-race-sprites.js 내 'horse' run state 참조
- Animation tool path: output/horse-lose-poses-2026-05-05/tools/horse-lose.html
- Preview manifest path: output/horse-lose-poses-2026-05-05/manifests/horse-lose.json
- Asset type: sprite atlas (2-frame loop)
- Static image or sprite atlas: atlas
- Final canvas size: 120×45
- Grid columns: 2
- Grid rows: 1
- Cell size: 60×45
- Row meanings: row 0 = lose
- Column meanings: col 0 = 무릎 꿇음 + 고개 숙임 / col 1 = 한숨 (살짝 들썩)
- Contact anchor: (30, 45) — 발 바닥 셀 하단
- Contact anchor meaning: 트랙 지면 접점
- Y-axis baseline/source plane: 셀 하단 = 트랙 지면
- Player-readable purpose: "이 사람이 당첨자(벌칙자)" 시각화
- Visual direction override: 갈색/베이지 말, 갈기 헝클어짐, 눈은 ㅠㅠ 모양
- QA priority: high
```

### 2. rabbit (토끼)

```text
Asset:
- ID: rabbit-lose
- Asset role: 패배 자세 — 토끼 귀가 처지고 주저앉은 자세
- Target file path: assets/horse-race/sprites/lose/rabbit-lose.png
- Visual direction override: 흰색/회색 토끼, 양쪽 귀가 머리 옆으로 축 처짐, 한쪽 발 펴고 앉아있는 자세
- (나머지 필드는 #1 horse 동일)
```

### 3. turtle (거북이)

```text
Asset:
- ID: turtle-lose
- Asset role: 패배 자세 — 등껍질 안으로 머리·발 살짝 들어간 모습
- Visual direction override: 초록색 거북이, 머리·다리가 등껍질 안으로 절반쯤 들어감, 등껍질 위에 ☁️ 작은 구름
- (나머지 동일)
```

### 4. bird (새)

```text
Asset:
- ID: bird-lose
- Asset role: 패배 자세 — 날개 접고 가지에 앉은 듯 처진 모습
- Visual direction override: 파란/노란 작은 새, 양 날개 몸통에 붙임, 머리 살짝 숙임, 깃털 1개 떨어지는 효과
- (나머지 동일)
```

### 5. boat (배)

```text
Asset:
- ID: boat-lose
- Asset role: 패배 자세 — 가라앉기 시작한 배
- Visual direction override: 나무 보트, 한쪽으로 15도 기울어짐, 돛이 펄럭이지 않고 늘어짐, 작은 거품 ○○ 옆에
- (나머지 동일)
```

### 6. bicycle (자전거)

```text
Asset:
- ID: bicycle-lose
- Asset role: 패배 자세 — 자전거 옆으로 살짝 쓰러져 있고 라이더 한숨
- Visual direction override: 자전거가 약 10도 기울어짐, 라이더는 핸들 잡고 고개 숙임, 머리 위 💧
- (나머지 동일)
```

### 7. rocket (로켓)

```text
Asset:
- ID: rocket-lose
- Asset role: 패배 자세 — 분사 멈추고 비스듬히 떨어지는 로켓
- Visual direction override: 빨간 로켓, 5도 옆으로 기울어짐, 분사구에서 회색 연기 살짝 (분사 X), 측면에 작은 균열 표현 가능
- (나머지 동일)
```

### 8. car (자동차)

```text
Asset:
- ID: car-lose
- Asset role: 패배 자세 — 멈춰서 헤드라이트 꺼지고 운전자 한숨
- Visual direction override: 빨간색 컴팩트카, 정지 상태, 보닛 위에 작은 ☁️, 약간 처진 차체 (서스펜션 압축)
- (나머지 동일)
```

### 9. eagle (독수리)

```text
Asset:
- ID: eagle-lose
- Asset role: 패배 자세 — 날개 접고 시무룩한 독수리
- Visual direction override: 갈색/검정 독수리, 양 날개 몸통에 붙임, 부리 닫고 시선 아래로, 깃털 약간 헝클어짐
- (나머지 동일)
```

### 10. scooter (스쿠터)

```text
Asset:
- ID: scooter-lose
- Asset role: 패배 자세 — 스쿠터 멈춤, 라이더 한숨
- Visual direction override: 파란 스쿠터, 정지, 라이더 어깨 처짐, 헬멧 위에 💧
- (나머지 동일)
```

### 11. helicopter (헬리콥터)

```text
Asset:
- ID: helicopter-lose
- Asset role: 패배 자세 — 프로펠러 정지, 살짝 떨어지는 헬리콥터
- Visual direction override: 노란/검정 헬리콥터, 프로펠러 회전 X (정지), 살짝 비스듬히 (5도), 작은 검은 연기
- (나머지 동일)
```

### 12. knight (기사)

```text
Asset:
- ID: knight-lose
- Asset role: 패배 자세 — 검을 땅에 짚고 무릎 꿇은 기사
- Visual direction override: 은색 갑옷 기사, 한쪽 무릎 꿇음, 검 끝을 땅에 짚음, 투구 안 눈은 ㅠㅠ 또는 가늘게
- (나머지 동일)
```

### 13. dinosaur (공룡)

```text
Asset:
- ID: dinosaur-lose
- Asset role: 패배 자세 — 꼬리 늘어뜨리고 고개 숙인 공룡
- Visual direction override: 초록 공룡(티라노 풍), 짧은 앞발 살짝 들고, 꼬리 땅에 늘어짐, 머리 옆으로 살짝 숙임
- (나머지 동일)
```

### 14. ninja (닌자)

```text
Asset:
- ID: ninja-lose
- Asset role: 패배 자세 — 한쪽 무릎 꿇고 검 거꾸로 든 닌자
- Visual direction override: 검은 닌자복, 한쪽 무릎 꿇음, 두건 위 머리 약간 처짐, 표창/검은 거꾸로
- (나머지 동일)
```

### 15. crab (게)

```text
Asset:
- ID: crab-lose
- Asset role: 패배 자세 — 집게 늘어뜨리고 옆으로 주저앉은 게
- Visual direction override: 빨간 게, 양 집게가 옆으로 늘어짐 (위로 안 쳐듦), 다리 4개 살짝 굽힘, 머리 위 작은 거품 ○
- (나머지 동일)
```

## Batch Generation Rules

```text
Batch Rules:
- Use gpt-image-2 for image generation/editing requests.
- Do not silently substitute another image model; stop and report if gpt-image-2 is unavailable.
- 모든 차량 동일한 해상도/그리드/cellSize 유지 (60×45 셀, 2 frame atlas 120×45)
- 모든 차량 동일한 외곽선 굵기 (1~2px black) + 동일한 픽셀 스타일
- 채도 가이드: 각 차량 기본 색상의 hue 유지, saturation 약 75~80%로 통일 (기죽은 톤)
- 모든 차량 측면 뷰. 기존 차량 run state의 facing direction과 동일하게 (대부분 우측 보기)
- 머리 위 효과(💧 / ☁️)는 일관된 사이즈 (8x8px) 사용
- 2-frame loop은 0.6s (subtle, 격렬한 동작 X — 슬픈 호흡 정도)
- Do not change any target path after generation starts.
- Do not mix source/contact-sheet files with final game-ready atlas files.
```

## Output Folders

```text
output/horse-lose-poses-2026-05-05/prompts/        # 각 차량 생성 프롬프트
output/horse-lose-poses-2026-05-05/generated/      # 1차 생성물 (raw)
output/horse-lose-poses-2026-05-05/qa/             # bbox/alpha 검증
output/horse-lose-poses-2026-05-05/manifests/      # JSON manifest
output/horse-lose-poses-2026-05-05/tools/          # 미리보기 HTML
output/horse-lose-poses-2026-05-05/source/         # 참고 SVG/이미지
output/horse-lose-poses-2026-05-05/final/          # QA 통과 최종본
```

QA 통과 최종본은 `D:\Work\LAMDiceBot\assets\horse-race\sprites\lose\` 으로 복사.

## Manifest 통합 (받은 후 LAMDiceBot 측 작업)

```javascript
// js/horse-race-sprites.js 측 통합 예시
{
  'horse': {
    idle: { ... }, run: { ... }, finish: { ... }, victory: { ... },
    lose: {
      type: 'png-atlas',
      src: '/assets/horse-race/sprites/lose/horse-lose.png',
      cellSize: [60, 45],
      frames: 2,
      duration: 600  // 0.6s loop
    }
  },
  // ... 14 vehicles same pattern
}
```

서버 측: 결과 결정 시 타깃 등수 차량의 state를 `lose`로 broadcast (기존 finish/victory 분기에 추가).

## Batch QA Summary

```text
Batch QA Summary:
- Batch ID: horse-lose-poses-2026-05-05
- Asset count: 15
- Passed: __
- Needs regeneration: __
- Needs repack: __
- Needs manual cleanup: __
- Manifest updated: __
- Preview tools updated: __
- Ready for game integration: __
```

## 우선순위 / 일정

```text
- 1차 우선: horse, rabbit, turtle, dinosaur, knight (게임 빈도 높음)
- 2차: car, rocket, bird, ninja
- 3차: boat, bicycle, scooter, helicopter, eagle, crab
- 일정 목표: 1차 5종 우선 받아 통합 테스트 → 통과 후 2/3차 진행
```

## 통합 후 코드 변경 예정 위치

수신 후 LAMDiceBot에서 작업할 부분:
1. `js/horse-race-sprites.js` — 각 차량 객체에 `lose` state 추가 (PNG atlas 참조)
2. `js/horse-race.js` — `setVehicleState(state.horse, vid, 'lose')` 호출 추가:
   - 타깃 등수 말이 결승선 진입 + 슬로우모션 발동 시
   - 결과 오버레이 표시 시 (winner row 차량 아이콘)
3. `socket/horse.js` — endgame 데이터에 `loserVehicleId` 명시 (이미 raceData에 있음, 추가 변경 불필요)
4. CSS — 회색조 필터 효과 제거 (PNG 자체로 표현되므로 불필요)
