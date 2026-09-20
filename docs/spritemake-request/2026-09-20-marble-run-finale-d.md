# SpriteMake 의뢰: 마블런 4차 — 탈출 파이프·비석·틈 표시·통로 흙길 (4종 + fx 1)

작성일: 2026-09-20
요청자: LAMDiceBot 프로젝트
SpriteMake batch: `output/marble-run-finale-d-2026-09-20/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/pieces/` (fx 는 `assets/marble/fx/`) — 1~3차와 같은 트리
모델: gpt-image-2 고정 (대체 금지, 없으면 중단·보고)
규칙: 2차 의뢰서 §3(검증은 alpha≥8 bbox·md5, cp -p 금지, 파일명 뒤바뀜 주의)을 그대로 따른다. 1~3차 final 파일은 **절대 건드리지 않는다.**

> 게임: `docs/spritemake-request/applied/2026-09-19-marble-run-game-overview.md`
> 스타일: `docs/spritemake-request/applied/2026-09-19-marble-run-roll-creatures.md` (봄 초원, 4x 소스, 투명 PNG)
> 규칙 문서: `docs/goal/marble-escape-pipe.md`

---

## 1. 왜 4차인가

새 규칙 **탈출 파이프**가 들어갔다: 트랙 중간의 파이프 입구에 빨려 들어간 동물은 그 순간 도착(순위 확정)해 땅속으로 스탠드까지 간다.
파이프마다 정원이 있어 차면 뚜껑이 닫힌다. 여기에 아직 코드 도형으로 남아 있던 피날레 요소(꼴찌 비석·틈 표시·통로 흙길)를 함께 그린다.
코드는 이미 들어가 있고(코드 도형으로 그려짐), 에셋이 오면 그림만 교체한다.

```text
⑦   풍차 아래       탈출 파이프 2개 (좌우) — 풍차 날개에 튕겨 옆으로 간 동물이 먹힌다
⑦-c 갈래 골짜기     끊긴 경사로 아래 탈출 파이프 3개 (가로 한 줄)
⑩   통로 끝         꼴찌는 골 앞 판자벽 앞에 엎어지고 그 자리에 비석이 떨어진다
```

## 2. 에셋 목록 — 투명 PNG, 4x 소스 (1 표시px = 4 소스px)

| ID | 파일 | 소스 크기 | 프레임 | 물리 | 그림 지시 |
|---|---|---|---|---|---|
| pipe-mouth | pieces/pipe-mouth.png | 224×128 ×2 (448×128) | 2: 열림 / 닫힘 | 입구 폭 40 = 센서(코드), 양옆 기둥은 벽(코드) | 위에서 비스듬히 내려다본 **땅에 박힌 쇠 파이프 입구**. 프레임 1: 어두운 구멍이 보이는 열린 입구(안쪽으로 빨려드는 느낌의 파란 빛 한 줄). 프레임 2: 같은 입구에 **나무 뚜껑**이 덮인 상태. 입구 타원 표시 폭 ≈46, 테두리 포함 ≈56, 높이 ≈32. 기둥 두 개(표시 높이 12)는 그림 좌우 끝에 포함해도 되고 빼도 됨(코드가 3px 회색 막대로 그림). 하단 정렬(바닥선 = 캔버스 아래에서 소스 24px 위) |
| suck-swirl | fx/suck-swirl.png | 96×96 ×4 (384×96) | 4: 소용돌이가 조여듦 | 없음 | 파이프 입구 위 **파란/흰 소용돌이 선**. 1→4 로 갈수록 작고 진해진다. 코드가 동물을 회전·축소시키며 그 위에 겹친다(380ms). 중앙 정렬 |
| gravestone | pieces/gravestone.png | 128×160 | 1 | 없음 | 꼴찌 자리 **회색 돌 비석** — 둥근 머리, 받침돌, 살짝 기운 느낌은 금지(코드가 낙하 연출). 글자는 코드가 씀("꼴찌") → **비석 면은 비워 둔다**. 하단 정렬. 표시 크기 ≈32×40 |
| gap-mark | pieces/gap-mark.png | 176×48 | 1 | 없음(틈 자체는 벽의 빈 자리) | 끊긴 경사로·그릇 바닥의 "여기로 빠짐" 홈 — 어두운 가로 홈 + 흙 가장자리. 코드가 경사 각도(≈±19°)로 회전. 표시 44×12. 중앙 정렬 |
| lane-dirt | stage/lane-dirt.png | 256×240 | 1 | 없음 | 집결 통로 바닥 **흙길 타일**, 가로로 이어붙임(좌우 끝이 이어져야 함). 위아래 가장자리에 풀 경계선. 표시 64×60 |

## 3. 놓이는 자리 (코드 기준, 표시 px) — 그림 크기 판단용

- 파이프: 트랙 폭 500 안에 풍차 아래 y 2620 좌우(x≈230·570), 갈래 골짜기 y V+450 세 개(x≈230·400·570). 동물 공 지름 28. 입구 위 라벨 "탈출 N"/"닫힘"은 코드
- 비석: 통로 끝 골 선(x 700) 넘어 판자벽(x 745) 앞. 통로 높이 60
- 틈 표시: 끊긴 경사로(길이 ≈490, 틈 4개 폭 40) 위와 그릇 바닥(폭 46)
- 통로 흙길: x 150~745, 높이 60

## 4. 코드 연결점 (에셋 도착 시)

`js/marble-render.js`:
- `drawPieces` 안 `pieces.pipe` 블록 — 코드 도형(타원+테두리+기둥). `drawSprite('pieces', 'pipe-mouth', q.x, q.y, 224, 128, { sx: open ? 0 : 224, sw: 224, anchor: 'bottom' })` 로 교체, false 면 코드 도형 유지
- `drawFx` `case 'suck'` — 동물 회전·축소 위에 `drawSprite('fx', 'suck-swirl', …, { sx: frame * 96, sw: 96 })` 겹치기
- `drawGravestone` — 코드 도형 → `drawSprite('pieces', 'gravestone', …, { anchor: 'bottom' })` + 기존 "꼴찌" 글자 유지
- `pieces.zzhole` 블록 — 둥근 홈 → `gap-mark`, 회전은 기존 `h.angle`
- `pieces.lane` 블록 — 반투명 사각형 → `lane-dirt` 가로 타일 반복
`ASSETS.pieces / ASSETS.fx / ASSETS.stage` 에 키 추가. `assets/marble/marble-run.manifest.json` 에 `finaleD` 섹션.
