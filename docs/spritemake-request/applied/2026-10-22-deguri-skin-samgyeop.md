# 삼겹살 쌈 돼지 + 소주 풍선 (2026-10-22)

사용자 아이디어: 삼겹살 돼지에 쌈장을 바르고 몸 절반은 상추에 싸인 느낌 + 소주풍선. 시안 3개씩 중 이미지 기준 2번 채택(불판 사장님 / 소주잔).

| 항목 | 값 |
|---|---|
| 스킨 | `ribbonpig-samgyeop` "삼겹살 쌈" — epic 100 (불판 자국·쌈장·머릿수건·상추 = 새로 그린 것 3개 이상) |
| 풍선 | `deguri_balloon_soju` "소주 한 잔" — rare 50, `assets/deguri/accessories/balloon-soju.webp` |

## 진행 기록
- 시안: `SpriteMake/output/deguri-skin-ideas-samgyeop-2026-10-22/` (돼지 `p/`, 풍선 `b/`). 설명 글 번호와 그림 순서가 달라 사용자 "2번"이 모호했던 사고 → 스킬에 번호 규칙 추가.
- 시트: main/sleep/scuffle 각 attempt 01 채택(repack·qa PASS, verify ALL_OK, ball ROUND_OK). 시안 그림을 `ref/design.png` 로 main 의 세 번째 입력.
- 걷기: attempt 01. 둥둥라이더: hang 01 · blow 01 · fall 01 · poke 02(01 은 앞발 안 듦). hang·poke c0 "얇은 끈 없음" 메모는 그림 정상이라 그대로.
- 풍선: 시안 그림(소주잔)을 96×128 로 줄이고 외곽선 보강, 하드 에지. `make-balloons.py --verify` 통과. 줄·매듭은 시안의 것을 그대로 썼다.
- 상점 테스트 `qa-deguri-skin-shop-test.js` ALL PASS(풍선 10종 파일 존재 포함), 새 에셋 9개 200. 렌더러 프리뷰는 타임라인 JSON 이 없어 못 돌림.
