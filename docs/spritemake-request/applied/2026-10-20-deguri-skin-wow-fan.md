# 데구리 스킨 — 와우 팬 맞춤 5종 (돼지 3·거북이·판다)

작성일: 2026-10-20 · 요청자: LAMDiceBot · 받기 경로: `assets/deguri/creatures/{sheet}{,-sleep,-scuffle,-walk}.webp` + `assets/balloon/creatures/{sheet}-{hang,blow,fall,poke}.webp`
분업: 그림 생성 = GPT(Codex exec), 판정·리팩·검증·인수 = Claude. 배치: `SpriteMake/output/deguri-skin-{sheet}-2026-10-20`, 걷기 `deguri-walk-2026-10-20/{sheet}`, 둥둥라이더 `balloon-{kind}-2026-10-20/{sheet}`

## 디자인

사용자: "30대 중반 남자, 주로 하는 게임 와우, 술 좋아하고 과묵한 성격, 고추장불고기 돼지 스킨을 너무 좋아함 — 좋아할 만한 스킨 5개쯤 만들어 텔레그램으로 승인/비승인 받아".
1차로 돼지 5종을 냈더니 "좋아하는 스타일이 고추장불고기인 거지 돼지만 만들라는 게 아님" → 다른 동물 5종을 더 냈다(고추장불고기는 스타일 참고 2번 입력으로만).
후보 10종은 서기 한 칸 미리보기로 텔레그램에 보내 버튼으로 받았다. 와우는 말로만 분위기를 설명했고 원화는 넣지 않았다.

| 시트 | 상점 이름 | 등급·가격 | 내용 | 등급 근거 |
|---|---|---|---|---|
| ribbonpig-brewmaster | 양조사 돼지 | epic 100 | 삿갓·주황 조끼와 어두운 띠·등의 나무 술통, 반쯤 감은 눈과 볼터치. 공 = 조끼 띠만 | 삿갓·조끼·술통 — 새로 그린 것 3개 |
| ribbonpig-frostknight | 서리기사 돼지 | legend 150 | 얼음 가시 강청색 판금·뿔 투구·해진 남색 망토·등의 검, 얼음빛 눈·푸른 회색 피부. 공 = 갑옷 판 + 얼음 징 | 몸 전체가 새 그림(피부·갑옷) + 공이 갑옷 공 |
| ribbonpig-orc | 오크 전사 돼지 | epic 100 | 올리브색 피부·엄니·검은 상투·붉은 전투 무늬·털 어깨 갑옷·등의 양날 도끼. 공 = 올리브 공 + 가죽끈 + 상투 | 엄니·상투·갑옷·도끼 — 3개 이상 |
| turtle-beer | 생맥부기 | rare 50 | 호박색 맥주 등딱지에 거품 방울 점, 위에 흰 거품 | 색·무늬 + 거품 하나 |
| panda-gourd | 취권판다 | rare 50 | 발그레한 볼·반쯤 감은 눈, 빨간 머리띠(꼬리 둘), 허리의 호리병 | 머리띠·호리병 두 개 |

비승인(만들지 않음): 용암불고기 돼지, 한잔 돼지, 서리도치, 초록불 너구리, 번개복.

## 진행 기록

- 미리보기: `deguri-skin-previews-{pig,mix}-2026-10-20/s1..s5` — 기본 시트 row 0 한 칸 ×4 nearest 를 1번 입력, 1세션 1장. 10종 전부 첫 시도 정상.
- 본 배치: `scaffold-skin-batch.py` 스캐폴드 뒤 main 프롬프트에 승인 미리보기(`ref/<sheet>-approved.png`)를 2번 입력으로 추가 — 승인받은 얼굴·옷 그대로 그리게.
- 채택(원본 직접 판정, Codex 선택과 같음): brewmaster main a01·sleep a01·scuffle a02 / frostknight 전부 a01 / orc 전부 a01 / turtle-beer main a02·sleep a01·scuffle a01 / panda-gourd main a02·sleep a01·scuffle a02.
- 배치 QA: 5종 모두 PASS / FRAGMENT-RUNS PASS / RIM PASS.
- ribbonpig-orc 공: 상투 때문에 NOT ROUND(최소 반지름 37) → `ball-round.py fix --recenter`(몸통 지름 112·중심 80,80, 상투는 링 밖). 배치 QA `ballGeometry`·verify 공 bbox 중심 BAD 는 상투가 bbox 에 들어간 의도된 예외 → `--allow-fail=ribbonpig-orc-main`.
- `verify-creature.py` 남은 FAIL(기본 시트와 같은 종류라 허용): brewmaster 서기 r0c3 폭 135(삿갓, 기본 돼지 r3c2 136), panda-gourd 서기 r0c2 높이 136('!' 표시, 기본 판다 138). turtle-beer green rim 은 거북 피부색(기본 거북 74.8%).
- 걷기 시트: 5종 attempt-01, 전부 OK(drift ≤ 0.7, legs A/B 26~51%). 서기 4칸과 나란히 놓고 옷·방향·크기 확인.
- 게임 webp 를 풀어 다시 검증: 양자화로 생긴 새 문제 없음, 5종 ROUND_OK.
- 둥둥라이더 자세 4장(1-D, `balloon-sheet.py scaffold-skin` — 5종 모두 dress: 기본 동물 자세 시트 1번 입력 + 스킨 main 2번 입력). Codex 5개씩 동시(`SpriteMake/output/skin5-balloon-run.sh`).
  - hang: 5종 attempt-01, 전부 OK. `c0 no thin rope at the top`(폭 13~16) 메모는 끈 쥔 앞발 — 눈으로 끈 꼭지 쥔 것 확인.
  - blow: brewmaster a02(a01 은 네 발로 웅크림 — 기본은 두 발로 섬), orc a03(a01·a02 꼬리 두 개), 나머지 a01.
  - fall: brewmaster a03 · frostknight a02 · orc a03 · turtle-beer a02 · panda-gourd a01(허우적 자세라 팔다리 작은 차이는 허용, 기본 자세에 가장 가까운 것).
  - 입 위치(blow 꼭지 끝): 렌더러 `MOUTH` 는 동물별 값이라 스킨도 기본 동물 값을 쓴다 — 새 스킨의 꼭지 끝은 4~9px 차이(turtle-beer (148,109) vs 거북 (146,100) 이 가장 큼). 기존 스킨과 같은 방식이라 코드 수정 없음.
  - poke: brewmaster a02 · frostknight a02 · orc a03 · turtle-beer a01 · panda-gourd a03. 돼지 셋은 a01 이 옆으로 누운 자세(끈 쥔 팔이 안 보임)라 끈을 쥔 팔이 서 있는 시도로, 판다는 기본처럼 끈을 들고 대나무로 찌르는 a03.
- 확인: `qa-deguri-skin-shop-test.js` ALL PASS(카탈로그 87종), `game-lab/deguri-preview.html` 새 시트 20장 200·구르는 공이 링을 채움, `game-lab/balloon-preview.html` 에서 다섯 스킨으로 경기 — 둥둥라이더 자세 20장 200, 매달림·떨어짐 화면에서 스킨 유지.
