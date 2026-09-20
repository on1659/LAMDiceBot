# SpriteMake 의뢰: 마블런 2차 — 첫 트랙 장치 6종 + 잠자는 동물 + 효과

작성일: 2026-09-20
요청자: LAMDiceBot 프로젝트
SpriteMake batch: `output/marble-run-track-b-2026-09-20/`
받기 경로: `/Users/radar/Work/LAMDiceBot/assets/marble/` (1차와 같은 트리 — `pieces/`, `creatures/`, `fx/`)
모델: gpt-image-2 고정 (대체 금지, 없으면 중단·보고)
1차 배치: `/Users/radar/Documents/Codex/2026-09-19/1/work/spritemake-project/output/marble-run-creatures-2026-09-19/` — 그 `FEEDBACK.md`의 교훈이 이 문서 §3에 규칙으로 들어가 있다. 1차 final 파일은 **절대 건드리지 않는다.**

> 게임이 뭔지 모르면 먼저: `/Users/radar/Work/LAMDiceBot/docs/spritemake-request/2026-09-19-marble-run-game-overview.md`
> 1차 컨셉·스타일: `/Users/radar/Work/LAMDiceBot/docs/spritemake-request/2026-09-19-marble-run-roll-creatures.md`

---

## 1. 왜 2차인가 — 트랙이 바뀌었다

1차 소품(풍차·시소·점프대·회전 원판 등)은 "지형"이었다. 디자인 회의 결과 첫 트랙은 **동물이 펴진다는 것**과 **꼴등을 뽑는 게임**이라는 점을 쓰는 장치 위주로 재편됐다. 최종 10구간:

```text
① 출발 깔때기   0-4s   전원 동시 웅크림 → 쏟아짐                       (1차 에셋)
② 말뚝밭        4-10s  파칭코                                            (1차 에셋)
③ 벌집 언덕    10-14s  벌집을 건드리면 벌 떼가 구역 안 전원을 밀어냄 → 스탬피드   ★ 신규
④ 햇볕 잔디    14-21s  느려진 동물이 펴져서 잠듦. 뒤에서 온 동물이 부딪혀야 깸.
                       맨 마지막 한 마리는 아무도 안 깨워줌 → 전원이 "일어나!"     ★ 신규
⑤ 비버 댐      21-28s  통나무 댐에 무리가 쌓임 → 무게로 터짐 → 한꺼번에 쏟아짐   ★ 신규
⑥ 희생 다리    28-33s  댐 직후 구덩이. 먼저 온 N마리가 빠져 펴진 채 바닥이 되고
                       나머지가 등을 밟고 건넘. M마리 지나면 깨어나 추격            ★ 신규
⑦ 나선         33-39s  뱀처럼 휘감겨 내려감                              (1차 울타리로 구성)
⑧ 진흙·시소    39-45s  카오스                                            (1차 에셋)
⑨ 마지막 문    45-50s  주기적으로 닫히는 셔터. 문 뒤에 남은 마리 = 꼴등 후보         ★ 신규
⑩ 응원석 결승  50-58s  골인한 동물이 길 양옆에 서서 손 흔듦, 마지막 한 마리 슬로모  (1차 펴짐 프레임)
```

관전 장치: **꼴찌 깃발** — 플레이어별 가장 뒤처진 한 마리에만 작은 깃발. 200마리 중 깃발 5~10개가 줄거리.

## 2. 에셋 목록

### 2-1. 장치 (`pieces/`) — 투명 PNG, 4x 소스 (1 표시px = 4 소스px)

트랙 채널 폭은 공 4개 = 표시 120px = 소스 480px. "채널을 가로지르는" 것은 이 폭에 맞춘다.

| ID | 파일 | 소스 크기 | 프레임 | 물리 | 그림 지시 |
|---|---|---|---|---|---|
| beehive | pieces/beehive.png | 96×128 ×2 (192×128) | 2: 평온 / 흔들림(벌 몇 마리 나옴) | 센서(트리거) | 나뭇가지에 매달린 노란 벌집, 줄무늬 층. 프레임 1은 살짝 기울고 구멍에서 벌 2~3마리 |
| sun-patch | pieces/sun-patch.png | 256×128 | 1 | 센서 구역 | 위에서 본 **햇볕 드는 잔디 조각** — 주변 초원보다 밝고 노란기, 민들레 2~3개, 햇살 점 몇 개. 가장자리는 부드럽게(경계 안 보이게) |
| beaver-dam | pieces/beaver-dam.png | 480×256 ×3 (1440×256) | 3: 온전 / 금 감 / 터짐 | 벽(셀 상단 가장자리) → 없음 | 채널 폭을 꽉 채우는 통나무 댐 (가로로 쌓인 통나무 + 나뭇가지). 프레임 2는 금·물 새어나옴, 프레임 3은 통나무들이 흩어져 튀는 순간. **폭 = 480 (가로 coverage ≥95%)**, 하단 정렬 — 파일럿 리뷰에서 128→256으로 변경 |
| beaver | pieces/beaver.png | 96×96 ×2 (192×96) | 2: 앉아 있음 / 놀람 | 없음(장식) | 댐 위에 앉은 작은 비버. 프레임 2는 두 손 들고 입 벌림 (댐 터질 때) |
| pit | pieces/pit.png | 480×160 | 1 | 센서 + 바닥 | 채널 폭 구덩이를 위에서 본 모습. 어두운 흙 바닥, 풀 난 가장자리. 동물들이 이 안에 누워 "다리"가 된다 |
| last-gate | pieces/last-gate.png | 128×96 ×4 (512×96) | 4: 닫힘 → 열림 | 벽(닫힘)/없음(열림) | **가로로 이어붙이는 타일**. 판자 셔터가 위로 올라감. 셀 좌우 끝이 이웃 셀과 이어져야 함 (1차 start-gate와 같은 규칙, 이건 판자문이라 구분됨) |
| flag | pieces/flag.png | 32×64 ×2 (64×64) | 2: 펄럭임 | 없음 | 나무 막대 + **흰 천** 삼각 깃발. 천은 순백(#FFFFFF)으로 — 코드가 플레이어 색으로 틴트 |

### 2-2. 잠자는 동물 (`creatures/{id}-sleep.png`) — 5종

햇볕 잔디·희생 다리에서 쓰는 **"펴져서 옆으로 누워 잠든" 포즈**. 1차 시트에 없다. 시트를 건드리지 않고 별도 4×1 스트립으로 만든다.

```text
파일: creatures/hedgehog-sleep.png, armadillo-sleep.png, pillbug-sleep.png, turtle-sleep.png, panda-sleep.png
4열 × 1행, 셀 160×160, 캔버스 640×160, 투명
col 0  누워서 잠 (눈 감음, 배 위로 또는 옆으로)
col 1  배 오르내림 (col 0에서 몸통 2~3px 부풀음)
col 2  깨어남 — 눈 번쩍, "!" 는 코드/fx
col 3  벌떡 일어나 앉음 (이 다음은 1차 시트 row 1 curl로 이어짐)
기준: 몸 바닥 y=150 (1차 서 있는 프레임과 같은 발바닥선), x 중앙 80
스타일 레퍼런스: 반드시 그 종의 1차 final 시트를 첨부 —
  /Users/radar/Work/LAMDiceBot/assets/marble/creatures/{id}.png
  (같은 색, 같은 외곽선 굵기, 같은 눈 스타일. 다른 캐릭터로 보이면 FAIL)
누운 몸의 가로 폭은 최대 140px — 잠든 동물은 물리에서 폭 35px(표시) 선분 장애물이 된다
```

### 2-3. 효과 (`fx/`) — 4열×1행 아틀라스

| 파일 | 셀 | 내용 |
|---|---|---|
| fx/bee-swarm.png | 128×96 | 벌 떼 구름 — 노랑·검정 점들이 뭉쳤다 퍼짐 4프레임. 구역 전체 위에 여러 개 겹쳐 쓴다 |
| fx/zz.png | 48×48 | "Z z" 떠오르는 4프레임 (작은 z → 큰 Z, 위로) |
| fx/wake.png | 48×48 | 깨어남 "!" + 작은 별 4프레임 |
| fx/dam-burst.png | 192×128 | 댐 터질 때 물보라 + 나무 조각 4프레임 |
| fx/cheer.png | 96×96 | 응원 — 작은 하트/별/음표 튀어오름 4프레임 (응원석 동물 머리 위) |

## 3. 규칙 (1차 FEEDBACK에서 확정된 것 — 전부 적용)

```text
스타일 잠금
- 레퍼런스 첨부 필수: /Users/radar/Work/LAMDiceBot/assets/marble/creatures/hedgehog.png (동물·톤),
  /Users/radar/Work/LAMDiceBot/assets/marble/pieces/log-bumper.png, fence-mid.png, goal-basket-back.png (소품 나무 질감)
- chunky 픽셀, 그 색의 어두운 톤 외곽선(순검정 X), 광택 1개. 부드러운 카툰/벡터/애니 눈 금지
- 나무·풀·흙·짚만. 금속·못·리벳·플라스틱 금지
- 플레이어 색·숫자·이름·그림자·텍스트 넣지 않음 (flag의 흰 천만 예외 — 틴트용)

생성 → 리팩
- 생성은 1024~2000px로 하고 규격 캔버스로 리팩한다 (리사이즈 금지 규칙 없음)
- 배경 제거는 네 모서리 flood-fill(ΔRGB ≤ 12). 색 기반 글로벌 키잉 금지 (1차 나무 캐노피 소실 사고)
- 마젠타 크로마키를 쓰면 경계 자주색 스필을 despill (경계 픽셀 중 r>g*1.4·b>g*1.4·|r-b|<60·g<120 → 이웃 색으로 교체, 2px). 자주 픽셀 < 0.5%
- 균등 배율만. 긴 축 coverage ≥ 85%. 바닥 있는 것은 하단 정렬, 구역/구덩이는 중앙
- alpha 1~7 픽셀은 0으로 (halo 0). 측정은 alpha ≥ 8
- 아틀라스: 캔버스 = 셀×프레임 수, 모든 셀 alpha bbox 비어 있지 않음, 셀 사이 격자선 없음
- 이어붙이는 타일(last-gate): 셀 좌우 끝 열이 이웃과 이어짐, 3장 이어붙여 검증 이미지 첨부
- 파일명 ↔ 내용 대조 (1차에서 stake 파일에 거북이 시트가 들어간 사고) — final 넣기 전 각 파일을 열어 내용 확인
- final/ 파일 mtime을 판단 근거로 쓰지 않는다. md5·bbox로만

순서
1. 파일럿: beaver-dam 3프레임 + hedgehog-sleep → LAMDiceBot 확인 (여기서 멈추고 보고)
2. 승인 후 나머지 장치 6 + sleep 4종 + fx 5
3. 마커: /Users/radar/Work/LAMDiceBot/.claude/inbox/spritemake-done-marble-run-track-b-2026-09-20.md
   (전 항목 PASS일 때만. 하나라도 FAIL이면 쓰지 않고 보고)
```

## 4. QA 보고 형식

```text
[beaver-dam]  1440x256 cells 3/3 nonempty  cell bbox widths c0 W c1 W c2 W (≥456)  halo 0  → PASS/FAIL
[last-gate]   512x96 cells 4/4  cell bbox widths c0 W c1 W c2 W c3 W  seam 3x: ok/ng  → PASS/FAIL
[sleep x5]    {id} 640x160 cells 4/4  body bottom y=150±2  width ≤140  style-match: ok/ng  → PASS/FAIL
[pieces]      beehive 192x128 | sun-patch 256x128 | beaver 192x96 | pit 480x160 | flag 64x64  cov/halo  → PASS/FAIL
[fx x5]       {id} WxH cells 4/4  purple N%  → PASS/FAIL
```

## 5. LAMDiceBot 측 후속 (의뢰 범위 밖, 참고)

- `config/marble/pieces.json`: beehive(센서), sun-patch(센서·속도 임계), beaver-dam(벽, 누적 N마리·무게 임계), pit(센서, N/M), last-gate(주기 벽), 잠든 동물 = 폭 35 선분
- 공정성: 모든 이벤트는 **구역 안 전원 동시 적용**. 마리 ID·주인을 읽는 코드 금지. 결과 화면 리플레이에 원인 라벨("낮잠 2.1초")
- 1차에서 안 쓰게 된 것: windmill-*, seesaw-*(⑧에서 계속 씀), ramp, start-gate(①에서 계속 씀), 나머지는 2번째 트랙용으로 보관

## Batch QA Summary

```text
Batch ID: marble-run-track-b-2026-09-20
Asset count: 장치 7 + sleep 5 + fx 5 = 17
Passed: __   Needs regeneration: __   Needs repack: __   Ready for game integration: __
```
