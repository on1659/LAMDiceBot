# Railway 인프라 현실화 - "JSON 파일 DB는 안 됩니다"

## 대화 참여자
- 🎯 **기획자**: 사용자 경험과 서비스 안정성에 집중
- 💻 **프로그래머**: Railway 인프라 특성과 기술적 해결책 제시

---

## 배경 상황

**현재 구조**:
- 배포 환경: Railway (클라우드 PaaS)
- 데이터 저장: JSON 파일 (frequentMenus.json, suggestions.json, visitor-stats.json, play-stats.json)
- DB 옵션: PostgreSQL 사용 가능하지만 미활용
- Fallback 로직: DB 실패 → 파일 시스템으로 폴백

**핵심 문제**:
Railway는 **ephemeral filesystem**을 사용합니다. 재배포할 때마다 모든 파일이 초기화됩니다!

---

## Feature Discussion 1: JSON→PostgreSQL 전면 마이그레이션

### 🎯 기획자
"어제까지만 해도 방문자 통계가 잘 쌓이고 있었는데, 오늘 아침에 보니까 다 날아갔어요. 이게 무슨 일이죠? 사용자들이 자주 찾는 메뉴 데이터도 사라져서 '자주 찾는 메뉴' 기능이 완전히 리셋됐어요."

### 💻 프로그래머
"Railway의 파일 시스템은 ephemeral(임시)입니다. 쉽게 말해서:
- 코드 업데이트로 재배포하면 → 파일 초기화
- 서버가 자동으로 재시작되면 → 파일 초기화
- Railway가 컨테이너를 다른 서버로 옮기면 → 파일 초기화

지금 `frequentMenus.json`, `suggestions.json`, `visitor-stats.json`, `play-stats.json` 모두 파일로 저장하고 있는데, 이건 로컬 개발 환경에서만 작동하는 방식이에요. 프로덕션에서는 PostgreSQL로 마이그레이션해야 합니다."

### 🎯 기획자
"그럼 지금까지 쌓인 데이터는 이미 다 날아간 거네요? PostgreSQL로 바꾸면 정확히 뭐가 달라지나요?"

### 💻 프로그래머
"네, 안타깝게도 ephemeral 환경에서는 데이터가 보존되지 않았을 겁니다. PostgreSQL로 전환하면:

**장점**:
1. **영구 저장**: 재배포해도 데이터 유지
2. **트랜잭션**: 여러 작업을 원자적으로 처리 (중간에 실패하면 롤백)
3. **동시성**: 여러 사용자가 동시에 접근해도 안전
4. **쿼리 최적화**: 복잡한 통계 쿼리를 효율적으로 실행
5. **백업/복구**: pg_dump로 정기 백업 가능

**마이그레이션 계획**:
```sql
-- frequentMenus
CREATE TABLE frequent_menus (
  id SERIAL PRIMARY KEY,
  game_type VARCHAR(50) NOT NULL,
  menu_name VARCHAR(100) NOT NULL,
  count INTEGER DEFAULT 1,
  last_used TIMESTAMP DEFAULT NOW(),
  UNIQUE(game_type, menu_name)
);

-- suggestions
CREATE TABLE suggestions (
  id SERIAL PRIMARY KEY,
  game_type VARCHAR(50),
  content TEXT NOT NULL,
  submitted_at TIMESTAMP DEFAULT NOW(),
  ip_hash VARCHAR(64)
);

-- visitor-stats
CREATE TABLE visitor_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  game_type VARCHAR(50),
  visit_count INTEGER DEFAULT 1,
  unique_visitors INTEGER DEFAULT 1,
  UNIQUE(date, game_type)
);

-- play-stats
CREATE TABLE play_stats (
  id SERIAL PRIMARY KEY,
  game_type VARCHAR(50) NOT NULL,
  player_count INTEGER,
  played_at TIMESTAMP DEFAULT NOW(),
  duration_seconds INTEGER
);

CREATE INDEX idx_visitor_date ON visitor_stats(date);
CREATE INDEX idx_play_game_type ON play_stats(game_type);
```

현재 `server.js`에 이미 DB fallback 로직이 있으니, 본격적으로 PostgreSQL을 우선순위로 만들면 됩니다."

### 🎯 기획자
"작업량이 많아 보이는데, 단계적으로 할 수는 없나요? 가장 중요한 데이터부터 먼저 옮기면 어떨까요?"

### 💻 프로그래머
"좋은 접근입니다. 우선순위:

**Phase 1 (필수)**:
- `visitor-stats.json` → `visitor_stats` 테이블
- `play-stats.json` → `play_stats` 테이블
→ 통계 데이터는 한번 날아가면 복구 불가능하므로 최우선

**Phase 2 (중요)**:
- `frequentMenus.json` → `frequent_menus` 테이블
→ 사용자 경험에 직접적 영향

**Phase 3 (일반)**:
- `suggestions.json` → `suggestions` 테이블
→ 건의사항은 상대적으로 덜 critical

각 단계마다 기존 파일 데이터를 CSV로 내보내서 `COPY` 명령으로 DB에 임포트하는 스크립트를 만들겠습니다."

---

## Feature Discussion 2: Railway 환경변수 관리 전략

### 🎯 기획자
"데이터베이스 연결 정보 같은 건 코드에 하드코딩하면 안 되잖아요. Railway에서는 이런 민감한 정보를 어떻게 관리하나요?"

### 💻 프로그래머
"Railway는 환경변수를 Railway Dashboard에서 관리합니다. 현재 필요한 환경변수들:

**현재 사용 중**:
- `DATABASE_URL`: PostgreSQL 연결 문자열 (Railway가 자동 생성)
- `PORT`: Railway가 자동 할당

**추가로 설정해야 할 것들**:
```bash
# Railway Dashboard > Variables 탭에서 설정
NODE_ENV=production
SESSION_SECRET=랜덤_생성_문자열
MAX_CONNECTIONS=10
ENABLE_ANALYTICS=true
LOG_LEVEL=info
```

코드에서는 `process.env`로 접근:
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.MAX_CONNECTIONS || '10'),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});
```"

### 🎯 기획자
"개발 환경과 프로덕션 환경의 설정이 다를 텐데, 이걸 어떻게 구분하나요?"

### 💻 프로그래머
"좋은 질문입니다. `.env` 파일 전략:

**로컬 개발**:
```bash
# .env (git에 커밋 안 함)
NODE_ENV=development
DATABASE_URL=postgresql://localhost/lamdicebot_dev
PORT=3000
SESSION_SECRET=dev-secret-key
ENABLE_ANALYTICS=false
LOG_LEVEL=debug
```

**Railway 프로덕션**:
- Railway Dashboard에서 직접 설정
- `DATABASE_URL`은 PostgreSQL 플러그인 연결 시 자동 생성
- `PORT`는 Railway가 자동 할당 (보통 443)

**코드에서 환경별 분기**:
```javascript
const isDev = process.env.NODE_ENV !== 'production';

// 개발 환경에서는 파일도 허용, 프로덕션에서는 DB만
const useFileSystemFallback = isDev;

// 로그 레벨 조정
const logLevel = process.env.LOG_LEVEL || (isDev ? 'debug' : 'info');
```"

### 🎯 기획자
"환경변수가 잘못 설정되면 서비스가 안 되는 거죠? 배포 전에 검증할 방법은 없나요?"

### 💻 프로그래머
"필수 환경변수 검증 로직을 startup 시점에 추가하겠습니다:

```javascript
// startup-validation.js
function validateEnvironment() {
  const required = ['DATABASE_URL', 'PORT'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    console.error('Please set these in Railway Dashboard > Variables');
    process.exit(1);
  }

  // DATABASE_URL 형식 검증
  if (!process.env.DATABASE_URL.startsWith('postgresql://')) {
    console.error('❌ DATABASE_URL must be a valid PostgreSQL connection string');
    process.exit(1);
  }

  console.log('✅ All required environment variables are set');
}

// server.js 맨 위에서 호출
validateEnvironment();
```

Railway 대시보드에서 변수 변경 시:
1. 자동으로 재배포 트리거됨
2. 위 검증 로직이 실행됨
3. 문제 있으면 서버가 시작 안 되고 로그에 에러 출력"

---

## Feature Discussion 3: Railway 슬립 모드 대응

### 🎯 기획자
"무료 플랜으로 테스트하고 있는데, 한동안 접속이 없으면 서버가 '잠들어' 버리더라고요. 다시 접속하면 10초 정도 기다려야 하는데, 이게 정상인가요?"

### 💻 프로그래머
"네, Railway 무료 플랜의 정상 동작입니다:

**Railway 무료 플랜 특성**:
- 5분간 요청이 없으면 자동으로 슬립 모드 진입
- 다음 요청 시 콜드 스타트 (10-30초 소요)
- 매월 $5 크레딧 제공 (약 500시간 실행 가능)
- 슬립 중에는 크레딧 소모 안 함

**유료 플랜 (Pro, $20/month)**:
- 슬립 모드 없음 (Always-on)
- 더 많은 리소스
- 더 빠른 빌드 시간"

### 🎯 기획자
"사용자들이 10초씩 기다리는 건 너무 불편할 것 같은데요. 무료 플랜에서 개선할 방법은 없나요?"

### 💻 프로그래머
"몇 가지 완화 전략이 있습니다:

**1. 프론트엔드 로딩 UX 개선**:
```javascript
// 콜드 스타트 감지 및 안내
let connectionStartTime = Date.now();

socket.on('connect', () => {
  const loadTime = Date.now() - connectionStartTime;

  if (loadTime > 5000) {
    showNotification('서버가 시작 중이었습니다. 이제 정상 작동합니다.', 'info');
  }
});

socket.on('connect_error', () => {
  showNotification('서버 연결 중... 잠시만 기다려주세요 (최대 30초)', 'warning');
});
```

**2. Keep-alive 핑 (선택적)**:
```javascript
// 활성 사용자가 있을 때만 슬립 방지
let activeUsers = 0;

io.on('connection', (socket) => {
  activeUsers++;

  socket.on('disconnect', () => {
    activeUsers--;
  });
});

// 5분 대신 4분마다 자체 핑 (사용자 있을 때만)
setInterval(() => {
  if (activeUsers > 0) {
    // 내부 health check
    axios.get(`http://localhost:${PORT}/health`).catch(() => {});
  }
}, 4 * 60 * 1000);
```

단, keep-alive는 크레딧을 더 빨리 소모하므로 주의해야 합니다.

**3. 로딩 페이지 추가**:
```html
<!-- 콜드 스타트 중 표시할 페이지 -->
<div id="cold-start-loader" style="display: none;">
  <div class="spinner"></div>
  <p>게임 서버를 시작하고 있습니다...</p>
  <p class="hint">무료 플랜으로 운영 중이라 첫 접속 시 20초 정도 걸릴 수 있어요</p>
</div>
```"

### 🎯 기획자
"결국 제대로 된 서비스를 하려면 유료 플랜으로 가야 하는 거네요?"

### 💻 프로그래머
"사용 패턴에 따라 다릅니다:

**무료 플랜 적합한 경우**:
- 내부 테스트용
- 데모/포트폴리오
- 동시 사용자 < 10명
- 간헐적 사용 (하루 몇 번)

**유료 플랜 필요한 경우**:
- 실제 서비스 운영
- 항상 빠른 응답 필요
- 동시 사용자 > 20명
- 24/7 가용성 필요

**비용 계산**:
- Railway Pro: $20/month (기본) + 사용량 추가 과금
- PostgreSQL: 약 $5/month 추가
- 총 예상: $25-30/month

현재 단계에서는 무료 플랜으로 테스트하고, 실사용자가 늘어나면 유료 전환을 권장합니다."

---

## Feature Discussion 4: Railway PostgreSQL 비용 최적화

### 🎯 기획자
"PostgreSQL도 돈이 든다고 하셨는데, 매달 얼마나 나올까요? 비용을 줄일 방법은 없나요?"

### 💻 프로그래머
"Railway PostgreSQL 비용 구조:

**가격**:
- Railway의 경우 사용한 리소스만큼 과금
- 예상: 소규모 DB는 월 $5-10
- CPU time + 메모리 + 스토리지 합산

**현재 사용 패턴 분석**:
```javascript
// 문제가 될 수 있는 패턴
io.on('connection', (socket) => {
  // ❌ 매 연결마다 DB 쿼리
  setInterval(() => {
    pool.query('SELECT * FROM visitor_stats ORDER BY date DESC LIMIT 100');
  }, 1000); // 1초마다!
});
```

이렇게 하면:
- 동시 접속자 10명 = 초당 10쿼리
- 하루 864,000 쿼리
- 불필요한 CPU/메모리 소모"

### 🎯 기획자
"그럼 어떻게 최적화하나요?"

### 💻 프로그래머
"여러 최적화 기법을 적용하겠습니다:

**1. Connection Pooling 제대로 설정**:
```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10, // 최대 10개 연결 (무료 플랜 기준)
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// 연결 재사용
pool.on('connect', () => {
  console.log('DB connection established');
});

pool.on('error', (err) => {
  console.error('Unexpected DB error', err);
});
```

**2. 쿼리 최적화 및 캐싱**:
```javascript
// ❌ 나쁜 예: 매번 전체 스캔
app.get('/api/stats', async (req, res) => {
  const result = await pool.query('SELECT * FROM visitor_stats');
  res.json(result.rows);
});

// ✅ 좋은 예: 인덱스 + 제한 + 캐싱
const statsCache = new Map();
const CACHE_TTL = 60000; // 1분

app.get('/api/stats', async (req, res) => {
  const cached = statsCache.get('recent-stats');
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  const result = await pool.query(`
    SELECT date, game_type, visit_count, unique_visitors
    FROM visitor_stats
    WHERE date > NOW() - INTERVAL '30 days'
    ORDER BY date DESC
    LIMIT 30
  `);

  statsCache.set('recent-stats', {
    data: result.rows,
    timestamp: Date.now()
  });

  res.json(result.rows);
});
```

**3. Batch Insert 사용**:
```javascript
// ❌ 나쁜 예: 100개 게임 결과를 각각 INSERT
for (let i = 0; i < 100; i++) {
  await pool.query('INSERT INTO play_stats (game_type, player_count) VALUES ($1, $2)',
    ['dice', 4]);
}

// ✅ 좋은 예: 한 번에 배치 INSERT
const values = Array(100).fill(null).map((_, i) =>
  `('dice', 4, NOW())`
).join(',');

await pool.query(`
  INSERT INTO play_stats (game_type, player_count, played_at)
  VALUES ${values}
`);
```

**4. 인덱스 전략**:
```sql
-- 자주 쿼리하는 컬럼에 인덱스
CREATE INDEX idx_visitor_date ON visitor_stats(date);
CREATE INDEX idx_play_game_type ON play_stats(game_type, played_at);

-- 복합 인덱스로 쿼리 최적화
CREATE INDEX idx_visitor_composite ON visitor_stats(game_type, date DESC);

-- 인덱스 사용 확인
EXPLAIN ANALYZE SELECT * FROM visitor_stats WHERE game_type = 'dice' ORDER BY date DESC LIMIT 10;
```"

### 🎯 기획자
"이런 최적화로 얼마나 비용이 줄어들까요?"

### 💻 프로그래머
"예상 효과:

**최적화 전**:
- 불필요한 폴링: 초당 10-20 쿼리
- 비효율적 쿼리: 매번 전체 스캔
- 예상 비용: $15-20/month

**최적화 후**:
- 캐싱으로 쿼리 90% 감소
- 인덱스로 쿼리 속도 10-100배 향상
- Connection pool로 연결 오버헤드 감소
- 예상 비용: $5-8/month

**추가 절감 팁**:
- 오래된 통계는 집계 후 삭제 (raw 데이터 retention 정책)
- 로그는 DB 대신 Railway Logs 활용
- 개발/테스트는 로컬 PostgreSQL 사용"

---

## Feature Discussion 5: Railway 로그 & 에러 추적

### 🎯 기획자
"서버에서 에러가 나면 어떻게 알 수 있나요? 사용자가 '안 돼요'라고 말하기 전에 미리 알 수 있으면 좋겠어요."

### 💻 프로그래머
"Railway는 기본적으로 stdout/stderr을 자동으로 수집합니다. Railway Dashboard > Deployments > Logs에서 실시간 확인 가능합니다.

**현재 문제점**:
```javascript
// ❌ 구조화되지 않은 로그
console.log('User connected');
console.log(socket.id);
console.error('DB error', err);
```

이런 로그는:
- 검색 어려움
- 심각도 구분 안 됨
- 컨텍스트 부족"

### 🎯 기획자
"그럼 어떻게 개선하나요?"

### 💻 프로그래머
"Structured Logging을 도입하겠습니다:

**1. Winston 로거 설정**:
```javascript
// logger.js
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

module.exports = logger;
```

**2. 의미 있는 로그 작성**:
```javascript
const logger = require('./logger');

// ✅ 구조화된 로그
io.on('connection', (socket) => {
  logger.info('User connected', {
    event: 'socket_connection',
    socketId: socket.id,
    ip: socket.handshake.address,
    timestamp: new Date().toISOString()
  });

  socket.on('error', (error) => {
    logger.error('Socket error', {
      event: 'socket_error',
      socketId: socket.id,
      error: error.message,
      stack: error.stack
    });
  });
});

// DB 쿼리 로깅
pool.on('error', (err) => {
  logger.error('Database error', {
    event: 'db_error',
    error: err.message,
    code: err.code,
    stack: err.stack
  });
});
```

**3. Railway Logs 활용**:
Railway Dashboard에서:
- 실시간 로그 스트리밍
- 로그 레벨별 필터링 (INFO, WARN, ERROR)
- 검색 기능 (키워드, 타임스탬프)

**4. 에러 알림 (선택적)**:
무료 솔루션: Discord Webhook
```javascript
const axios = require('axios');

function sendErrorAlert(error, context) {
  if (process.env.NODE_ENV !== 'production') return;

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  axios.post(webhookUrl, {
    embeds: [{
      title: '🚨 LAMDiceBot Error',
      color: 0xff0000,
      fields: [
        { name: 'Error', value: error.message },
        { name: 'Context', value: JSON.stringify(context) },
        { name: 'Time', value: new Date().toISOString() }
      ]
    }]
  }).catch(console.error);
}

// 사용 예
try {
  await pool.query('...');
} catch (error) {
  logger.error('Query failed', { error, query });
  sendErrorAlert(error, { component: 'database', query });
  throw error;
}
```"

### 🎯 기획자
"좋네요. 그런데 로그가 너무 많아지면 Railway 비용이 늘어나지 않나요?"

### 💻 프로그래머
"Railway는 로그 저장 자체로는 별도 과금하지 않습니다. 다만:

**로그 Retention**:
- Railway 무료/Pro: 최근 7일 로그 보관
- 더 오래 보관하려면 외부 서비스 필요 (예: Logtail, Papertrail)

**로그 레벨 전략**:
```javascript
// 환경별 로그 레벨
const LOG_LEVELS = {
  development: 'debug',  // 모든 로그
  staging: 'info',       // 일반 정보 이상
  production: 'warn'     // 경고/에러만
};

logger.level = LOG_LEVELS[process.env.NODE_ENV] || 'info';

// 프로덕션에서는 DEBUG 로그 안 찍힘
logger.debug('Detailed query info', { query, params }); // production에서 skip
logger.info('Game started', { gameType, players });     // production에서 기록
logger.error('Critical failure', { error });           // 항상 기록
```

**비용 절감**:
- Production에서는 `warn` 이상만 기록
- 개발/디버깅은 로컬에서 `debug` 레벨 사용
- 민감정보 로깅 금지 (비밀번호, 토큰 등)"

---

## Feature Discussion 6: 데이터 백업 & 복구 전략

### 🎯 기획자
"PostgreSQL로 옮기면 데이터가 안전하다고 했는데, 만약 Railway가 장애나면요? 혹은 실수로 데이터를 지우면요? 백업은 어떻게 하나요?"

### 💻 프로그래머
"Railway PostgreSQL도 클라우드 서비스라서 물리적 장애는 거의 없지만, 논리적 실수 (잘못된 DELETE, DROP TABLE 등)에는 대비해야 합니다.

**Railway 기본 백업**:
- Railway Pro 플랜: 자동 백업 제공 (Point-in-time recovery)
- 무료 플랜: 자동 백업 없음 → 직접 백업 필요"

### 🎯 기획자
"무료 플랜에서는 어떻게 백업하나요?"

### 💻 프로그래머
"pg_dump를 사용한 자동 백업 스크립트를 만들겠습니다:

**1. 백업 스크립트**:
```javascript
// scripts/backup-db.js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const backupDir = path.join(__dirname, '../backups');
if (!fs.existsSync(backupDir)) {
  fs.mkdirSync(backupDir);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(backupDir, `lamdicebot-${timestamp}.sql`);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

console.log(`Creating backup: ${backupFile}`);

exec(`pg_dump "${databaseUrl}" -f "${backupFile}"`, (error, stdout, stderr) => {
  if (error) {
    console.error('❌ Backup failed:', error);
    process.exit(1);
  }

  console.log('✅ Backup completed successfully');
  console.log(`File: ${backupFile}`);

  // 오래된 백업 삭제 (30일 이상)
  const files = fs.readdirSync(backupDir);
  const now = Date.now();
  const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

  files.forEach(file => {
    const filePath = path.join(backupDir, file);
    const stat = fs.statSync(filePath);

    if (stat.mtimeMs < thirtyDaysAgo) {
      fs.unlinkSync(filePath);
      console.log(`🗑️  Deleted old backup: ${file}`);
    }
  });
});
```

**2. Railway Cron Job (Pro 플랜)**:
Railway에서 별도 Service 생성:
```bash
# railway.json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "node scripts/backup-db.js",
    "restartPolicyType": "ON_FAILURE",
    "cronSchedule": "0 2 * * *"  // 매일 새벽 2시
  }
}
```

**3. 무료 플랜 대안: GitHub Actions**:
```yaml
# .github/workflows/backup-db.yml
name: Database Backup
on:
  schedule:
    - cron: '0 2 * * *'  # 매일 새벽 2시 (UTC)
  workflow_dispatch:      # 수동 실행 가능

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Install PostgreSQL client
        run: sudo apt-get install postgresql-client

      - name: Create backup
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).sql"
          pg_dump "$DATABASE_URL" -f "$BACKUP_FILE"

      - name: Upload to GitHub
        uses: actions/upload-artifact@v3
        with:
          name: db-backup
          path: backup-*.sql
          retention-days: 30
```

이렇게 하면 백업 파일이 GitHub Artifacts에 30일간 보관됩니다."

### 🎯 기획자
"백업은 알겠는데, 실제로 문제가 생기면 어떻게 복구하나요?"

### 💻 프로그래머
"복구 절차:

**1. 전체 복구 (완전히 날아간 경우)**:
```bash
# Railway CLI 설치 필요
railway login
railway link  # 프로젝트 선택

# 백업 파일로 복구
psql "$DATABASE_URL" < backups/lamdicebot-2026-01-30.sql
```

**2. 선택적 복구 (특정 테이블만)**:
```bash
# 특정 테이블만 추출
pg_restore -t visitor_stats backups/lamdicebot-2026-01-30.sql | psql "$DATABASE_URL"
```

**3. 긴급 복구 플랜**:
```markdown
# 긴급 복구 가이드 (docs/EMERGENCY_RECOVERY.md)

## 데이터베이스가 날아갔을 때

1. Railway Dashboard > Database > Logs 확인
   - 무엇이 잘못됐는지 파악

2. 최신 백업 찾기
   - GitHub Actions Artifacts 또는
   - 로컬 backups/ 폴더

3. 복구 실행
   ```bash
   railway login
   railway link
   psql "$(railway variables get DATABASE_URL)" < backup-latest.sql
   ```

4. 데이터 검증
   ```sql
   SELECT COUNT(*) FROM visitor_stats;
   SELECT COUNT(*) FROM play_stats;
   SELECT MAX(date) FROM visitor_stats;  -- 마지막 데이터 날짜
   ```

5. 서버 재시작
   ```bash
   railway up --detach
   ```
```"

### 🎯 기획자
"백업을 수동으로 실행할 수는 없나요? 큰 변경 전에 미리 백업하고 싶어요."

### 💻 프로그래머
"물론입니다. 간단한 명령어 추가:

**package.json에 스크립트 추가**:
```json
{
  "scripts": {
    "backup": "node scripts/backup-db.js",
    "backup:restore": "node scripts/restore-db.js",
    "backup:list": "ls -lh backups/"
  }
}
```

**사용법**:
```bash
# 수동 백업
npm run backup

# 백업 목록 보기
npm run backup:list

# 복구 (대화형)
npm run backup:restore
# → 백업 파일 목록이 나오면 선택
```

**restore-db.js**:
```javascript
const { exec } = require('child_process');
const fs = require('fs');
const readline = require('readline');

const backupDir = './backups';
const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));

if (files.length === 0) {
  console.error('❌ No backup files found');
  process.exit(1);
}

console.log('Available backups:');
files.forEach((file, index) => {
  const stat = fs.statSync(`${backupDir}/${file}`);
  console.log(`${index + 1}. ${file} (${(stat.size / 1024).toFixed(2)} KB)`);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('\nSelect backup number to restore: ', (answer) => {
  const index = parseInt(answer) - 1;
  if (index < 0 || index >= files.length) {
    console.error('❌ Invalid selection');
    process.exit(1);
  }

  const backupFile = `${backupDir}/${files[index]}`;
  console.log(`\n⚠️  WARNING: This will overwrite current database!`);

  rl.question('Type "CONFIRM" to proceed: ', (confirm) => {
    if (confirm !== 'CONFIRM') {
      console.log('Cancelled');
      process.exit(0);
    }

    console.log(`Restoring from ${backupFile}...`);
    exec(`psql "${process.env.DATABASE_URL}" < "${backupFile}"`, (error) => {
      if (error) {
        console.error('❌ Restore failed:', error);
        process.exit(1);
      }
      console.log('✅ Restore completed successfully');
      rl.close();
    });
  });
});
```"

---

## 우선순위 합의표

### 🎯 기획자의 우선순위
1. **JSON→PostgreSQL 마이그레이션 (Phase 1)** ⭐⭐⭐⭐⭐
   - 이유: 데이터 유실 방지가 최우선. 통계 날아가면 서비스 신뢰도 하락.
   - 예상 작업: 3-4일

2. **로그 & 에러 추적** ⭐⭐⭐⭐
   - 이유: 문제를 빨리 발견해야 빨리 해결 가능. 사용자가 불편 겪기 전에 대응.
   - 예상 작업: 1-2일

3. **데이터 백업 자동화** ⭐⭐⭐⭐
   - 이유: PostgreSQL로 옮겨도 논리적 실수는 있을 수 있음.
   - 예상 작업: 1일

4. **Railway 환경변수 관리** ⭐⭐⭐
   - 이유: 민감정보 보호, 환경별 설정 분리
   - 예상 작업: 0.5일

5. **슬립 모드 대응 (UX 개선)** ⭐⭐
   - 이유: 무료 플랜 한계이므로 UX로 완화. 유료 전환 시 자동 해결.
   - 예상 작업: 0.5일

6. **PostgreSQL 비용 최적화** ⭐⭐
   - 이유: 초기에는 사용자 적어서 비용 크지 않음. 나중에 최적화 가능.
   - 예상 작업: 지속적 개선

### 💻 프로그래머의 우선순위
1. **Railway 환경변수 관리** ⭐⭐⭐⭐⭐
   - 이유: 모든 인프라 작업의 기초. 이게 없으면 나머지 작업 불가능.
   - 예상 작업: 0.5일

2. **JSON→PostgreSQL 마이그레이션 (Phase 1)** ⭐⭐⭐⭐⭐
   - 이유: 기획자 의견 동의. ephemeral FS 문제 근본 해결.
   - 예상 작업: 3-4일

3. **PostgreSQL 비용 최적화 (기본 설정)** ⭐⭐⭐⭐
   - 이유: 마이그레이션과 동시에 진행해야 나중에 리팩토링 안 해도 됨.
   - 예상 작업: +1일 (마이그레이션 작업 중 포함)

4. **데이터 백업 자동화** ⭐⭐⭐
   - 이유: PostgreSQL 마이그레이션 직후 바로 필요.
   - 예상 작업: 1일

5. **로그 & 에러 추적** ⭐⭐⭐
   - 이유: DB 마이그레이션 시 디버깅에 필수.
   - 예상 작업: 1-2일

6. **슬립 모드 대응** ⭐
   - 이유: Railway 플랫폼 특성이라 근본적 해결 불가. UX 개선은 나중에.
   - 예상 작업: 0.5일 (여유 있을 때)

### 최종 합의 순서

| 순위 | 작업 | 중요도 | 예상 기간 | 누적 기간 |
|------|------|--------|----------|-----------|
| 1 | Railway 환경변수 관리 | 🔴 Critical | 0.5일 | 0.5일 |
| 2 | JSON→PostgreSQL Phase 1 (통계) | 🔴 Critical | 4일 | 4.5일 |
| 3 | 로그 & 에러 추적 (Winston) | 🟠 High | 1일 | 5.5일 |
| 4 | 데이터 백업 자동화 | 🟠 High | 1일 | 6.5일 |
| 5 | PostgreSQL 비용 최적화 | 🟡 Medium | 지속적 | - |
| 6 | 슬립 모드 UX 개선 | 🟢 Low | 0.5일 | 7일 |

**Phase 1 완료 후**:
- JSON→PostgreSQL Phase 2, 3 진행 (frequentMenus, suggestions)
- 실제 사용량 모니터링 후 Railway Pro 전환 검토
- 비용 최적화 계속 개선

---

## 예상 비용 요약

### 개발/테스트 단계 (현재)
- **Railway 무료 플랜**: $0/month (매월 $5 크레딧)
- **PostgreSQL**: $0 (Railway 무료 크레딧 내)
- **총 예상**: $0/month
- **제약사항**:
  - 슬립 모드 (5분 idle)
  - 월 500시간 제한
  - 자동 백업 없음

### 프로덕션 단계 (실서비스)
- **Railway Pro**: $20/month (베이스)
- **PostgreSQL**: $5-10/month (사용량 기준)
- **추가 리소스**: $5-10/month (트래픽 증가 시)
- **총 예상**: $30-40/month
- **제공사항**:
  - Always-on (슬립 모드 없음)
  - 자동 백업 & 복구
  - 더 많은 리소스
  - 우선 지원

### 비용 절감 전략
1. **초기**: 무료 플랜으로 충분히 테스트
2. **베타**: 실사용자 10-20명까지는 무료 가능
3. **출시**: 사용자 50명 이상 또는 항상 켜져있어야 하면 Pro 전환
4. **최적화**: 쿼리 캐싱, connection pooling으로 DB 비용 최소화

---

## 다음 단계

### 즉시 시작 (이번 주)
- [ ] Railway Dashboard에서 환경변수 설정 (DATABASE_URL 확인)
- [ ] 로컬에 PostgreSQL 설치 및 테스트 DB 생성
- [ ] visitor_stats, play_stats 테이블 생성 스크립트 작성

### 1주차
- [ ] Phase 1 마이그레이션 (통계 데이터)
- [ ] Winston 로거 설정
- [ ] 백업 스크립트 작성 및 테스트

### 2주차
- [ ] Phase 2, 3 마이그레이션 (frequentMenus, suggestions)
- [ ] GitHub Actions 백업 자동화
- [ ] 쿼리 최적화 및 인덱스 튜닝

### 지속적
- [ ] Railway Logs 모니터링
- [ ] 비용 사용량 추적
- [ ] 사용자 피드백 반영
- [ ] Pro 플랜 전환 시점 검토

---

## 참고 자료

- [Railway 공식 문서](https://docs.railway.app/)
- [Railway PostgreSQL 가이드](https://docs.railway.app/databases/postgresql)
- [Railway 가격 정책](https://railway.app/pricing)
- [Node.js pg Pool 문서](https://node-postgres.com/features/pooling)
- [Winston Logger 문서](https://github.com/winstonjs/winston)

---

**작성일**: 2026-01-31
**문서 버전**: 1.0
**다음 리뷰**: PostgreSQL 마이그레이션 완료 후
