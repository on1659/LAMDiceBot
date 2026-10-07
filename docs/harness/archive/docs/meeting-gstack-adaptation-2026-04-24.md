# /meeting gstack Adaptation

> 작성일: 2026-04-24
> 참고 경로: `D:/work/vibe/gstack`

## 요약

`D:/work/vibe/gstack`의 plan review 계열 스킬을 참고해 LAMDiceBot의 `/meeting` 명령을 풀 기획 하네스로 승격했다.

이번 변경은 gstack 파일을 그대로 복사한 것이 아니라, LAMDiceBot의 기존 `.claude/skills/*`, `docs/harness/meeting-pipeline.md`, `docs/harness/agent-mapping.md`에 맞춰 얇게 포팅한 것이다.

## 적용한 gstack 원칙

| gstack 원칙 | LAMDiceBot 적용 |
|-------------|-----------------|
| `autoplan`의 단계형 리뷰 | `/meeting`을 Scope/CEO -> Planning -> Engineering -> Frontend -> Design -> QA -> PD Final Gate로 구성 |
| `plan-ceo-review`의 scope mode | Scope Expansion / Selective Expansion / Hold Scope / Scope Reduction을 PD 판단에 추가 |
| `plan-eng-review`의 architecture/test rigor | BE Gate에 Socket/DB/API, race condition, rollback, 공정성 영향 포함 |
| `plan-design-review`의 intentional responsive design | UI/UX Gate에 375px/768px/1920px, 상태 피드백, 접근성 포함 |
| `autoplan` decision classification | Mechanical / Taste / User Challenge 분류와 Decision Audit Trail 추가 |
| Review readiness habit | 회의록 저장 전 자체 형식 체크리스트 추가 |

## 변경 파일

| 파일 | 변경 |
|------|------|
| `.claude/commands/meeting.md` | 기본 `/meeting`을 gstack식 기획 하네스로 교체 |
| `.claude/commands/meeting-light.md` | 기존 1인 순차 회의 흐름을 경량 명령으로 보존 |
| `docs/harness/README.md` | `/meeting` 상태를 완료로 갱신 |
| `docs/harness/current-status-2026-04-13.md` | `/meeting` 하네스화 완료 상태 기록 |

## 명령 경계

| 명령 | 용도 |
|------|------|
| `/meeting` | 기본 기획 하네스. 회의록 + impl 문서까지 연결 |
| `/meeting-light` | 빠른 1인 순차 분석 |
| `/meeting-multi` | 기존 3인 병렬 회의 |
| `/meeting-team` | 팀원 프로필 기반 회의 |
| `/meeting-codex` | Claude x Codex 계획 토론 |
| `/build` | 구현 하네스. meeting 산출물 기반으로 실행 가능 |

## 의도적으로 하지 않은 것

- gstack 런타임 스크립트, telemetry, `~/.gstack` 로그, 업데이트 체크는 가져오지 않았다.
- 자동 커밋/푸시는 기본 `/meeting`에서 제거했다. 사용자가 요청하면 `/summitdocs`로 처리한다.
- 실제 외부 subagent 병렬 실행은 Claude 런타임에 맡기고, 명령 문서에는 역할별 필수 출력만 강제했다.
- `format-guard.sh`는 아직 추가하지 않았다. 현재는 `/meeting` 자체 점검 체크리스트로 대체한다.

## 남은 확장 후보

1. `format-guard.sh`: meeting 산출물에 필수 섹션이 빠졌는지 자동 경고.
2. Playwright MCP 연결: `/meeting` QA 제안이 `/build` QA 실행으로 자연스럽게 이어지도록 연결.
3. `/meeting-codex`와 `/meeting` 통합 옵션: User Challenge가 발생할 때 Codex 토론으로 넘기는 분기.
