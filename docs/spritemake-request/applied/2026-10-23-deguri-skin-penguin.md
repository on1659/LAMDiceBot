# 데구리 펭귄 스킨 8종 (2026-10-23)

사용자 "펭귄도 컨셉 잡아서 레어·에픽·레전더리 등급당 3개씩" → 서기 시안 9장(배치 `deguri-skin-previews-cat-penguin-2026-10-23`)을 텔레그램 ⭕/❌ 버튼으로 보냄.
사용자 "민트(민트초코 펭귄) 빼고 다 만들어" → 8종 제작.

| 시트 | 이름 | 등급 | 근거 |
|---|---|---|---|
| penguin-gentleman | 신사 펭귄 | rare 50 | 작은 실크햇·나비넥타이 두 개 |
| penguin-swimmer | 물놀이 펭귄 | rare 50 | 색 + 물안경·스노클 두 개 |
| penguin-hockey | 하키 펭귄 | epic 100 | 헬멧·몸통을 덮는 유니폼·스틱 |
| penguin-chef | 요리사 펭귄 | epic 100 | 요리사 모자·앞치마·스카프·프라이팬 |
| penguin-mail | 우체부 펭귄 | epic 100 | 모자·우편 가방·편지 세 개 |
| penguin-icequeen | 얼음 황제 펭귄 | legend 150 | 왕관·망토·홀 + 가슴 편 자세 + 몸 전체 얼음빛 |
| penguin-jetpack | 로켓 펭귄 | legend 150 | 제트팩·비행 모자·목도리 + 앞으로 기운 자세·불꽃 |
| penguin-wizard | 마법사 펭귄 | legend 150 | 로브·고깔모자·지팡이 + 주문 거는 자세 |

## 진행 기록

- 생성: `scaffold-skin-batch.py penguin <skin>`, 시안을 `ref/design.png` 로 같이 넣음. 전설 3종은 row0 서기 4칸과 row3 c2·c3 만 새 자세. 손에 드는 소품(스틱·프라이팬·편지·홀·지팡이)은 서기 칸에만.
- 첫 실행 중 Codex 세션 8개가 외부 종료 신호(SIGTERM)로 끊김 → 신사·물놀이·하키·요리사는 이미 그린 시트를 살려 이어 그림(`CODEX-BRIEF-resume.md`), 나머지 4종은 처음부터 다시.
- 채택: 신사·물놀이·우체부 전부 attempt-01, 하키 main·scuffle attempt-02, 요리사 main·scuffle attempt-02, 얼음 황제 sleep·scuffle attempt-02, 로켓 scuffle attempt-02, 마법사 main·scuffle attempt-02(나머지 attempt-01).
- 보정: 신사·요리사·우체부·얼음 황제·마법사 공이 모자·왕관 때문에 몸통이 작음(지름 93~104) → `ball-round.py fix --recenter`(몸통 112·중심 80,80, 모자는 링 밖). 배치 QA ballGeometry 는 의도된 예외 → 인수 때 `--allow-fail=<sheet>-main`.
- 우체부는 recenter 뒤에도 모자 챙과 가방 사이(왼쪽 170°~240°)가 움푹해 최소 반지름 44 → 공 칸 6개(r1c3·r2c0~3·r3c0)를 똑같이 왼쪽으로 4px 옮겨 47(52 미만 방향 15/72)로 통과.
- 마법사 r3c2 standing-size 137×123 은 지팡이·별빛을 든 손짓 칸(의도).
- 걷기: 브리프에 "c0·c2 앞발 반대, c1·c3 다른 발 듦"을 덧붙임. 신사·물놀이·하키·요리사 attempt-01.
- 둥둥라이더(날짜 태그 `2026-10-23-pg`): 전부 리팩 OK, 재시도가 있었던 건 마지막 시도(신사 hang·poke 2, 물놀이 fall 2, 하키 hang·poke 3·blow 2, 요리사 poke 2). 하키 poke 는 스틱으로 찌름.
- 검증 예외: multi-run 은 공 위 모자·귀 끝 조각, 요리사 r0c0 프라이팬 손잡이(의도). 요리사 r3c0 standing-size 114×136 은 모자 쓴 공 칸(--recenter 결과).
- 우체부·얼음 황제·로켓·마법사: 걷기 attempt-01(얼음 황제는 망토가 다리 구역을 덮어 `same legs twice` 18%/26% — c1 뒷발·c3 앞발을 드는 걸음은 우체부와 같아 `--allow-fail`), 둥둥라이더는 마지막 시도(우체부 hang 2·poke 3, 얼음 황제 hang·poke 2, 마법사 poke 3, 나머지 1).
