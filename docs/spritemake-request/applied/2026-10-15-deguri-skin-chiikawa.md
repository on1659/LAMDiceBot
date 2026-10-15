# 데구리 스킨 — 치이카와 느낌 6종 (판다·햄스터·토끼)

작성일: 2026-10-15 · 요청자: LAMDiceBot · 받기 경로: `assets/deguri/creatures/{sheet}{,-sleep,-scuffle,-walk}.webp`
분업: 그림 생성 = GPT(Codex exec), 판정·리팩·검증·인수 = Claude. 배치: `SpriteMake/output/deguri-skin-{sheet}-2026-10-15`, 걷기 `deguri-walk-2026-10-15/{sheet}`

## 디자인

사용자: "치이카와 스킨 — 너무 똑같으면 안 되고 비슷하게만, 동물은 알아서". 1차(분위기만)를 보고 "너무 안 닮았다" → "쟤도 쓰고 또 만들어 쓰자"로 1차 3종 + 더 닮게 그린 2차 3종을 함께 넣었다.
원화는 입력으로 넣지 않고 말로만 특징을 설명했다. 이름은 원작 이름을 쓰지 않는다(코인 상점 판매라 상표·저작권 위험 — 사용자에게 고지함).

| 시트 | 상점 이름 | 등급·가격 | 내용 | 등급 근거 |
|---|---|---|---|---|
| panda-mochi | 찹쌀떡 판다 | common 30 | 검은 무늬 → 뽀얀 흰색, 귀 안 분홍 | 색만 바꿈 |
| hamster-hachi | 갈래머리 햄스터 | common 30 | 머리·등 푸른 회색, 얼굴·배 흰색 | 색만 바꿈(八자 갈림은 그림에 안 나옴) |
| rabbit-yaho | 야호 토끼 | rare 50 | 버터 노랑 + 복숭아색 줄, 반짝 눈 + 크게 벌린 입 | 색 + 표정 |
| panda-malang | 말랑이 | rare 50 | (치이카와 쪽) 온몸 흰색, 작고 둥근 흰 귀, 까만 점 눈, ω 입, 빗금 볼 | 색 + 얼굴 |
| hamster-nyang | 냥냥이 | epic 100 | (하치와레 쪽) 흰 몸, 뾰족한 고양이 귀, 이마가 V 로 갈린 하늘색 머리 덮개, 빗금 볼, 웃는 입. 공 = 흰 공 + 하늘색 V 덮개 + 귀 끝 | 귀 모양·덮개 무늬·표정 — 새로 그린 것 3개 |
| rabbit-ura | 우라 토끼 | rare 50 | (우사기 쪽) 연노랑, 옅은 줄, 점 눈, 한껏 벌린 입 | 색 + 얼굴 |

## 진행 기록

- 도구: `scaffold-skin-batch.py` 에 햄스터(템플릿 `marble-run-skin-hamster-cookie-2026-09-22`)·토끼(`marble-run-skin-rabbit-tophat-2026-09-22`) 추가. 칸 순서 문장은 10-05 꿀벌 햄스터·화관 토끼 배치 프롬프트에서 가져왔다.
- 파이썬: brew 갱신(10-13)으로 `/opt/homebrew/bin/python3` 링크가 사라짐 → PIL 있는 `/opt/homebrew/bin/python3.14` 로 실행.
- 첫 Codex 실행은 세션 종료로 main 만 그린 채 끊김 → 남은 시트만 그리는 `CODEX-BRIEF-resume.md` 로 이어 그림.
- 채택: 전부 attempt-01, 단 **rabbit-yaho sleep 은 attempt-02**(01 은 잠든 c0·c1 이 눈 뜨고 소리침 → 눈 감은 얼굴로 다시).
- 배치 QA: 6종 모두 PASS / FRAGMENT-RUNS PASS / RIM PASS. `ball-round.py` 6종 ROUND_OK.
- `verify-creature.py` 남은 FAIL(전부 눈으로 확인하고 허용):
  - panda-mochi r3c0 · rabbit-yaho r3c0 · rabbit-ura scuffle r1c3: 한 줄에서 1px 틈으로 조각이 둘(기본 판다도 같은 종류 FAIL).
  - panda-malang r4c0: 부딪힘 표시선(기본 판다도 같음). hamster-nyang r0c0: 뾰족한 귀 두 끝(의도).
  - rabbit-ura 서기 106×131: 신사 토끼도 131.
  - 판다 두 종 r2c3 어지러운 공 몸통 폭 90: 꿀곰 89·구조대 97 과 같은 판다 스킨 공통 특성.
- 걷기 시트: 6종 attempt-01. rabbit-yaho 는 공중 칸(폭 146)이 칸 밖으로 안 나가게 4.7px 당겨져 `upper-body drift` FAIL → 뛰는 중 앞으로 나가는 정도라 `--allow-fail` 로 인수(기존 토끼 drift 1.3).
- 게임 webp 를 풀어 다시 검증: 양자화로 생긴 새 문제 없음. `qa-deguri-skin-shop-test.js` ALL PASS(카탈로그 40종 × 시트 4장 존재), `game-lab/deguri-preview.html` 에서 새 시트 24장 200 로드·구르는 공이 링을 채움.
