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
// ladder_skin = 사다리타기 하강 토큰 스킨 슬롯 (config/ladder/cosmetics.json) — per-viewer 외형 전용
// 데구리 슬롯(deguri_skin·deguri_balloon)은 여기 없다 — 동물 스킨이 동물마다 하나라 값이 맵이어서
// 일반 shop:equip(슬롯당 id 하나)이 덮어쓰면 안 된다. 데구리 장착은 socket/deguri.js → setDeguriEquipped 로만.
const EQUIP_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura', 'skin_premium', 'finish_fx', 'win_sound', 'win_emote', 'caster', 'spin_skin', 'ladder_skin'];
// 데구리 장착 슬롯 (config/deguri/cosmetics.json, docs/goal/deguri-skin-account-binding.md)
//   deguri_skin    = { <동물>: <cosmeticId>, ... } — 동물마다 하나씩
//   deguri_balloon = <cosmeticId> | null — 야식, 공용 하나
const DEGURI_EQUIP_SLOTS = ['deguri_skin', 'deguri_balloon'];
// 레이스 시작 시 타 플레이어에게 공개되는(broadcast) 슬롯.
// ⚠️ buildRaceCosmetics(socket/horse.js)의 말별 공개 꾸미기 루프가 이 상수를 순회한다.
// finish_fx는 "말 위 꾸미기"가 아니라 개인 연출이므로 여기 넣으면 말 위로 샌다 — 추가 금지.
const PUBLIC_HORSE_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura', 'skin_premium'];
// 광고(transient) 장착(shop:adEquip) 허용 슬롯 = 공개 말-슬롯 + 개인 연출(finish_fx).
// 개인 연출은 본인 화면 전용이라 broadcast(PUBLIC_HORSE_SLOTS)와 분리한다(말-루프 오염 방지).
// 코인 장착(shop:equip)은 EQUIP_SLOTS가 이미 finish_fx를 포함 → 서버 저장됨.
const AD_EQUIP_SLOTS = [...PUBLIC_HORSE_SLOTS, 'finish_fx'];

// scope: 0 = 자유플레이·다른 게임, N = 데구리 커뮤니티 서버 id (db/coins.js 와 같은 칸, docs/goal/deguri-per-server-wallet.md).
// 마지막 인자·기본 0 이라 데구리 밖 호출부는 그대로다. 장착은 scope≠0 일 때 데구리 슬롯 키에 '@N' 이 붙는다(prefs.equipped.deguri_skin@N)
const SCOPED_SLOTS = ['deguri_skin', 'deguri_balloon'];
const slotKey = (slot, scope) => (scope ? slot + '@' + scope : slot);

// 소유 꾸미기 id 배열
async function getOwned(userId, scope = 0) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return [];
    const r = await pool.query('SELECT cosmetic_id FROM user_cosmetics WHERE user_id = $1 AND scope = $2', [userId, scope]);
    return r.rows.map(row => row.cosmetic_id);
}

// 장착 상태 객체 ({ paint, trail, ... }). 없으면 {}.
// scope≠0 이면 그 서버의 데구리 슬롯만 원래 슬롯 이름으로 돌려준다({ deguri_skin, deguri_balloon }).
async function getEquipped(userId, scope = 0) {
    const pool = getPool();
    if (!pool || !Number.isInteger(userId)) return {};
    const r = await pool.query(`SELECT prefs->'equipped' AS equipped FROM users WHERE id = $1`, [userId]);
    const equipped = (r.rows.length > 0 && r.rows[0].equipped) ? r.rows[0].equipped : {};
    if (!scope) return equipped;
    const out = {};
    SCOPED_SLOTS.forEach(slot => { if (equipped[slotKey(slot, scope)] != null) out[slot] = equipped[slotKey(slot, scope)]; });
    return out;
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
    if (!Number.isInteger(userId) || EQUIP_SLOTS.indexOf(slot) === -1) return;
    await writeEquippedSlot(userId, slot, cosmeticId);
}

// 데구리 장착 — 슬롯 값을 통째로 저장(위 DEGURI_EQUIP_SLOTS 형식). 소유 검증은 호출부(socket/deguri.js).
async function setDeguriEquipped(userId, slot, value, scope = 0) {
    if (!Number.isInteger(userId) || DEGURI_EQUIP_SLOTS.indexOf(slot) === -1) return;
    await writeEquippedSlot(userId, slotKey(slot, scope), value);
}

// prefs.equipped 객체의 단일 슬롯만 갱신 (기존 equipped/다른 prefs 키 보존). 슬롯 화이트리스트는 호출부가 확인한다
async function writeEquippedSlot(userId, slot, value) {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
        `UPDATE users
            SET prefs = jsonb_set(
                jsonb_set(COALESCE(prefs, '{}'::jsonb), '{equipped}', COALESCE(prefs->'equipped', '{}'::jsonb), true),
                $1, $2::jsonb, true)
          WHERE id = $3`,
        [`{equipped,${slot}}`, JSON.stringify(value), userId]
    );
}

module.exports = { getOwned, getEquipped, getEquippedMap, setEquipped, setDeguriEquipped, EQUIP_SLOTS, PUBLIC_HORSE_SLOTS, AD_EQUIP_SLOTS };
