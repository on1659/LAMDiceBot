---
paths:
  - "horse-app/**"
---

# Horse App Rules (React)

- 소스 수정 후 반드시 빌드: `cd horse-app && npm run build`
- `/horse-race` → dist 존재 시 React 앱, 없으면 레거시 HTML 폴백
- React/Vite/TypeScript 환경 — 루트 프로젝트와 별도 의존성

## 검증
- 빌드 성공 여부 확인 (`npm run build` 에러 없는지)
- `/horse-race` 접속 시 React 앱 정상 로드 확인 항목 제시
