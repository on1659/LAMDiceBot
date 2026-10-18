# Jev (TypeSafe System One) 사용 가이드 — 세 프로젝트 경험 정리

> 작성 2026-10-18. **새 세션·새 프로젝트가 이 문서만 읽고** Jev 가 뭔지, 언제 쓰고 언제 안 쓰는지, 어떻게 호출하는지 알 수 있게 쓴 레퍼런스다.
> 출처는 공식 문서(docs.typesafe.ai, 2026-10-18 읽음)와 deguri·CrazyArcadeCopy·LAMDiceBot 세 저장소에서 2026-09-28 ~ 10-12 사이에 실제로 돌린 결과다.
> 공식 문서 전체는 `https://docs.typesafe.ai/llms-full.txt` 한 파일로 받을 수 있다(약 1 MB). 세부가 필요하면 그걸 읽어라.

---

## 0. 30초 요약

- Jev 는 **글을 쓰는 LLM 이 아니다.** 상태(state)와 **타입이 정해진 질문**(choice / score / noul)을 보내면 **확률이 붙은 답**만 돌아온다. 설명·코드·문장은 안 만든다. 코딩 에이전트 모델을 Jev 로 바꾸는 것도 불가능하다.
- 호출은 `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <TYPESAFE_API_KEY>` 하나. 모델은 `jev-latest`(= jev-1.13.0), 가격은 **입력 100만 토큰당 $0.042, 출력 무료**. 한 번 부르는 데 1원 안팎.
- 응답은 공식 "약 100ms", 우리 실측 **205~285ms**. 0.1초 단위 실시간 판단에는 못 쓴다. 타임아웃 2~3.5초에 **코드 fallback** 을 반드시 둔다.
- **숫자 계산·날짜 비교·세기는 코드가, 판단만 Jev 가.** 상태는 영어 문장으로 짧게, 질문 하나에 판단 하나, 여러 질문은 한 요청에 묶는다(fan-out).
- 우리가 해 본 것: **실시간 봇 전술 조언 → 효과 없음**(처치율 67%→53%), **무작위 결과 예측 → 의미 없음**(찍기와 같다), **끝난 경주의 하이라이트 장면 고르기 → 됨**(편향 보정 필요), **미리 굴려 본 후보 중 고르기 → 코드 점수보다 조금 나음**(18.56초 vs 20.86초).
- 키는 서버 환경변수에서만 읽고, 참가자 이름·좌표·원시 숫자는 보내지 않는다. 브라우저 상태를 그대로 중계하는 공개 프록시는 만들지 않는다.

---

## 1. Jev 가 뭔가

TypeSafe 사의 모델. 그들이 "System One 모델"이라 부르는 부류의 첫 모델이다(이름은 카너먼의 System 1 — 빠르고 직관적인 판단). LLM 처럼 자연어를 읽지만, **출력은 생성 텍스트가 아니라 내가 정해 준 선택지 위의 확률 분포**다. 그래서 답을 파싱할 필요가 없고, 코드가 바로 `if` 로 쓸 수 있다. 훈련은 RLCD 라는 방식으로 "확률이 실제 맞을 확률과 같아지게"(calibration) 맞춰져 있다고 한다. 고객 데이터로 파인튜닝은 안 되고 누구나 같은 가중치를 쓴다 — 도메인은 state·instructions·criteria 로만 넣는다.

| 항목 | 값 |
|---|---|
| 모델 ID | `jev-1.13.0`(현행 안정판), `jev-1.14.0`(2026-10-14 공개) |
| 별칭 | `jev-latest` → 1.13.0 (SDK 기본값), `jev-preview` → 1.14.0. 별칭은 새 버전이 나오면 옮겨 가므로 응답의 `model` 칸으로 실제 버전을 기록해 둘 것 |
| 가격 | 입력 100만 토큰당 $0.042 (10억 토큰당 $42). 출력 토큰 무료 |
| 컨텍스트 | 요청당 64k, 질문당 32k(state + 그 질문). 헤더 `TypeSafe-Danger-Zone-Long-Context: true` 를 보내면 둘 다 약 262k 로 늘지만 느리고 덜 정확하다 |
| 입력 | 텍스트만(문자열·JSON 객체·배열). 이미지는 실험 기능(`TypeSafe-Danger-Zone-Images: true`, PNG/JPEG, `box` 질문). 음성·영상 불가 |
| 언어 | **영어가 주 훈련 언어**이고 정확도도 영어가 가장 좋다. 한국어 포함 CJK 는 받지만 정확도가 낮다 → 상태 문장은 영어로 써서 보낸다 |
| 속도 | 공식 "대부분 100ms 안". 실측: 데구리 타임어택 평균 205ms, 크아 2,840회 중앙값 285ms |
| 요청 제한 | 조직 단위 토큰/초·요청/초, 콘솔 `console.typesafe.ai/rate-limits`. 넘으면 429 |
| 데이터 | 요청·응답으로 훈련 안 함. 엔터프라이즈는 ZDR |
| 콘솔 | 키 발급 `console.typesafe.ai/keys`, 놀이터 `console.typesafe.ai/playground` |

### 1.1 질문 타입 세 가지

| 타입 | 묻는 것 | 돌아오는 것 | 쓰는 자리 |
|---|---|---|---|
| `choice` | 이 중 어느 것? | `choice`(가장 확률 높은 옵션 id), `probabilities`(옵션별, 합 1), `confidence` | 라우팅·분류·후보 중 하나 고르기. 옵션 최대 255개. **순서 편향**이 있어 첫 옵션 쪽으로 쏠릴 수 있다 — 순서 바꿔 재확인 |
| `score` | 어느 단계? | `score`(단계 사이 값도 나옴), `legend`, `probabilities`, `confidence` | 심각도·만족도처럼 순서 있는 척도. 단계 2~10개. 두 단계 사이 정확한 크기를 계산하는 데 쓰지 말 것(수치 보정이 약하다) |
| `noul` | 참인가? | `noul`(0~1, "예"일 확률) | 예/아니오. `confidence` 는 따로 안 오고 0.5 근처가 "모름". `criteria.true / false` 로 예·아니오의 뜻을 적어 줄 수 있다 |

`confidence`(choice) = (p_max − 1/n) / (1 − 1/n). 옵션이 n 개일 때 균등분포면 0, 하나에 몰리면 1. noul 에 같은 척도를 쓰려면 |2p − 1|.

### 1.2 LLM 과 다른 점 — 새 세션이 자주 착각하는 것

- 자유 텍스트를 뽑으려고 choice 를 체인으로 엮으면 **느리고 잘 안 된다**. 추출은 정규식이나 생성 모델로 후보를 만들고, Jev 는 그 후보 중 **고르기**만 시킨다.
- 질문의 **ID 는 모델에 안 간다.** `refund_requested` 같은 ID 만 적고 instructions 를 빼먹으면 모델은 아무것도 모른다. 질문 전체를 instructions 에 쓴다.
- Jev 는 **문자 그대로** 읽는다. 의도를 추론해 주지 않는다. 틀린 답을 보고 "내 말은 …였는데"라고 설명하게 되면, 그 설명이 instructions 에 빠진 절반이다.

---

## 2. API 한 장

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json
```

요청:

```json
{
  "model": "jev-latest",
  "state": { "task": "...", "situation": "..." },
  "questions": {
    "pick":      { "type": "choice", "instructions": "Which ...?", "criteria": { "a": "what a means", "b": "what b means" } },
    "severity":  { "type": "score",  "instructions": "How severe ...?", "criteria": ["none", "minor", "serious"] },
    "is_urgent": { "type": "noul",   "instructions": "Does this convey urgency?", "criteria": { "true": "...", "false": "..." } }
  }
}
```

- `state`: 문자열·객체·배열. 객체를 권장(칸마다 이름이 붙어 질문에서 `ticket.messages[0].text` 처럼 경로로 가리킬 수 있다).
- `questions`: 내가 정한 키 → 질문. 질문마다 `type`·`instructions`, choice/score 는 `criteria` 필수, noul 은 선택.
- `instructions`·`criteria` 값은 문자열뿐 아니라 객체·배열도 된다(질문 한 칸 + 참조 데이터 칸 식으로 구조화).
- 모든 질문은 **같은 state 를 보고 독립적으로, 병렬로** 평가된다. 질문을 더 넣어도 응답 시간은 거의 안 늘고 비용은 그 질문 토큰만큼만 든다 → 필요할지 모르는 질문도 한 요청에 다 넣고 코드가 골라 쓴다(speculative fan-out).

응답:

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "pick":      { "type": "choice", "choice": "a", "probabilities": { "a": 0.88, "b": 0.12 }, "confidence": 0.76 },
    "severity":  { "type": "score",  "score": 1.05, "legend": { "0": "none", "1": "minor", "2": "serious" }, "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 }, "confidence": 0.92 },
    "is_urgent": { "type": "noul",   "noul": 0.95 }
  },
  "usage": { "input_tokens": 318, "output_tokens": 34 }
}
```

요청 규칙: 본문 32 MiB 이하, BOM 없는 UTF-8, 중첩 64단계 이하, 숫자는 유한값만(큰 ID·정확한 큰 수는 문자열로). gzip/zstd 압축 가능.

| 상태 코드 | 뜻 | 대응 |
|---|---|---|
| 400 | 규칙 위반(`max_tokens_exceeded` 포함) | 요청 수정 |
| 401 | 키 없음·잘못됨 | 헤더 확인 |
| 413 / 415 | 본문 32 MiB 초과 / 압축 형식 문제 | |
| 422 | 질문 형식 오류(필수 칸 누락 등) — 본문에 어느 칸인지 적혀 온다 | |
| 429 / 529 | 요청 제한 / 과부하 | **지수 백오프**로 재시도. `retry-after` 헤더 따름. SDK 는 자동 |

모델 목록은 `GET /v1/models`(별칭만 나오지만 버전 ID 도 `model` 칸에 쓸 수 있다).

SDK: `npm install @typesafe-ai/sdk`(Node 22+), `pip install typesafe-sdk`. 환경변수 `TYPESAFE_API_KEY` 를 읽는다. 재시도·압축을 알아서 한다. 우리 셋은 SDK 없이 `fetch` 로 썼다(의존성 0, 아래 3절).

코딩 에이전트용 스킬: `claude plugin marketplace add typesafe-ai/skills` → `claude plugin install typesafe@typesafe-ai`(또는 `npx skills add typesafe-ai/skills --skill typesafe-ai`). SKILL.md 원문: `https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md`.

---

## 3. 바로 쓰는 코드 (Node, 의존성 없음)

세 저장소의 공통 골격을 한 함수로 줄인 것. **키 없음·실패·시간 초과·엉뚱한 답은 전부 `null`** → 부르는 쪽이 코드 규칙으로 대신한다.

```js
const JEV_API_URL = process.env.JEV_API_URL || 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
const JEV_TIMEOUT_MS = 3000;          // 화면이 기다릴 수 있는 시간 안으로. 실시간 경로면 더 짧게

// state: 영어 문장 몇 줄(객체 권장). questions: { id: { type, instructions, criteria } }
// 돌아오는 것: answers 또는 null. 호출 쪽은 choice 가 내가 준 옵션 중 하나인지 꼭 다시 검사한다.
async function askJev(state, questions) {
    const key = process.env.TYPESAFE_API_KEY;
    if (!key) return null;
    try {
        const res = await fetch(JEV_API_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: JEV_MODEL, state, questions }),
            signal: AbortSignal.timeout(JEV_TIMEOUT_MS)
        });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body || !body.answers) return null;
        return body.answers;                 // body.model 로 실제 버전, body.usage.input_tokens 로 비용 기록
    } catch (err) {
        console.warn('[jev] 실패:', err && err.name);   // 공급자 본문·키는 절대 로그/클라이언트로 내보내지 않는다
        return null;
    }
}

// 쓰는 예 — 후보 중 하나 고르기
const answers = await askJev(
    { task: 'Choose the best 6-second highlight of a finished race.', race: '8 pixel animals rolled down a hill...' },
    { pick: { type: 'choice', instructions: 'Which clip would be the most fun to watch?', criteria: { c1: 'the leader was snatched by the eagle', c2: 'nothing special happened' } } }
);
const pick = answers && answers.pick && ['c1', 'c2'].includes(answers.pick.choice) ? answers.pick.choice : codeFallback();
```

실험 스크립트(실시간 아님)에서는 429/5xx 와 네트워크 오류를 `500 × 2^attempt` ms 로 4번까지 재시도했다(deguri `scripts/race-jev/run.js`). 실시간 경로에서는 재시도 없이 바로 코드 fallback 이다.

curl 로 한 번 찔러 보기:

```bash
curl -s https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"jev-latest","state":"Help! My payouts have been failing for 3 days.","questions":{"is_urgent":{"type":"noul","instructions":"Does this convey urgency?"}}}'
```

---

## 4. 설계 원칙 — 공식 권장 + 우리가 확인한 것

1. **코드가 흐름을 쥐고, Jev 는 좁은 판단 하나만.** 공식 문서의 "AI-powered software" 구도. 이동·충돌·안전 판정·점수 계산은 코드, "이 중 뭐가 더 볼만한가" 같은 상식 판단만 Jev.
2. **숫자는 코드가 계산하고 Jev 에는 낱말로.** Jev 는 세기·산술·날짜 비교·16진 색값에 약하다(공식 jaggedness #2·#3). 우리는 `neckSec: 4` 대신 "stayed neck and neck for several seconds", 횟수는 once/twice/many times 로 바꿔 보냈다.
3. **상태는 짧게, 질문에 필요한 것만.** 관련 없는 내용이 많으면 정확도가 떨어진다(context rot). 크아 중계 서버는 상태 2,000자·후보 설명 200자로 잘랐다.
4. **질문 하나 = 판단 하나.** "분석해서 최선을 정하라"가 아니라 "이 메시지는 긴급한가". 여러 요인이 섞이면 질문을 쪼개고 코드에서 가중합(composite scoring).
5. **여러 질문은 한 요청에.** 병렬 평가라 시간은 그대로, 비용은 토큰만큼. 쓸지 안 쓸지 모르는 질문도 같이 보내고 코드가 고른다.
6. **confidence 로 게이트.** 높으면 자동 실행, 중간이면 확인, 낮으면 사람·다른 시스템. 위험한 동작일수록 문턱을 높게. 단 "그냥 최선 하나 고르기"면 문턱 없이 `choice` 만 쓰면 된다.
7. **옵션 설명은 중립적으로, 서로 겹치지 않게, 순서를 바꿔 재확인.** 보기 문구 한 줄이 선택을 끌어간다(아래 6절 사례). 첫 옵션 편향도 공식 문서에 있다. "해당 없음 / other" 옵션을 두면 억지 선택을 줄인다.
8. **instructions 와 criteria 가 서로 모순되지 않게.** noul 의 true 가 "아니오"를 뜻하게 쓰면 성능이 떨어진다.
9. **키는 서버만.** `process.env.TYPESAFE_API_KEY`. 클라이언트·로그·에러 메시지·스냅샷 어디에도 안 넣는다. 공급자 응답 본문도 클라이언트로 그대로 넘기지 않는다.
10. **개인정보는 보내지 않는다.** 우리 셋 모두 참가자 이름·방 이름·좌표를 빼고 순번·동물·사건만 보냈다. 서버가 받은 숫자를 검사한 뒤 **정해진 낱말로 문장을 새로 써서** 보낸다(클라이언트가 보낸 문장을 그대로 중계하지 않는다).
11. **상한과 in-flight.** 소켓/IP 당 동시 요청 1개, 최소 간격(크아 250ms), 전체 분당 상한(LAMDice 60회), 판당 1회(하이라이트). 넘으면 코드 fallback.
12. **판단 결과를 화면에 "Jev" 라고 표시하는 건 실제로 Jev 가 답했을 때만.** fallback 이면 'Jev' 배지를 빼고 코드 점수라고 하지 않는다(소스 구분 `source: 'jev'`).

---

## 5. 세 프로젝트에서 해 본 것 — 결과표

| 시도 | 어디·언제 | Jev 가 한 일 | 결과 | 결론 |
|---|---|---|---|---|
| A. 타임어택 봇 | deguri `/race`, 2026-09-29 | 120ms 마다 상태 문장 → 기울기(choice 6개) + 점프(noul) | 5시드 평균 **51.7초** vs 가만히 58.1초 vs 독수리 때만 점프 44.3초. 독수리에 **매 판 잡힘** | 실시간 조작은 못 한다(응답 205ms, 타이밍 수치 약함) |
| A′. 미리 굴리기 | 같은 날, `--lookahead` | 기울기×점프 후보를 1.5초 앞까지 코드가 굴려 결과를 말로 주고 Jev 가 고름 | **18.56초**, 독수리 전부 피함. 같은 후보를 코드 점수로 고르면 20.86초. 운영 사람 1위 31.1초(9명) | 후보 평가는 됨, 코드 점수와 차이는 작음. 랭킹을 압도하는 건 Jev 가 아니라 "미리 굴리기" |
| B. 실시간 전술 조언 | 크아(물풍선) 봇, 2026-10-04 설계·10-08 실측 | 1.5초마다 상황 문장 → 사냥/아이템/파밍 중 하나 | 고수 봇 처치율 **67% → 53%**(3맵×10시드). 2,840회 호출, 실패 1, 중앙값 285ms, 입력 128.9만 토큰, **$0.054** | 효과 없음. 코드는 0.1초마다 위험 지도를 보고 판단하는데 Jev 는 문장 몇 줄만 보니 정보가 적다 |
| B′. 감독으로 전환 | 크아, 2026-10-10 | 30초마다 난이도(up/keep/down), 봇 성향(choice), 10초마다 작전 | 운영 중. 로비 서버 `server/jev.js` 중계, `jev_ask/jev_pick` | 선수가 아니라 **감독** 자리(큰 방향·연출·난이도)가 맞는다 |
| C. 하이라이트 고르기 | deguri 2026-10-11, LAMDice 10-12 | 끝난 경주의 6초 장면 후보(사건을 문장으로)를 choice 로 고름 | 됨. 단 처음엔 **20번 중 18번이 끝 장면** → "결정적 계기" 후보와 설명 보정 뒤 접전 판만 결정 장면을 고름. 👍/👎 반응으로 코드 가중치 0.5~2× 학습 | **이미 일어난 일을 판단**하는 자리가 가장 잘 맞는다 |
| D. 결과 예측 | 데구리, 검토만(2026-10-11) | 꼴찌 예측 등 | 경주 결과가 무작위라 적중률이 찍기와 같다 | 하지 않음 |

쓰레드(@dev.radars) 반응도 참고: "jev ai 를 게임에 접목"(10/5) 725 조회, "jev 로 게임 AI"(10/10) 2시간 445, 게임 기능만 소개한 글은 100 아래. AI 가 **판단하는 게 화면에 보이는** 기능이 글감이 된다.

### 5.1 A. 타임어택 — 상태를 어떻게 썼나

구르기와 걷기에서 기울기의 뜻이 달라 **보기 설명을 모드별로 둘로 나눴다**. 상태는 구간 이름·진행률·좌우 위치·옆 움직임·점프 가능 여부·독수리까지 남은 시간(구간 낱말)·규칙 한 줄. 첫 시도는 걷기용 설명("통로에서 가장 빠름")이 구르기 보기에 섞여 Jev 가 `hard_right` 만 골라 벽에 끼었다. 분리하고 "최근 2초 거의 안 내려감(끼었을 것)" 정보를 넣어 고쳤다. 비용은 판당 약 1센트(한 판에 수백 번 묻기 때문).

### 5.2 B. 크아 — 비교 실험에서 배운 것

- 10-04 는 키가 없어 Jev 를 한 번도 못 불렀는데도 "코드 점수 선택" 군 승률이 80% 였다. 그런데 **첫 판단을 7ms 미룬 위약**만으로 기존 봇 승률이 1.7% → 38.3% → 93.3%(14ms) 로 뛰었다. 시뮬레이션 비교는 **위약 폭을 먼저 재지 않으면 아무 숫자도 믿을 수 없다.**
- 10-08 실측 −14%p 는 위약 폭(10%p) 안이라 "확실히 나쁘다"는 아니지만 나아진 증거는 없다. Jev 가 셋 중 "아이템"을 골라 봇을 사냥에서 떼어 놓았다.
- 다시 한다면: 조언을 "공격성 다이얼 묶음 선택"으로 바꾸거나 사람의 과거 습관을 문장에 넣는 것. 둘 다 새 실험이다.

### 5.3 C. 하이라이트 — 후보와 설명

- 후보는 코드가 만든다(역전·독수리·구멍·진흙·낮잠·몸싸움·접전 구간). 각 후보의 사실을 숫자로 모아 서버가 검사(`cleanFacts`)한 뒤 **영어 문장으로 다시 쓴다**. 위치("very end")는 말하지 않는다 — 그 말에 끌려 끝 장면만 골랐다.
- `state` 에 `task`·`race`·`what_makes_it_fun`(역전의 순간이 재미의 핵심이고 결승은 모두 봤다) 세 칸, 질문은 `pick` 하나. 응답의 `probabilities` 는 장면 여러 개를 고를 때 순위로 쓴다.
- 사용자 피드백: 결정되는 순간만큼 **접전**(붙어 간 시간·골인 차)이 중요 → 후보 사실에 `neckSec`·`finalGapMs` 추가.
- 반응(👍/👎·GIF 저장)을 사실별 좋아요 비율로 모아 코드 점수 가중치 배율(0.5~2×, 표본 적으면 1 쪽으로)로 쓰고, 5판에 1판은 코드 점수로 골라 비교한다.

---

## 6. 함정 모음

우리가 겪은 것:

| 함정 | 사례 | 대응 |
|---|---|---|
| 보기 문구가 선택을 끌어간다 | "통로에서 가장 빠름" → `hard_right` 만 골라 벽에 낌 | 모드별 설명 분리, 평가 낱말("best", "fastest") 금지, 사실만 |
| 위치 단서에 끌린다 | "very end of the race" → 끝 장면 18/20 | 위치 말 안 함, "결정적 계기" 후보를 코드가 항상 넣음 |
| 타이밍 수치 약함 | 독수리 잡기 1.2~0.85초 전에 미리 뛰어 재사용 대기에 걸림 | 타이밍은 코드(qte)가, Jev 는 "지금 뛸지"가 아니라 "어느 후보가 나은가" |
| 실시간 불가 | 120ms 간격 요청 vs 응답 205ms | 판을 멈추는 실험에서만 가능. 운영은 판당 1회·카운트다운 안에 미리 |
| 정보가 적어 코드를 못 이김 | 1.5초마다 문장 몇 줄 vs 0.1초마다 위험 지도 | 코드가 이미 잘하는 결정에 Jev 를 얹지 않는다 |
| 위약 폭 | 7ms 지연으로 승률 1.7→38.3% | 비교 실험은 위약군을 먼저 |
| 실패 비용 0 착각 | usage 를 못 받은 호출 | 비용 미상으로 따로 기록, 0으로 치지 않음 |

공식 문서가 적어 둔 약점(jev-1.13, 2026-10-02 기준): 문자 그대로 읽음 · 수학/세기/수치 표현 약함 · 날짜 비교 약함 · 간접 지시(이중 부정·다단계 추론) 약함 · 큰 상태의 잡음에 흔들림 · 적대적 내용에 끌림(state 를 안전하게 보지 않는다) · instructions 와 criteria 모순 시 혼란 · choice 옵션 순서 편향 · 생성 불가.

---

## 7. 새 프로젝트에 붙일 때 체크리스트

1. **Jev 가 맞는 자리인가?** 이미 일어난 일의 판단, 고정된 목적지로 라우팅, 루브릭 점수, 참/거짓 확인, 후보 중 고르기 → 맞다. 실시간 조작, 결과 예측(무작위), 텍스트 생성, 정확한 계산 → 아니다.
2. **코드로 먼저 계산할 수 있는가?** 있으면 코드로. Jev 는 그 결과를 낱말로 받아 판단만.
3. **키**: 서버 환경변수 `TYPESAFE_API_KEY`(Railway Variables / `.env`). `.env.example` 에 빈 칸과 설명만. 키 없으면 기능이 조용히 코드 모드로.
4. **요청 설계**: state 객체(영어, 짧게), 질문별 instructions 완전 문장, criteria 중립·비중복·필요하면 other. 상수(질문 문구·문턱값)는 파일 한 곳에 모아 리뷰하기 쉽게.
5. **방어**: 타임아웃(2~3.5초), in-flight 1, 최소 간격, 상한, 응답 검증(choice 가 내 옵션인지, 확률이 0~1 인지), fallback, 로그에 키·공급자 본문 금지.
6. **검증**: 같은 후보를 코드 점수로 고르는 대조군, 위약군, 옵션 순서 뒤집기, 비용은 `usage.input_tokens` 로 기록.
7. **표시**: 실제 Jev 답일 때만 'Jev' 배지. 응답 `model` 로 버전 기록.
8. **테스트**: `deps.fetch` 주입으로 가짜 응답(LAMDice `socket/jev.js` 의 `ask(race, deps)` 패턴), 상한·검증 실패 경로 포함.

---

## 8. 코드·문서 위치

| 내용 | 위치 |
|---|---|
| 하이라이트 Jev 호출(서버, 테스트용 deps 주입) | LAMDiceBot `socket/jev.js` (`describe`·`request`·`ask`), 호출부 `socket/deguri-highlight.js`, 설정 `config/index.js` (`TYPESAFE_API_KEY`·`JEV_API_URL`) |
| 하이라이트 명세·결정 | LAMDiceBot `docs/goal/applied/deguri-jev-highlight.md`, deguri `docs/goal/deguri-jev-highlight.md` (Decisions) |
| 하이라이트 단독판(HTTP, IP 제한·facts 검사·반응 가중치) | deguri `server/jev.js`, `server/jev-feedback.js`, 클라 `js/jev-highlight.js`, 테스트 `server/jev.test.js` |
| 타임어택 Jev 실험 스크립트 | deguri `scripts/race-jev/run.js` (`node --env-file=.env scripts/race-jev/run.js --seeds 5 --lookahead`). 결과 json(`race-jev-out/`)은 .gitignore — 수치는 이 문서 5절이 유일한 기록 |
| 타임어택 "AI 구경" 테스트 서버 기능 | deguri 브랜치 `origin/test/share-card` 만(`server/race-jev.js`, 커밋 d7e0183·37eccb7). main 미병합 |
| 왜 Jev 인가(쓰레드 반응·후보 A~E·뺀 것) | deguri `docs/goal/deguri-hook-features.md` |
| 크아 중계 서버(세 종류 질문, 상태 길이 제한) | CrazyArcadeCopy `server/jev.js` (`jev_ask`/`jev_pick`), 클라 `godot/net/jev_advisor.gd`·`jev_watch.gd` |
| 크아 실험 설계·결과·통합 설계 | CrazyArcadeCopy `docs/bot/jev/README.md`, `results-2026-10-04.md`, `results-2026-10-08.md`, `comparison-2026-10-04.md`, `report.html`; 벤치 `godot/tests/jev_bench.gd` |
| 크아 감독 명세 | CrazyArcadeCopy `docs/goal/applied/crazyarcade-jev-director.md` |
| 키가 있는 곳(값은 어디에도 안 적는다) | Railway `Deguri` 프로젝트의 `deguri-test`·운영 `Deguri` 서비스, CrazyArcadeCopy 서비스, LAMDice 운영. 로컬은 deguri `.env` |

GitHub: `on1659/LAMDiceBot`, `on1659/deguri`, `on1659/CrazyArcadeCopy`.

---

## 9. 공식 문서 링크

- 전체 한 파일: https://docs.typesafe.ai/llms-full.txt (목차 https://docs.typesafe.ai/llms.txt)
- API: https://docs.typesafe.ai/api · 모델/가격/제한: https://docs.typesafe.ai/models
- 질문 타입: https://docs.typesafe.ai/primitives (choice / score / noul / advanced)
- 상태 쓰는 법: https://docs.typesafe.ai/concepts/state · 설계: https://docs.typesafe.ai/concepts/how-to-build-with-system-one
- confidence: https://docs.typesafe.ai/confidence · 패턴: https://docs.typesafe.ai/patterns
- 알려진 약점: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- 코딩 에이전트와의 관계(오해 방지): https://docs.typesafe.ai/introduction/coding-agents · 에이전트 스킬: https://docs.typesafe.ai/agent-skill
- 쿡북(가드레일·RAG 분류·재순위·날짜 추출 등): https://docs.typesafe.ai/cookbooks
- 콘솔: https://console.typesafe.ai (keys · playground · rate-limits)
