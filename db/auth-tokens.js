// 소켓 인증 토큰 (HMAC-SHA256 서명, 무저장 / stateless)
//
// HTTP 로그인은 stateless라 socket이 "이 연결이 누구인지" 알 방법이 없다.
// 로그인 성공 시 서버가 서명 토큰을 발급해 클라가 localStorage에 저장하고,
// socket 연결 후 `socket:authenticate { token }`로 재검증하면 서버가
// 서명을 확인해 socket.authedUserId 를 세팅한다.
//
// 토큰은 서버에 저장하지 않는다. 비밀키로 서명/검증만 하므로 비밀키만
// 안정적이면 서버 재시작·배포에도 토큰이 그대로 유지된다. 비밀키는 env
// (AUTH_TOKEN_SECRET) 또는 DB(app_secrets 테이블)에 1회 영속된 값을 쓴다 —
// env 없이도 재시작/재배포에 유지된다. (인메모리 Map 방식은 재시작 시 전원 재로그인)
//
// 토큰 형식: base64url(payload) + "." + base64url(signature)
//   payload   = {"u": userId, "n": name, "e": 만료ms} (JSON)
//   signature = HMAC-SHA256(base64url(payload) 문자열, SECRET)
//
// 보안: 서명 비교는 timingSafeEqual(타이밍 공격 차단), 알고리즘은
// HMAC-SHA256 하드코딩(alg 필드를 두지 않아 alg:none 류 취약점 원천 차단).
// 비밀키가 새면 임의 userId 토큰 위조가 가능하므로 비밀키는 절대
// 로그·HTTP 응답에 출력하지 않는다.
const crypto = require('crypto');

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7일

// 비밀키 우선순위:
//   1) AUTH_TOKEN_SECRET 환경변수 (배포 오버라이드)
//   2) DB(app_secrets)에 1회 생성·영속된 키 — initAuthSecret(pool)가 부팅 시 로드
// env 없이도 DB 키가 재시작/재배포에 유지되므로 토큰이 무효화되지 않는다.
let SECRET = process.env.AUTH_TOKEN_SECRET || null;
const SECRET_DB_KEY = 'auth_token_secret';

// 부팅 시 1회 호출(db/init.js의 initDatabase). env 키가 있으면 그대로 쓰고,
// 없으면 app_secrets에서 로드하거나, 없으면 생성해 영속한다.
async function initAuthSecret(pool) {
    if (SECRET) return; // env 오버라이드 — DB를 건드리지 않는다
    if (!pool) {
        // DB 없음(파일 모드) — 영속 불가. ephemeral 폴백(이 모드는 지갑/상점 자체가 비활성).
        SECRET = crypto.randomBytes(32).toString('hex');
        console.warn('⚠️  AUTH_TOKEN_SECRET 미설정 + DB 없음 — 임시 토큰키(재시작 시 재로그인). 파일 모드라 지갑/상점은 비활성.');
        return;
    }
    try {
        const sel = await pool.query('SELECT value FROM app_secrets WHERE key = $1', [SECRET_DB_KEY]);
        if (sel.rows.length > 0) {
            SECRET = sel.rows[0].value;
            return;
        }
        // 없으면 생성 후 영속. 다중 인스턴스 동시 부팅 경쟁 안전을 위해
        // INSERT(충돌 무시) 후 권위 값을 재조회한다.
        const generated = crypto.randomBytes(32).toString('hex');
        await pool.query(
            'INSERT INTO app_secrets (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
            [SECRET_DB_KEY, generated]
        );
        const reread = await pool.query('SELECT value FROM app_secrets WHERE key = $1', [SECRET_DB_KEY]);
        SECRET = (reread.rows[0] && reread.rows[0].value) || generated;
        console.log('🔑 토큰 서명키: DB 영속 키 사용 (env 미설정 — 재시작/재배포에도 유지)');
    } catch (e) {
        // DB 조회/저장 실패 — 부팅은 막지 않고 ephemeral 폴백
        SECRET = crypto.randomBytes(32).toString('hex');
        console.warn('⚠️  토큰 서명키 DB 영속 실패 — 임시키 폴백(재시작 시 재로그인):', e.message);
    }
}

// base64url(payload) 문자열에 대한 HMAC-SHA256 서명 → base64url 문자열
function sign(encodedPayload) {
    if (!SECRET) SECRET = crypto.randomBytes(32).toString('hex'); // 방어: initAuthSecret 전 호출 시
    return crypto.createHmac('sha256', SECRET).update(encodedPayload).digest('base64url');
}

// 로그인 성공 시 호출. userId는 users.id (인증 계정).
function issueToken(userId, name) {
    if (!Number.isInteger(userId)) return null;
    const payload = { u: userId, n: name, e: Date.now() + TOKEN_TTL_MS };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    return encodedPayload + '.' + sign(encodedPayload);
}

// socket:authenticate 에서 호출. 유효하면 { userId, name }, 아니면 null.
// 서명 검증을 통과한 후에만 payload를 신뢰·파싱한다.
function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;

    const dot = token.indexOf('.');
    if (dot <= 0 || dot !== token.lastIndexOf('.')) return null; // 정확히 1개의 '.'
    const encodedPayload = token.slice(0, dot);
    const providedSig = token.slice(dot + 1);
    if (!encodedPayload || !providedSig) return null;

    // 서명 비교는 반드시 timingSafeEqual — 길이가 다르면 비교 없이 거부
    const expectedSig = sign(encodedPayload);
    const a = Buffer.from(providedSig, 'base64url');
    const b = Buffer.from(expectedSig, 'base64url');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // 서명 통과 → 이제 payload를 신뢰하고 파싱
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch (e) {
        return null; // 형식 깨짐
    }
    if (!payload || !Number.isInteger(payload.u) || typeof payload.e !== 'number') return null;
    if (payload.e <= Date.now()) return null; // 만료

    return { userId: payload.u, name: payload.n };
}

// 무저장 토큰이라 서버 측에서 즉시 무효화할 수단이 없다(서명만 검증).
// 인터페이스는 유지해 호출부가 깨지지 않게 한다. 현금화 도입 시 토큰을
// DB/Redis 세션 스토어로 승격하면 바로 이 함수에서 실제 무효화를 구현한다.
function revokeToken(token) {
    // no-op (stateless) — 승격 시 여기서 세션 레코드 삭제
}

module.exports = { issueToken, verifyToken, revokeToken, initAuthSecret };
