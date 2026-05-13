// /free 방 공유용 shortcode 발급/조회/해제
// - 충돌 시 retry, retry 한도 초과 시 5자 fallback
// - 모든 방 삭제 지점에서 releaseShortcode 호출 필수 (메모리 누수 방지)

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32자 (혼동 문자 OI01 제외)
const DEFAULT_LENGTH = 4;
const MAX_RETRY = 10;
const FALLBACK_LENGTH = 5;

const shortcodeIndex = Object.create(null); // 'K7AB' → roomId

function generateShortcode(length) {
    const len = length || DEFAULT_LENGTH;
    let code = '';
    for (let i = 0; i < len; i++) {
        code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
    return code;
}

function issueShortcode(roomId) {
    if (!roomId) throw new Error('issueShortcode: roomId required');
    for (let i = 0; i < MAX_RETRY; i++) {
        const code = generateShortcode(DEFAULT_LENGTH);
        if (!shortcodeIndex[code]) {
            shortcodeIndex[code] = roomId;
            return code;
        }
    }
    // 4자 실패 → 5자로 fallback
    for (let i = 0; i < MAX_RETRY; i++) {
        const code = generateShortcode(FALLBACK_LENGTH);
        if (!shortcodeIndex[code]) {
            shortcodeIndex[code] = roomId;
            return code;
        }
    }
    throw new Error('shortcode generation exhausted');
}

function resolveShortcode(code) {
    if (!code || typeof code !== 'string') return null;
    return shortcodeIndex[code] || null;
}

function releaseShortcode(code) {
    if (code) delete shortcodeIndex[code];
}

// 디버깅/관리용
function getActiveCount() {
    return Object.keys(shortcodeIndex).length;
}

module.exports = { issueShortcode, resolveShortcode, releaseShortcode, getActiveCount };
