# SpriteMake 의뢰: 데구리 돼지 기본 시트 — 리본 없는 그냥 돼지 (스킨 야간 작업 1번 배치)

작성일: 2026-09-22
요청자: LAMDiceBot 프로젝트 (docs/goal/marble-skins-all-creatures.prompt.md §1 "돼지가 기본, 리본은 스킨")
SpriteMake batch: `output/marble-run-skin-ribbonpig-base-2026-09-22/`
받기 경로: `assets/marble/creatures/ribbonpig{,-sleep,-scuffle}.png` — 현 v2(배치 I) 3장은 `ribbonpig-ribbon*` 스킨으로 옮기고 이 배치가 기본 시트가 된다
모델: gpt-image-2 고정. Codex 직접 생성은 unverified 후보로 `generated/`에만.
규칙: 9차 의뢰서 §3(프레임)·§4(리팩·QA) + 배치 K 도구(`tools/*_creatures_k.py`) 그대로.

## 1. 디자인 — v2 리본돼지에서 머리 리본만 뺀다

레퍼런스 = 게임의 현 `ribbonpig.png / -sleep / -scuffle`(v2). **같은 화풍·같은 연분홍 몸·같은 포즈·같은 점 눈·같은 꼬불 꼬리·같은 갈색 발굽.** 다른 건 하나: **머리 위에 아무것도 없다**(나비 리본 없음, 목 스카프도 없음). 공이 될 때도 리본 점 없이 그냥 분홍 공(꼬불 꼬리 혹 + 발굽 힌트만). 화들짝은 귀만 위로 튄다.

28px 구분: 분홍 원(위쪽 빨간 점 없음). 스킨 `ribbon`(v2)·`scarf`(v3)과는 리본 유무로 구분.

## 2. 진행 기록

- 2026-09-22 새벽 작성.
