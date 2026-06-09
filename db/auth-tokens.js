// 소켓 인증 토큰 (HMAC-SHA256 서명, 무저장 / stateless)
//
// HTTP 로그인은 stateless라 socket이 "이 연결이 누구인지" 알 방법이 없다.
// 로그인 성공 시 서버가 서명 토큰을 발급해 클라가 localStorage에 저장하고,
// socket 연결 후 `socket:authenticate { token }`로 재검증하면 서버가
// 서명을 확인해 socket.authedUserId 를 세팅한다.
//
// 토큰은 서버에 저장하지 않는다. 비밀키(AUTH_TOKEN_SECRET)로 서명/검증만
// 하므로 비밀키만 안정적이면 서버 재시작·배포에도 토큰이 그대로 유지된다.
// (이전 인메모리 Map 방식은 재시작 시 전원 재로그인이 필요했다.)
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

// 비밀키: AUTH_TOKEN_SECRET 환경변수에서 읽는다.
// 미설정 시 — 임의 키를 매번 생성하면 재시작마다 토큰이 무효화되어
// 인메모리 방식과 똑같은 문제로 되돌아간다. 운영 안전을 위해 기동은
// 막지 않되, 이 키가 비영속(서버 재시작 시 전원 재로그인)임을 크게 경고한다.
let SECRET = process.env.AUTH_TOKEN_SECRET;
if (!SECRET) {
    SECRET = crypto.randomBytes(32).toString('hex');
    console.warn(
        '\n' +
        '================================================================\n' +
        '⚠️  AUTH_TOKEN_SECRET 미설정 — 임시 비밀키를 생성했습니다.\n' +
        '   이 키는 비영속(in-memory)입니다. 서버를 재시작하면 키가 바뀌어\n' +
        '   모든 로그인 토큰이 무효화되고 사용자는 재로그인해야 합니다.\n' +
        '   영구 유지하려면 .env 에 강한 랜덤 키를 추가하세요:\n' +
        '     AUTH_TOKEN_SECRET=<crypto.randomBytes(32).toString("hex")>\n' +
        '================================================================\n'
    );
}

// base64url(payload) 문자열에 대한 HMAC-SHA256 서명 → base64url 문자열
function sign(encodedPayload) {
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

module.exports = { issueToken, verifyToken, revokeToken };
