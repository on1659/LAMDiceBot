// 시드 기반 랜덤 생성 함수
const crypto = require('crypto');

function seededRandom(seed, min, max) {
    const hash = crypto.createHash('sha256').update(seed).digest();
    const num = hash.readBigUInt64BE(0);
    const range = BigInt(max - min + 1);
    const result = Number(num % range) + min;
    return result;
}

module.exports = { seededRandom };
