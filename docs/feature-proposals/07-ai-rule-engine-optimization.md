# 07. AI 룰 엔진 최적화 - "Gemini 호출 없이 즉시 판정"

**작성일**: 2026-01-31
**상태**: 제안
**우선순위**: 🔥 긴급 (사용자 경험 직접 영향)

---

## 배경

LAMDiceBot의 주사위 게임은 커스텀 룰 기능을 위해 Gemini/GPT API를 사용합니다.
**현재 문제**: 매 게임 결과 판정마다 Gemini API를 호출 → 네트워크 왕복 + AI 추론 = 2~5초 지연

**현재 흐름**:
```
플레이어 주사위 굴림 → 서버가 결과+커스텀 룰 텍스트를 Gemini로 전송
→ Gemini가 승자 판단 → 결과 표시 (총 2-5초)
```

즉시 보여야 할 결과가 몇 초씩 지연되어 사용자들이 답답함을 느낍니다.

---

## 대화 1: 프리셋 룰 엔진 구축

**기획자 🎯**: "왜 결과가 이렇게 느려요? 사용자들이 답답해한다는 피드백이 계속 들어와요."

**프로그래머 💻**: "지금은 매번 Gemini API를 호출해서 그래요. 네트워크 왕복에 2초, AI 추론에 1~3초 걸립니다."

**기획자 🎯**: "그럼 왜 매번 물어봐요? 가장 많이 쓰는 규칙이 뭐예요?"

**프로그래머 💻**: "사실 90%는 '높은 수 승리', '낮은 수 승리', '홀짝', '합계 비교' 이 네 가지인데... 이걸 매번 AI한테 물어보고 있어요."

**기획자 🎯**: "그럼 그 네 개는 서버에서 직접 판정하면 되잖아요?"

**프로그래머 💻**: "맞습니다! 프리셋 룰 엔진을 만들면 됩니다. 예를 들어:"

```javascript
// 프리셋 룰 엔진 (로컬 판정, 즉시 처리)
const presetRules = {
  'highest': (results) => Math.max(...results.map(r => r.value)),
  'lowest': (results) => Math.min(...results.map(r => r.value)),
  'sum': (results) => results.reduce((a, b) => a + b.value, 0),
  'odd_even': (results) => results[0].value % 2 === 0 ? 'even' : 'odd',
  'closest_to': (results, target) => {
    return results.reduce((closest, r) =>
      Math.abs(r.value - target) < Math.abs(closest.value - target) ? r : closest
    );
  }
};
```

**기획자 🎯**: "이렇게 하면 얼마나 빨라져요?"

**프로그래머 💻**: "비교해보죠:
- **현재 (Gemini API)**: 2,000 ~ 5,000ms
- **프리셋 로컬 판정**: < 5ms (400~1000배 빠름)

즉시 결과가 나타나는 것처럼 느껴질 겁니다."

---

## 대화 2: AI→JSON 룰 변환 시스템

**기획자 🎯**: "그럼 커스텀 룰은 어떡하죠? '주사위 3개 합이 15 이상이면 승리' 같은 건?"

**프로그래머 💻**: "Gemini를 완전히 빼는 게 아니라 '역할 변경'입니다. Gemini는 룰 **생성**에만 쓰고, 자연어를 JSON 규칙으로 한 번 변환합니다."

**기획자 🎯**: "구체적으로 어떻게 되는 건가요?"

**프로그래머 💻**: "이런 식입니다:

**1단계 (최초 1회만, Gemini 사용)**:
```
사용자 입력: '주사위 3개 합이 15 이상이면 승리'
↓ Gemini 변환
JSON 룰: {
  type: 'sum',
  operator: '>=',
  value: 15,
  diceCount: 3
}
```

**2단계 (이후 모든 판정, 로컬 엔진)**:
```javascript
function evaluateRule(rule, results) {
  switch(rule.type) {
    case 'sum':
      const sum = results.reduce((a, b) => a + b.value, 0);
      return compare(sum, rule.operator, rule.value);
    // ... 다른 타입들
  }
}
```

한 번 변환하면 이후 같은 룰로 100번 게임해도 AI 호출 0번입니다."

**기획자 🎯**: "오! 그럼 첫 게임만 느리고 나머지는 빠른 거네요?"

**프로그래머 💻**: "정확합니다. 그리고 변환된 룰을 DB에 저장하면 다른 사용자도 즉시 사용 가능합니다. 결국 자주 쓰는 패턴은 전부 프리셋처럼 빨라집니다."

---

## 대화 3: 룰 캐싱 & 재사용

**프로그래머 💻**: "그래서 룰 캐싱 시스템이 필요합니다. PostgreSQL에 변환된 룰을 저장하죠."

**기획자 🎯**: "메모리에 캐싱하면 안 돼요? DB는 느리잖아요."

**프로그래머 💻**: "Railway는 ephemeral filesystem이라 서버 재시작하면 메모리 캐시가 날아갑니다. 그래서 2단계 캐싱이 필요해요:

```javascript
// 1차: 메모리 캐시 (가장 빠름, 휘발성)
const ruleCache = new Map();

// 2차: PostgreSQL (영구 저장)
CREATE TABLE custom_rules (
  id SERIAL PRIMARY KEY,
  rule_text TEXT UNIQUE,      -- '주사위 3개 합이 15 이상이면 승리'
  rule_json JSONB,            -- { type: 'sum', operator: '>=', ... }
  usage_count INTEGER,        -- 사용 횟수
  created_at TIMESTAMP,
  last_used TIMESTAMP
);
```

**판정 흐름**:
1. 메모리 캐시 확인 → 있으면 즉시 반환 (5ms)
2. PostgreSQL 확인 → 있으면 메모리에 올리고 반환 (50ms)
3. 없으면 Gemini 호출 → 변환 → 양쪽 캐시에 저장 (2000ms)
"

**기획자 🎯**: "그럼 실제로 Gemini 호출은 얼마나 줄어들까요?"

**프로그래머 💻**: "베타 데이터 분석해보니 사용자들이 평균 10개 정도의 룰만 반복 사용해요. 즉:
- **첫 10게임**: Gemini 호출 10회 (룰이 다를 때마다)
- **이후 990게임**: Gemini 호출 0회 (캐시 히트)
- **API 호출 감소**: 99% 절감"

**기획자 🎯**: "와, 그럼 API 비용도 거의 안 나오겠네요!"

---

## 대화 4: 룰 템플릿 마켓

**기획자 🎯**: "아이디어가 하나 있는데요. 인기 있는 커스텀 룰을 '템플릿'으로 제공하면 어때요?"

**프로그래머 💻**: "좋은데요! UGC 생태계를 만드는 거네요. 사용자가 룰을 만들면 공유하고, 다른 사람들이 '좋아요' 누르고..."

**기획자 🎯**: "맞아요! '이번 주 인기 룰 TOP 10' 같은 걸 보여주고, 클릭 한 번으로 적용되게요."

**프로그래머 💻**: "구현은 간단합니다. DB 스키마 확장:

```sql
CREATE TABLE rule_templates (
  id SERIAL PRIMARY KEY,
  rule_json JSONB,
  display_name TEXT,          -- '야구 홈런왕 룰'
  description TEXT,           -- '가장 높은 숫자 3개 합산'
  creator_user_id INTEGER,
  usage_count INTEGER,        -- 정렬/랭킹용
  likes INTEGER,
  tags TEXT[],                -- ['경쟁', '합산', '인기']
  is_featured BOOLEAN,        -- 관리자가 추천
  created_at TIMESTAMP
);

CREATE INDEX idx_templates_popular ON rule_templates(usage_count DESC);
CREATE INDEX idx_templates_tags ON rule_templates USING GIN(tags);
```

클라이언트에서:
```javascript
// 템플릿 선택 UI
<div class="rule-templates">
  <div class="template" onclick="applyTemplate('baseball-homerun')">
    ⚾ 야구 홈런왕 룰
    <span class="usage">🔥 1,234회 사용</span>
  </div>
</div>
```
"

**기획자 🎯**: "검색도 되어야 할 것 같아요. '홀짝'이라고 치면 관련 룰들이 나오게."

**프로그래머 💻**: "PostgreSQL의 full-text search나 tags 배열로 가능합니다. 그리고 중요한 건 - 템플릿 사용은 **AI 호출 0회**예요. 이미 JSON화된 룰이니까 바로 로컬 엔진으로 판정됩니다."

---

## 대화 5: 하이브리드 판정 (로컬 우선, AI 폴백)

**프로그래머 💻**: "전체 시스템은 '하이브리드 판정'으로 가야 합니다. 로컬 엔진이 처리 가능하면 즉시, 복잡하면 AI로."

**기획자 🎯**: "어떻게 '처리 가능한지' 판단해요?"

**프로그래머 💻**: "판정 라우터를 만듭니다:

```javascript
async function judgeGame(ruleText, diceResults) {
  // 1단계: 프리셋 룰 확인
  const presetMatch = matchPresetRule(ruleText);
  if (presetMatch) {
    return executePreset(presetMatch, diceResults); // <5ms
  }

  // 2단계: 캐시된 JSON 룰 확인
  const cachedRule = await getRuleFromCache(ruleText);
  if (cachedRule) {
    return evaluateJsonRule(cachedRule, diceResults); // <50ms
  }

  // 3단계: 로컬 파서로 변환 시도
  const parsedRule = tryParseLocally(ruleText);
  if (parsedRule.confidence > 0.8) {
    await cacheRule(ruleText, parsedRule);
    return evaluateJsonRule(parsedRule, diceResults); // <100ms
  }

  // 4단계: AI 폴백 (복잡한 룰만)
  const aiResult = await callGemini(ruleText, diceResults); // 2000-5000ms
  // AI가 룰을 JSON으로도 반환하도록 요청해서 캐싱
  return aiResult;
}
```

**응답 시간 분포**:
- 프리셋 (90%): < 5ms ⚡
- 캐시 히트 (8%): < 50ms ⚡
- 로컬 파싱 (1.5%): < 100ms 🟢
- AI 폴백 (0.5%): 2000-5000ms 🟡
"

**기획자 🎯**: "99.5%가 100ms 이하라는 거네요! 엄청 빨라지겠는데요?"

**프로그래머 💻**: "맞습니다. 사용자 입장에선 '즉시' 결과가 나오는 것처럼 느껴질 겁니다. 그리고 시간이 지날수록 캐시가 쌓여서 AI 폴백 비율은 더 줄어들어요."

**기획자 🎯**: "혹시 로컬 파서가 잘못 이해하면 어떡하죠?"

**프로그래머 💻**: "그래서 `confidence` 값을 체크합니다. 80% 미만이면 AI로 보내요. 그리고 사용자가 '결과 이의제기' 버튼으로 피드백하면 해당 룰을 AI로 재검증하고 캐시를 업데이트합니다."

---

## 대화 6: Gemini API 비용 & 한도 관리

**기획자 🎯**: "Gemini API 비용은 얼마나 들어요? 사용자 늘어나면 폭발하는 거 아닌가요?"

**프로그래머 💻**: "지금은 위험합니다. Gemini API 무료 한도:
- **무료 티어**: 분당 15 요청, 일일 1,500 요청
- **현재 사용량**: 게임당 1회 호출 = 활발한 날 2,000+ 호출 → **한도 초과**
- **유료 전환시**: $0.00025/요청 → 2,000회 = $0.50/일 = **$15/월**

문제는 피크 타임에 rate limit 걸리면 서비스 중단됩니다."

**기획자 🎯**: "헉, 그럼 어떡하죠?"

**프로그래머 💻**: "최적화 시스템으로 해결됩니다:

**현재 (최적화 전)**:
- 일일 API 호출: 2,000회
- 비용: $15/월 (유료시)
- 무료 한도 초과: 매일

**최적화 후 (99% 캐시 히트)**:
- 일일 API 호출: 20회 (새 룰만)
- 비용: $0.15/월 (무료 한도 내)
- 무료 한도 초과: 없음
- **비용 절감: 99%**
"

**기획자 🎯**: "완벽한데요! 혹시 모를 사태를 대비한 안전장치도 필요할 것 같아요."

**프로그래머 💻**: "당연히 필요합니다. Railway 환경변수로 관리:

```javascript
// .env
GEMINI_DAILY_LIMIT=1400        // 여유 있게 설정
GEMINI_RATE_LIMIT_PER_MIN=10   // 안전 마진
ENABLE_AI_FALLBACK=true        // 긴급시 비활성화 가능

// server.js
let dailyApiCalls = 0;
let lastResetDate = new Date().toDateString();

async function callGeminiSafely(prompt) {
  // 날짜 바뀌면 카운터 리셋
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    dailyApiCalls = 0;
    lastResetDate = today;
  }

  // 일일 한도 체크
  if (dailyApiCalls >= process.env.GEMINI_DAILY_LIMIT) {
    console.error('⚠️ Gemini daily limit reached');
    // 폴백: 가장 가까운 프리셋 룰로 판정
    return fallbackToPresetRule(prompt);
  }

  // Rate limiting (분당)
  await rateLimiter.waitIfNeeded();

  dailyApiCalls++;
  logApiUsage(dailyApiCalls); // 모니터링

  return await gemini.generate(prompt);
}
```

**모니터링 대시보드**:
- 실시간 API 사용량 표시
- 일일 한도 대비 % 알림
- 비용 예상치 계산
- 캐시 히트율 통계
"

**기획자 🎯**: "이거 하면 Gemini API 비용도 90% 절감되는 거죠? 그리고 무료 한도 안에서 운영 가능하고?"

**프로그래머 💻**: "정확합니다! 그리고 사용자 경험도 400배 빨라지고, 서비스 안정성도 올라갑니다. 일석삼조죠."

---

## 성능 비교표

| 항목 | 현재 (전체 AI 판정) | 개선 후 (하이브리드) | 개선율 |
|------|-------------------|-------------------|--------|
| **평균 응답 시간** | 2,500ms | 25ms | **100배 ⚡** |
| **프리셋 룰 (90%)** | 2,500ms | 5ms | **500배 ⚡** |
| **캐시 히트 (8%)** | 2,500ms | 50ms | **50배 ⚡** |
| **신규 룰 (2%)** | 2,500ms | 2,500ms | 동일 |
| **일일 API 호출** | 2,000회 | 20회 | **99% 감소** |
| **월 API 비용** | $15 | $0.15 | **99% 절감** |
| **무료 한도 초과** | 매일 | 없음 | ✅ |
| **서비스 중단 위험** | 높음 (rate limit) | 없음 | ✅ |

---

## 구현 우선순위 합의

### 🔥 1순위 (즉시 구현 - 사용자 경험 직접 개선)
1. **프리셋 룰 엔진** (1일)
   - 높은 수/낮은 수/합계/홀짝 4종
   - 즉시 90% 게임 속도 개선

2. **메모리 룰 캐싱** (0.5일)
   - Map 기반 간단 캐싱
   - 세션 내 반복 룰 즉시 처리

### ⚡ 2순위 (1주일 내 - 안정성 & 비용)
3. **PostgreSQL 룰 캐싱** (1일)
   - 영구 저장, 서버 재시작 대응

4. **Gemini API 한도 관리** (0.5일)
   - 일일/분당 제한
   - 모니터링 로그

5. **하이브리드 판정 라우터** (1일)
   - 단계별 폴백 시스템
   - confidence 기반 선택

### 🎯 3순위 (2주 내 - 고급 기능)
6. **AI→JSON 룰 변환** (2일)
   - Gemini 프롬프트 설계
   - JSON 스키마 정의
   - 로컬 evaluator 구현

7. **룰 템플릿 마켓** (3일)
   - DB 스키마 확장
   - UI 구현 (템플릿 목록/검색)
   - 좋아요/사용 통계

---

## 기술 스택 & 구현 노트

### 필요한 기술
```javascript
// 1. 프리셋 룰 엔진
const RuleEngine = require('./rule-engine');  // 새 파일

// 2. PostgreSQL 캐싱
const { Pool } = require('pg');  // 이미 사용 중

// 3. Rate limiting
const Bottleneck = require('bottleneck');  // npm install

// 4. 룰 파싱 (옵션)
const nearley = require('nearley');  // 고급 파싱용
```

### Railway 환경변수 추가
```bash
GEMINI_DAILY_LIMIT=1400
GEMINI_RATE_LIMIT_PER_MIN=10
ENABLE_AI_FALLBACK=true
RULE_CACHE_TTL=86400  # 24시간
```

### DB 마이그레이션
```sql
-- migration-001-rule-cache.sql
CREATE TABLE custom_rules (
  id SERIAL PRIMARY KEY,
  rule_text TEXT UNIQUE,
  rule_json JSONB,
  usage_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  last_used TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_rules_text ON custom_rules(rule_text);
CREATE INDEX idx_rules_usage ON custom_rules(usage_count DESC);

-- migration-002-rule-templates.sql
CREATE TABLE rule_templates (
  id SERIAL PRIMARY KEY,
  rule_json JSONB,
  display_name TEXT,
  description TEXT,
  creator_user_id INTEGER,
  usage_count INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  tags TEXT[],
  is_featured BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_templates_popular ON rule_templates(usage_count DESC);
CREATE INDEX idx_templates_tags ON rule_templates USING GIN(tags);
```

---

## 예상 효과

### 사용자 경험
- ⚡ **즉시 결과 표시**: 2.5초 → 0.025초 (체감상 즉시)
- 🎮 **게임 템포 개선**: 답답함 해소, 리플레이 증가
- 🎨 **룰 템플릿**: 새로운 플레이 방식 발견

### 기술 & 비용
- 💰 **API 비용 99% 절감**: $15/월 → $0.15/월
- 📊 **무료 한도 내 운영**: 확장성 확보
- 🛡️ **서비스 안정성**: rate limit 중단 위험 제거
- 📈 **확장 가능**: 사용자 10배 증가해도 비용 동일

### 개발 리소스
- **총 개발 기간**: 2주 (1순위만 하면 1.5일)
- **유지보수**: 낮음 (캐시는 자동 관리)
- **기술 부채**: 없음 (오히려 아키텍처 개선)

---

## 리스크 & 대응

### 🚨 리스크 1: 로컬 파서 오판
- **대응**: confidence < 80%면 AI 폴백
- **대응**: 사용자 이의제기 시스템

### 🚨 리스크 2: 캐시 무효화 타이밍
- **대응**: TTL 24시간 (매일 갱신)
- **대응**: 관리자가 수동 캐시 클리어 가능

### 🚨 리스크 3: DB 캐시 테이블 비대화
- **대응**: usage_count < 5 && 30일 이상 = 자동 삭제
- **대응**: 월 1회 정리 작업

---

## 다음 단계

1. ✅ **프리셋 룰 엔진 프로토타입** (1일)
   - `rule-engine.js` 파일 생성
   - 4종 기본 룰 구현
   - 기존 코드에 통합 테스트

2. ✅ **성능 측정** (0.5일)
   - 현재 평균 응답 시간 기록
   - 프리셋 적용 후 비교
   - 사용자 피드백 수집

3. ✅ **PostgreSQL 마이그레이션** (0.5일)
   - DB 스키마 생성
   - 캐싱 로직 구현
   - Railway 배포 테스트

4. ✅ **API 한도 모니터링** (0.5일)
   - 환경변수 설정
   - rate limiter 적용
   - 로그 대시보드 구축

---

## 결론

**기획자 🎯**: "이거 하면 Gemini API 비용도 90% 절감되는 거죠?"

**프로그래머 💻**: "99% 절감됩니다. 그리고 더 중요한 건 사용자들이 즉시 결과를 보게 된다는 거예요. 답답함이 사라지고 게임이 훨씬 재밌어질 겁니다."

**기획자 🎯**: "개발 기간은?"

**프로그래머 💻**: "1순위만 구현하면 1.5일입니다. 프리셋 룰만 추가해도 90% 게임이 즉시 판정됩니다. 그리고 일주일이면 전체 시스템을 완성할 수 있어요."

**기획자 🎯**: "좋아요! 프리셋 룰부터 당장 시작하죠. 사용자들이 느려서 답답해한다는 피드백이 너무 많아요."

**프로그래머 💻**: "알겠습니다. 오늘 프리셋 룰 엔진 만들고, 내일 배포하겠습니다. 2.5초 → 0.005초, 500배 빨라지는 걸 체감하실 겁니다! 🚀"

---

**📌 핵심 요약**
- **문제**: 매 판정마다 Gemini API 호출 → 2.5초 지연
- **솔루션**: 프리셋 룰(90%) + 캐싱(8%) + AI 폴백(2%)
- **효과**: 응답 시간 100배 개선, API 비용 99% 절감
- **우선순위**: 프리셋 룰 엔진 즉시 구현 (1.5일)
