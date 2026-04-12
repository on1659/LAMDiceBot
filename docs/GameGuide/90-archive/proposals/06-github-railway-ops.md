# Feature Proposal 06: GitHub + Railway 운영 자동화

> **주제**: 개발·배포·모니터링 파이프라인 구축
> **작성일**: 2026-01-31
> **상태**: 제안

---

## 배경

LAMDiceBot은 현재 GitHub 저장소에서 main 브랜치에 push하면 Railway가 자동으로 배포하는 구조입니다. AutoTest 디렉토리에 테스트 봇이 있지만 수동 실행이며, CI/CD 파이프라인이나 모니터링 체계가 없습니다. 서비스 중단 발생 시 감지가 늦고, 문제 발생 시 빠른 롤백이 어려운 상황입니다.

---

## Feature 1: GitHub Actions 자동 테스트

**기획자 🎯**: "어제 저녁에 배포했는데 오늘 아침에 보니까 룰렛이 안 돌아가더라고요. 사용자들이 밤새 불편했을 텐데... 이런 걸 미리 막을 수는 없나요?"

**프로그래머 💻**: "GitHub Actions로 자동 테스트를 돌릴 수 있어요. 지금 AutoTest 디렉토리에 있는 테스트들을 push나 PR 올릴 때마다 자동으로 실행하는 거죠. 실패하면 배포를 막을 수 있고요."

**기획자 🎯**: "그거 비용이 드나요? 우리 무료 플랜인데..."

**프로그래머 💻**: "GitHub의 무료 계정은 한 달에 2000분을 제공해요. 우리 테스트가 한 번에 5분 걸린다고 치면 하루에 10번 정도 push해도 월 300분밖에 안 써요. 그리고 배포 전에 문제를 잡으면 Railway 배포 시간도 아끼고, 사용자 불편도 없으니까 훨씬 이득이죠."

**기획자 🎯**: "좋네요! 그럼 테스트 실패하면 배포가 아예 안 되는 거죠? 그게 안전할 것 같아요."

**프로그래머 💻**: "네, Railway는 GitHub에서 보호된 브랜치 설정을 존중해요. main 브랜치에 'status checks 통과 필수' 규칙을 걸면, 테스트 실패 시 merge가 안 되고 당연히 배포도 안 됩니다."

### 구현 내용

```yaml
# .github/workflows/test.yml
name: AutoTest
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test  # AutoTest 실행
      - name: Test results
        if: failure()
        run: echo "::error::Tests failed - deployment blocked"
```

**예상 효과**:
- 배포 전 자동 품질 검증
- 버그 조기 발견 (배포 후 → 배포 전)
- 무료 티어로 충분한 사용량 (월 2000분)

---

## Feature 2: Railway Preview Environments

**프로그래머 💻**: "기획자님, 새로운 기능 개발할 때 미리 보고 싶으시죠? Railway에 Preview Environments 기능이 있어요."

**기획자 🎯**: "그게 뭔가요?"

**프로그래머 💻**: "PR을 올리면 그 PR만을 위한 임시 서버를 Railway가 자동으로 띄워줘요. 예를 들어 'feature/new-slot-game' PR을 올리면 `pr-123.up.railway.app` 같은 주소가 생기는 거죠. 기획자님이 직접 들어가서 테스트해보고 '이거 말고 저렇게 해주세요' 하시면 제가 코드 수정해서 push하면 그 미리보기 서버에 바로 반영돼요."

**기획자 🎯**: "오! 그럼 실제 서비스는 건드리지 않고 테스트할 수 있다는 거네요?"

**프로그래머 💻**: "정확해요. 실제 사용자는 main 브랜치(production)를 쓰고, 우리는 PR 환경에서 마음껏 실험하는 거죠. 확인 끝나면 merge하고, Railway는 그 PR 환경을 자동으로 정리해요."

**기획자 🎯**: "이것도 무료인가요?"

**프로그래머 💻**: "Railway 무료 티어는 월 5달러 크레딧을 주는데, Preview 환경도 사용량에 따라 과금돼요. 하지만 짧게 테스트하고 merge하면 몇 시간 단위라 비용이 적어요. 대신 PR 많이 동시에 열어두면 크레딧이 빨리 소진될 수 있으니 주의해야 해요."

### 구현 내용

```javascript
// railway.json (Railway 설정)
{
  "deploy": {
    "numReplicas": 1,
    "restartPolicyType": "ON_FAILURE"
  },
  "environments": {
    "production": {
      "branch": "main"
    },
    "preview": {
      "prDeploys": true
    }
  }
}
```

**운영 규칙**:
- PR 열면 자동 Preview 배포
- 테스트 완료 후 빠른 merge (비용 절감)
- 장기 보류 PR은 Draft로 (Preview 비활성화)

---

## Feature 3: 배포 롤백 전략

**기획자 🎯**: "지금 당장 서비스가 안 돼요! 5분 전에 배포한 게 문제인 것 같은데... 지금 당장 원복해주세요!"

**프로그래머 💻**: "(당황하며) 지금 바로 이전 버전으로 돌리는 방법이 세 가지 있어요. 첫째, Railway CLI로 `railway rollback` 명령어 쓰기. 둘째, Railway 대시보드에서 이전 배포 클릭해서 'Redeploy' 누르기. 셋째, GitHub에서 이전 커밋으로 revert하기."

**기획자 🎯**: "어느 게 제일 빨라요?"

**프로그래머 💻**: "긴급 상황에는 Railway 대시보드가 제일 빨라요. 클릭 두 번이면 끝이거든요. 하지만 이건 임시 조치고, 나중에 GitHub도 정리해야 해요. 근본적으로는 GitHub에서 revert 커밋을 만들어서 코드와 배포를 일치시켜야 합니다."

**기획자 🎯**: "그럼 평소에 뭘 준비해두면 좋을까요?"

**프로그래머 💻**: "안정적인 버전마다 Git tag를 달아두는 게 좋아요. `v1.2.3` 이런 식으로요. 그럼 나중에 '12월 15일 배포 버전으로 돌려줘'가 아니라 'v1.2.0으로 롤백해줘'라고 말할 수 있어요. 그리고 Railway에도 deployment history가 30일치 남아있어서, tag와 매칭해두면 정확한 롤백이 가능합니다."

**기획자 🎯**: "알겠어요. 그럼 중요한 배포마다 tag 달아달라고 부탁드려도 될까요?"

**프로그래머 💻**: "네, 그게 좋아요. 그리고 나중에 Feature 6에서 얘기하겠지만 이것도 자동화할 수 있어요."

### 롤백 절차

**긴급 롤백 (2분 이내)**:
1. Railway Dashboard → Deployments
2. 이전 정상 배포 선택 → "Redeploy"
3. Discord에 알림: "긴급 롤백 완료, GitHub 정리 필요"

**정식 롤백 (코드 일치)**:
```bash
# 문제 커밋 되돌리기
git revert <commit-hash>
git push origin main

# 또는 태그로 롤백
git reset --hard v1.2.0
git push origin main --force  # 주의: force push
```

**예방 조치**:
- 주요 버전마다 Git tag 생성
- 배포 전 staging 환경에서 테스트 (Feature 5)
- 점진적 배포 (canary, blue-green) - 향후 검토

---

## Feature 4: 서비스 모니터링 & 알림

**기획자 🎯**: "새벽 3시에 서버가 다운됐었대요. 아침에 출근해서 알았어요. 왜 갑자자 멈췄는지도 모르겠고..."

**프로그래머 💻**: "모니터링이 없으면 그럴 수밖에 없어요. UptimeRobot 같은 무료 서비스를 쓰면 5분마다 우리 서버를 핑 보내서 응답 없으면 알림을 보내줘요."

**기획자 🎯**: "그럼 새벽에 저한테 전화 오는 건가요...?"

**프로그래머 💻**: "(웃으며) 아뇨, Discord 채널에 알림 보내는 게 좋을 것 같아요. '#서비스-알림' 채널을 만들어서 거기로 보내면, 새벽에는 못 봐도 아침에 출근해서 바로 확인할 수 있죠. 급한 경우만 이메일이나 SMS 설정하고요."

**기획자 🎯**: "Railway 자체가 문제일 수도 있지 않아요?"

**프로그래머 💻**: "맞아요. Railway 상태 페이지(status.railway.app)도 모니터링에 넣으면 좋아요. Railway가 전체 장애면 우리가 할 수 있는 게 없으니까, 괜히 코드 뒤지지 않아도 되고요. 그리고 Railway 자체 알림도 설정할 수 있어요. 배포 실패, OOM 에러 같은 거요."

**기획자 🎯**: "비용은요?"

**프로그래머 💻**: "UptimeRobot 무료 플랜은 50개 모니터까지 5분 간격 체크가 가능해요. 우리는 게임 4개니까 충분하죠. Discord webhook도 무료고요. Railway 알림도 무료 기능이에요."

### 모니터링 구성

**UptimeRobot 설정**:
- `https://lamdicebot.up.railway.app/` (메인)
- `/dice-game-multiplayer.html` (다이스)
- `/roulette-game-multiplayer.html` (룰렛)
- `/horse-race-multiplayer.html` (경마)
- `/team-game-multiplayer.html` (팀전)

**알림 채널**:
- Discord Webhook → `#서비스-알림` 채널
- 중요도: DOWN/UP 이벤트만 (500 에러는 제외)
- Railway 알림: Deployment failed, Crashed, OOM

**모니터링 항목**:
- HTTP 200 응답 확인
- 응답 시간 (1초 이상 시 경고)
- Railway CPU/메모리 사용량
- WebSocket 연결 상태 (향후)

---

## Feature 5: 브랜치 전략 정립

**프로그래머 💻**: "지금은 main 브랜치에 직접 push하고 있는데, 이게 위험해요. 테스트 안 된 코드가 바로 production에 가니까요."

**기획자 🎯**: "그럼 어떻게 하면 좋을까요?"

**프로그래머 💻**: "Git Flow나 GitHub Flow 같은 브랜치 전략을 쓰는 건데, 우리는 작은 팀이니까 간단한 방식이 좋을 것 같아요. `develop` 브랜치를 만들고, 거기서 개발하고 테스트한 다음, 안정화되면 `main`으로 merge하는 거죠."

**기획자 🎯**: "그럼 develop은 누가 보나요?"

**프로그래머 💻**: "develop도 Railway Preview 환경으로 띄울 수 있어요. 개발자끼리는 develop 환경에서 테스트하고, 기획자님이 최종 확인할 때는 PR을 열어서 Preview 환경 보여드리고, 승인받으면 main으로 merge해서 production 배포하는 식이죠."

**기획자 🎯**: "main에는 아예 직접 push를 못 하게 할 수 있나요?"

**프로그래머 💻**: "네, GitHub의 Branch Protection 설정으로 가능해요. main 브랜치는 PR만 받고, 최소 1명 승인 필요, 테스트 통과 필수 이런 규칙을 걸 수 있어요. 그럼 혼자 작업해도 실수로 main에 push하는 걸 막을 수 있죠."

**기획자 🎯**: "좋네요. 그런데 우리 팀이 1-2명인데 승인자가 항상 있을까요?"

**프로그래머 💻**: "작은 팀이면 승인 필수는 빼고, 테스트 통과만 필수로 하는 게 현실적이에요. 대신 PR을 습관화하면, 나중에 코드 히스토리 보기도 좋고, 뭘 왜 바꿨는지 설명을 남길 수 있어요."

### 브랜치 전략

```
main (production)
  ↑ PR + 테스트 통과 필수
develop (staging)
  ↑ feature 브랜치들
feature/horse-race-scroll
feature/sound-system
fix/roulette-bug
```

**운영 규칙**:
- `main`: production 배포 전용, 직접 push 금지
- `develop`: 개발 통합 브랜치, Railway Preview 연결
- `feature/*`, `fix/*`: 기능 개발 브랜치

**Branch Protection (main)**:
- Require status checks to pass (GitHub Actions 테스트)
- Require pull request reviews: 선택 (팀 규모에 따라)
- Do not allow bypassing the above settings

---

## Feature 6: 자동 CHANGELOG & 릴리스

**기획자 🎯**: "사용자들한테 '이번 업데이트에서 뭐가 바뀌었어요'라고 알려주고 싶은데, 일일이 정리하기가 힘들어요."

**프로그래머 💻**: "Conventional Commits이라는 커밋 메시지 규칙을 따르면, 자동으로 CHANGELOG를 만들어주는 도구가 있어요. semantic-release 같은 거요."

**기획자 🎯**: "Conventional Commits이 뭔가요?"

**프로그래머 💻**: "커밋 메시지를 `feat:`, `fix:`, `docs:` 이런 식으로 시작하는 거예요. 예를 들어 `feat: 경마 게임 스크롤 기능 추가` 이렇게 쓰면, 이게 새 기능이라는 걸 알 수 있죠. 나중에 도구가 이걸 분석해서 '이번 버전의 새 기능은 이거, 버그 수정은 이거' 하고 정리해줘요."

**기획자 🎯**: "버전 번호는요? v1.2.3 이런 거..."

**프로그래머 💻**: "그것도 자동이에요. `feat`가 있으면 minor 버전 올리고 (1.2.0 → 1.3.0), `fix`만 있으면 patch 올리고 (1.2.0 → 1.2.1), `BREAKING CHANGE`가 있으면 major 올리는 (1.0.0 → 2.0.0) 식이죠. 그리고 GitHub Release도 자동으로 만들어줘요."

**기획자 🎯**: "오, 그럼 제가 할 일은요?"

**프로그래머 💻**: "main 브랜치에 merge만 하면 돼요. GitHub Actions가 자동으로 돌아가서 버전 올리고, CHANGELOG 업데이트하고, Release 만들고, Discord에 알림 보내는 것까지 다 해줍니다."

**기획자 🎯**: "완전 좋네요! 근데 우리가 지금까지 커밋 메시지를 막 썼는데..."

**프로그래머 💻**: "지금부터라도 규칙을 따르면 돼요. 그리고 commitlint라는 도구로 규칙 안 지키면 커밋을 막을 수도 있어요. 처음엔 불편하지만 금방 익숙해져요."

### 구현 내용

**Conventional Commits 규칙**:
```
feat: 새 기능 추가
fix: 버그 수정
docs: 문서 변경
style: 코드 포맷팅 (기능 변경 없음)
refactor: 리팩토링
test: 테스트 추가/수정
chore: 빌드, 설정 파일 수정
```

**semantic-release 설정**:
```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/changelog",
    "@semantic-release/github",
    "@semantic-release/git"
  ]
}
```

**GitHub Actions 워크플로우**:
```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npx semantic-release
```

**예상 결과**:
- 자동 버전 번호 생성 (Semantic Versioning)
- CHANGELOG.md 자동 업데이트
- GitHub Release 자동 생성
- Discord 릴리스 알림 (webhook)

---

## 우선순위 합의

**기획자 🎯**: "6가지 다 좋은데, 뭐부터 하면 좋을까요?"

**프로그래머 💻**: "중요도와 난이도를 생각해봤어요."

| 순위 | Feature | 중요도 | 난이도 | 예상 시간 | 무료 티어 |
|------|---------|--------|--------|-----------|----------|
| 1 | GitHub Actions 자동 테스트 | 높음 | 낮음 | 2시간 | ✅ 2000분/월 |
| 2 | 서비스 모니터링 & 알림 | 높음 | 낮음 | 1시간 | ✅ 50 monitors |
| 3 | 배포 롤백 전략 | 중간 | 낮음 | 1시간 | ✅ 무료 |
| 4 | 브랜치 전략 정립 | 중간 | 중간 | 3시간 | ✅ 무료 |
| 5 | Railway Preview Environments | 중간 | 낮음 | 1시간 | ⚠️ 크레딧 소모 |
| 6 | 자동 CHANGELOG & 릴리스 | 낮음 | 중간 | 4시간 | ✅ 무료 |

**기획자 🎯**: "1번이랑 2번은 꼭 해야겠네요. 배포 전에 테스트하고, 문제 생기면 바로 알아야 하니까."

**프로그래머 💻**: "네, 이 둘만 해도 서비스 안정성이 많이 올라가요. 3번 롤백 전략은 문서 정리 수준이라 같이 할게요. 4번 브랜치 전략은 팀이 커지면 필수인데, 지금 1-2명이면 급하진 않아요."

**기획자 🎯**: "5번 Preview는 비용이 걱정되네요."

**프로그래머 💻**: "무료 크레딧 5달러로 시작해보고, 부족하면 중요한 PR만 켜거나 로컬 테스트로 대체할 수 있어요. 6번 자동 릴리스는 나중에 사용자가 많아지면 해도 늦지 않아요."

**기획자 🎯**: "좋아요. 그럼 1→2→3 순서로 진행하고, 4는 개발자 분이 불편하시면 하는 걸로 해요!"

### 1단계: 즉시 적용 (이번 주)
- ✅ GitHub Actions 자동 테스트
- ✅ UptimeRobot + Discord 알림
- ✅ 롤백 절차 문서화

### 2단계: 점진적 도입 (다음 달)
- 🔄 브랜치 전략 정립 (develop 분리)
- 🔄 Railway Preview Environments (크레딧 모니터링)

### 3단계: 성장 대비 (3개월 내)
- ⏳ Conventional Commits 규칙 적용
- ⏳ semantic-release 자동화

---

## 비용 분석

### GitHub (무료)
- Actions: 2000분/월 (private repo)
- Storage: 500MB (artifacts)
- 예상 사용량: 월 300분 (하루 10회 테스트)

### Railway (무료 → 유료 전환 검토)
- 무료: $5 크레딧/월
- Hobby: $5/월 (usage-based)
- Preview 환경 1개: ~$0.5/월 (10시간 가동 기준)

### UptimeRobot (무료)
- 50 monitors, 5분 간격
- Alert channels: unlimited

### Discord (무료)
- Webhook: unlimited

**총 예상 비용**: $0/월 (무료 티어로 충분)
**유료 전환 시점**: 사용자 100명 이상 or Preview 환경 상시 가동 필요 시

---

## 리스크 & 대응

### 리스크 1: GitHub Actions 무료 시간 초과
- **확률**: 낮음
- **대응**: 테스트 최적화, 캐싱, 트리거 조건 제한

### 리스크 2: Railway 크레딧 소진
- **확률**: 중간 (Preview 환경 사용 시)
- **대응**: PR 빠른 merge, Draft PR 활용, Hobby 플랜 전환

### 리스크 3: 브랜치 전략 혼란
- **확률**: 중간 (팀 적응 필요)
- **대응**: 문서화, PR 템플릿, 점진적 도입

### 리스크 4: 모니터링 피로도
- **확률**: 낮음
- **대응**: 알림 임계값 조정, 중요 이벤트만 필터링

---

## 다음 단계

1. **이번 주 목표**:
   - GitHub Actions 테스트 워크플로우 작성
   - UptimeRobot 계정 생성 및 모니터 설정
   - Discord webhook 연결
   - 롤백 절차 문서화 (wiki or README)

2. **다음 달 검토 항목**:
   - 브랜치 전략 도입 여부
   - Railway Preview 환경 비용 모니터링
   - 테스트 커버리지 개선

3. **장기 로드맵**:
   - E2E 테스트 추가 (Playwright)
   - Staging 환경 분리 (Railway 유료 전환 시)
   - Blue-Green 배포 (무중단 배포)

---

## 참고 자료

- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Railway Preview Environments](https://docs.railway.app/develop/environments)
- [UptimeRobot 가이드](https://uptimerobot.com/help/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [semantic-release](https://github.com/semantic-release/semantic-release)
- [Git Flow vs GitHub Flow](https://www.gitkraken.com/learn/git/git-flow)

---

**기획자 🎯**: "이제 좀 안심이 되네요. 더 이상 새벽에 서버 다운되고 모르는 일은 없겠죠?"

**프로그래머 💻**: "네, 적어도 5분 안에는 알 수 있어요. 그리고 테스트로 배포 전에 잡을 수 있는 버그도 많이 줄어들 거예요. 완벽하진 않지만, 지금보다 훨씬 안전해질 겁니다."

**기획자 🎯**: "좋아요. 그럼 시작해봐요!"
