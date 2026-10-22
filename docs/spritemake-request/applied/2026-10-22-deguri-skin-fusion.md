# 데구리 섞기 스킨 8종 (2026-10-22)

사용자가 다른 게임의 "동물 + 과일·원소" 합체 캐릭터 스크린샷을 주며 "이런 느낌, 동물은 알아서" 요청.
시안 1차 5장 → 2차 15장 → 3차 15장(배치 `deguri-skin-ideas-fusion-2026-10-22`)을 텔레그램으로 보내고, 사용자가 동그라미 친 8종을 만들었다.
원작 그림은 입력하지 않고 특징만 글로 설명했다.

| 시트 | 이름 | 등급 | 근거 | 시안 |
|---|---|---|---|---|
| cat-dragonfruit | 용과냥 | epic 100 | 몸만 한 용과 꼬리 + 무늬·씨앗 | 2차 1번 |
| cat-ember | 불씨냥 | rare 50 | 색 + 불꽃 꼬리 끝·눈썹 | 1차 2번 |
| raccoon-ember | 불씨너굴 | epic 100 | 몸만 한 불꽃 꼬리 | 2차 4번 |
| hedgehog-icicle | 고드름도치 | epic 100 | 가시 전체를 얼음으로 새로 그림 | 2차 13번 |
| ribbonpig-ember | 불씨돼지 | rare 50 | 색 + 작은 불꽃 꼬리 | 3차 6번 |
| pufferfish-lava | 용암복 | epic 100 | 용암 가시·꼬리 + 중절모 + 불티(셋) | 3차 11번 |
| cat-lava | 용암냥 | epic 100 | 용암 꼬리·등 + 중절모 + 불티(셋) | 3차 12번 |
| cat-icicle | 고드름냥 | epic 100 | 얼음 귀 + 얼음 꼬리 + 고드름(셋) | 3차 15번 |

## 진행 기록

- 생성: `scaffold-skin-batch.py` 로 배치 8개, 시안을 `ref/design.png` 로 같이 넣음. 복어(템플릿 붕어빵복 배치)·고양이(기본 배치 creatures-m)를 스캐폴드에 새로 등록.
- 채택: 전부 attempt-01, 고드름도치 몸싸움만 attempt-02. 세 시트 의상 일치 확인.
- 보정: 불씨돼지 공이 불꽃 꼬리 때문에 납작(120×99) → `ball-round.py fix --recenter`(배치 QA ballGeometry 는 의도된 예외, 인수 때 `--allow-fail=ribbonpig-ember-main`). 용암복 가시 공 → `ball-round.py fix`.
- 검증 예외: multi-run 은 귀 끝·진흙·별·불티 조각(의도), 용암복 r3c0 standing-size 는 붕어빵복과 같은 퍼프볼 칸.
- 걷기: 불씨냥·불씨너굴은 attempt-02, 고드름냥은 attempt-03(같은 걸음 반복 → 번갈아 걷기 지시 추가). 나머지 attempt-01.
- 둥둥라이더 hang·blow·fall·poke 32장: 전부 리팩 OK, 재시도 있었던 건 마지막 시도.
- 확인: `qa-deguri-skin-shop-test.js` ALL PASS, 렌더러 프리뷰에서 새 시트 32장 200·경주 화면에 공으로 그려짐.
