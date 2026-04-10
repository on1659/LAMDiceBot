# Document Writing Rules

문서 작성/수정 시 읽을 것. 회의록 읽기는 사용자가 명시적으로 요청할 때만.

## 문서 구조

| 문서 종류 | 위치 | 성격 |
|-----------|------|------|
| 회의 기획 | `docs/meeting/plan/{single\|multi}/YYYY-MM-DD-{topic}.md` | 역사 기록, 변경 금지 |
| 구현 명세 | `docs/meeting/impl/YYYY-MM-DD-{topic}-impl.md` | Source of truth, 구현 세션에서 이것만 읽음 |
| 완료된 impl | `docs/meeting/applied/` | 구현 완료 후 impl에서 이동 |

## 회의록 ↔ impl 분리 원칙

- 회의록 = 역사 기록 (한국어, 변경 금지)
- impl = 구현의 source of truth (영문 또는 한국어, 구현 세션에서 이것만 읽음)
- 피드백 반영 → impl만 수정, 회의록은 건드리지 않는다
- 구현 완료 시: impl 파일을 `docs/meeting/applied/`로 이동

## 구현 추천 모델

- **Sonnet**: 플랜이 구체적 (파일/함수/위치 명시), 코드 작성 위주
- **Opus**: 설계 판단, 다파일 연계, 창의적 결정 필요

## 주의

- 사용자가 "이 회의록 봐줘" 하기 전까지 meeting/plan/ 파일은 읽지 않는다
- impl 문서 없이 구현 요청 + 파일 3개+ 또는 DB 변경 → impl 먼저 만들지 확인
