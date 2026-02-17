# Archive Index - 2026년 2월

완료된 PDCA 사이클 문서 보관소

---

## ui-color-system

**완료일**: 2026-02-17
**Match Rate**: 100%
**반복 횟수**: 4회 (Do) + 5회 (Check)

### 요약
Material Design 기반 CSS Variable 색상 시스템 구현. 769개 UI 색상을 163개 CSS 변수로 통합. 2단계 아키텍처(전역 + 게임별) 도입.

### 주요 성과
- 1,061+ CSS variable 참조 구현
- 18개 파일 수정 (14 HTML, 3 CSS, 1 JS)
- 의미론적 버튼 색상 통일
- 게임 타입 식별 시스템 구축
- FOUC 방지 적용 (14개 페이지)

### 기술 스택
- Material Design Color Palette
- CSS Custom Properties
- Two-tier Architecture (global + game-specific)

### 문서
- [회의록](./ui-color-system/2026-02-17-ui-color-system.md)
- [구현 계획](./ui-color-system/2026-02-17-ui-color-system-impl.md)
- [분석 보고서](./ui-color-system/ui-color-system.analysis.md)
- [완료 보고서](./ui-color-system/ui-color-system.report.md)

### 다음 단계
- Phase 2: Lighthouse 접근성 감사 (목표: 90+점)
- Phase 3: 다크 모드 구현

---

## game-room-controls-ux

**완료일**: 2026-02-17
**요약**: 게임 방 내부 컨트롤 UX 개선

### 문서
- [구현 문서](./game-room-controls-ux/)

---

## ux-improvement

**완료일**: 2026-02-16
**요약**: 주사위 버튼, 경마 채팅 오버레이, 터치 최적화 등 UX 개선

### 문서
- [구현 문서](./2026-02-16-ux-improvement-impl.md)

---

## horse-unbetted-stop

**완료일**: 2026-02-18
**요약**: 경마 배팅 안 된 말 출발선 정지 처리

### 문서
- [구현 문서](./2026-02-18-horse-unbetted-stop-impl.md)

---

## game-ux-unification

**완료일**: 2026-02-18
**요약**: 전 게임 UX 통일 (컨트롤바, 로딩화면, 히스토리, 채팅). 로비/방관리는 index.html에서 이미 통합되어 있어 제외.

### 문서
- [구현 문서](./2026-02-17-game-ux-unification-impl.md)

---

## 통계

| 항목 | 값 |
|------|---:|
| 완료된 기능 | 5 |
| 총 문서 수 | 8 |
