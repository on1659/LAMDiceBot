---
description: SpriteMake batch 인수 — final/ PNG를 게임 assets/로 옮기고 매핑 갱신
---

# /spritemake-pickup [batch-name]

SpriteMake `output/{batch-name}/final/` 폴더의 PNG를 LAMDice 게임 assets로 인수하고, 관련 매핑 파일을 갱신한 뒤, 의뢰서를 `applied/`로 이동한다.

## 사용

```
/spritemake-pickup vehicle-backgrounds-2026-05-19
```

batch-name 생략 시 `.claude/inbox/spritemake-done-*.md` 마커 파일에서 가장 최근 것을 자동 선택.

## 절차

이더(Ether) 트리아지: **STANDARD** (파일 복사 + JSON 갱신 + 검증 — 3파일 이상이지만 단순 작업)

1. **마커 확인**
   - `.claude/inbox/spritemake-done-{batch-name}.md` 읽기
   - 의뢰서 경로(`docs/spritemake-request/{date}-{topic}.md`)와 batch 폴더 경로 확인

2. **파일 넣기**
   - vehicle-backgrounds batch: `D:\Work\vibe\SpriteMake\output\{batch-name}\final\*.png` 를 assets 로 **복사하지 않는다**. PNG 마다 `pngquant --quality 90-98 --speed 1 --strip --nofs` → `cwebp -lossless -z 9` 로 변환해 `assets/backgrounds/{vehicle-id}.webp` 만 만든다(명령은 `docs/GameGuide/04-ops/image-assets.md` 도구 절, pngquant 가 exit 99 면 원본에 바로 `cwebp -lossless -z 9`). 손실 WebP·디더는 타일 이음새를 틀어지게 하므로 쓰지 않는다
   - 그 밖의 batch: `final\*.png` 를 대상 assets 폴더로 복사
   - QA 통과 안 된 PNG는 같은 폴더의 `QA.md` 보고서 보고 제외
   - 기존 파일과 충돌하면 사용자 확인 받기 (덮어쓰기 X) — vehicle-backgrounds 는 `assets/backgrounds/{vehicle-id}.webp` 기준
   - 해상도 검증: `node -e "..."`로 width/height가 의뢰서 명세와 일치하는지
   - **최적화(필수):** 복사한 PNG 에 `pngquant --quality 80-100 --speed 1 --strip --force --ext .png {files}` (품질 하한 실패 exit 99 면 `60-100` 으로 재시도 후 확대 비교). 기준·검증은 `docs/GameGuide/04-ops/image-assets.md`. 데구리 동물 시트는 `.webp` 무손실(`pickup-skin.py` 가 자동). 경마 레인 스트립은 위 첫 항목대로 이미 WebP 로 넣었으니 제외

3. **매핑 갱신** (vehicle-backgrounds batch의 경우)
   - `assets/vehicle-themes.json`의 각 차량 `backgroundImage`를 `/assets/backgrounds/{vehicle-id}.webp`로 1:1 갱신 (이 파일은 CRLF — 줄 단위 치환으로 고치고 파일 통째 재작성 금지)
   - 빠진 차량 없는지 확인 (car/rocket/bird/boat/bicycle/rabbit/turtle/eagle/scooter/helicopter/horse/knight/dinosaur/ninja/crab — 총 15종)

4. **검증**
   - `node -c js/horse-race.js` (문법)
   - `node -e "JSON.parse(require('fs').readFileSync('assets/vehicle-themes.json','utf8'))"` (JSON 유효성)
   - 사용자에게 브라우저 확인 체크리스트 제시:
     - 차량 선택 화면: 6 lane이 각각 다른 배경
     - 라운드 진행: parallax 반복 이음새 안 보임
     - 모바일 + PC

5. **의뢰서 이동**
   - `docs/spritemake-request/{date}-{topic}.md` → `docs/spritemake-request/applied/`
   - inbox 마커 삭제: `.claude/inbox/spritemake-done-{batch-name}.md`

6. **결과 보고**
   - 넣은 파일 수 (vehicle-backgrounds 는 .webp)
   - 갱신한 매핑 수
   - 검증 통과 여부
   - 사용자 다음 행동 (브라우저 확인 + git diff 검토)

## 주의

- 절대 기존 png(beach/forest/sky/road/ocean/expressway/space)를 덮어쓰지 말 것 — vehicle 이름과 일치하는 경우만 신규 추가
- vehicle-themes.json 갱신 전에 의뢰서 차량 매핑 표를 source of truth로 사용
- 검증 실패 시 절대 의뢰서를 applied/로 옮기지 말 것
- 사용자 확인 없이 git commit하지 말 것 (수동 검토 필요)
