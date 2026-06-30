# 사다리타기 v1 아카이브 테스트

이 폴더의 테스트들은 **사다리타기 v1**(6레인 픽 · 꽝/폭탄 포인터 · 단일 패자) 메커니즘용 브라우저 QA다.

2026-07-01 **v2(vibe-rework)** 로 메커니즘이 전면 교체되며 이 테스트들의 단언이 무효화되어 아카이브했다.

## v1 → v2 메커니즘 변경 요약
- (v1) 인원에 묶인 6레인 + 본인 레인 픽 + 꽝/폭탄 포인터로 정해지는 **단일 패자**
- (v2) 인원과 무관한 **추상 칸 2~8** + 협업 위/아래 라벨 편집 + 서버 **셔플 순열 + physical-descent 매핑**으로 정해지는 **중립 매핑 결과**(강제 패자 없음). sequential(living-rungs 변형) / simultaneous 하강 토글.

이 변경으로 v1 테스트가 단언하던 6레인 점유(`.taken`/`.mine`), 레인 픽(`pickLane`/`userLanes`), 꽝/폭탄 포인터(`bombRevealed`/`losingLane`/💀), "패자 항상 1명" 같은 가정이 신규 UI/프로토콜에 더 이상 존재하지 않는다.

## 아카이브된 파일
- `ladder-edge-qa.js` — 엣지케이스 QA
- `ladder-hidden-reveal-qa.js` — 결과 마스킹/공개 QA
- `ladder-motion-qa.js` — 하강 모션 QA
- `ladder-multitab-bot.js` — 멀티탭 봇 QA
- `ladder-result-transition-qa.js` — 결과→다음판 전환 QA
- `ladder-static-qa.js` — 정적 화면 QA

## 신규 검증
v2 메커니즘 검증은 **`tests/test-ladder.js`**(소켓 프로토콜 테스트, 헤드리스 — 브라우저 불필요)로 한다.
서버 계약(setColumns/setLabel/setDescentMode/addRung 예산·cap, 시작 게이트, reveal 공정성 byte-identical, C-20 마스킹)을 직접 검증한다.

참고: `docs/goal/ladder-vibe-rework.md`
