// 꾸미기 인벤토리 + 장착 상태
//
// 소유(owned)는 user_cosmetics 테이블, 장착(equipped)은 users.prefs.equipped
// JSONB. 구매(소비)는 db/coins.spend 가 user_cosmetics 까지 한 트랜잭션으로
// 처리하므로 여기엔 조회/장착만 둔다.
//
// 모든 식별자는 users.id (authedUserId). 닉네임 사용 금지.
const { getPool } = require('./pool');

// 장착 슬롯 화이트리스트 (카탈로그 카테고리와 일치)
// spin_skin = 회전 칼날 스킨 슬롯 (config/spin-arena/cosmetics.json) — 화이트리스트 방식 유지(동적 슬롯명 금지)
const EQUIP_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura', 'skin_premium', 'track_theme', 'finish_fx', 'win_sound', 'win_emote', 'caster', 'spin_skin'];
// 레이스 시작 시 타 플레이어에게 공개되는(broadcast) 슬롯
const PUBLIC_HORSE_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura', 'skin_premium'];

// 소유 꾸미기 id 배열
async function getOwned(userId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return [];
    const r = await pool.query('SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1', [userId]);
    return r.rows.map(row => row.cosmetic_id);
}

// 장착 상태 객체 ({ paint, trail, ... }). 없으면 {}.
async function getEquipped(userId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return {};
    const r = await pool.query(`SELECT prefs->'equipped' AS equipped FROM users WHERE id = $1`, [userId]);
    return (r.rows.length > 0 && r.rows[0].equipped) ? r.rows[0].equipped : {};
}

// 여러 유저의 장착 상태 일괄 조회 → { userId: equippedObj }. 레이스 시작 broadcast용.
async function getEquippedMap(userIds) {
    const pool = getPool();
    const map = {};
    if (!pool || !Array.isArray(userIds) || userIds.length === 0) return map;
    const ids = userIds.filter(Number.isInteger);
    if (ids.length === 0) return map;
    const r = await pool.query(`SELECT id, prefs->'equipped' AS equipped FROM users WHERE id = ANY($1)`, [ids]);
    r.rows.forEach(row => { map[row.id] = row.equipped || {}; });
    return map;
}

// 장착/해제. 소유 검증은 호출부(socket/shop.js)가 한 뒤 호출.
// cosmeticId === null 이면 해당 슬롯 해제.
async function setEquipped(userId, slot, cosmeticId) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId) || EQUIP_SLOTS.indexOf(slot) === -1) return;
    // prefs.equipped 객체의 단일 슬롯만 갱신 (기존 equipped/다른 prefs 키 보존)
    await pool.query(
        `UPDATE users
            SET prefs = jsonb_set(
                jsonb_set(COALESCE(prefs, '{}'::jsonb), '{equipped}', COALESCE(prefs->'equipped', '{}'::jsonb), true),
                $1, $2::jsonb, true)
          WHERE id = $3`,
        [`{equipped,${slot}}`, JSON.stringify(cosmeticId), userId]
    );
}

module.exports = { getOwned, getEquipped, getEquippedMap, setEquipped, EQUIP_SLOTS, PUBLIC_HORSE_SLOTS };
