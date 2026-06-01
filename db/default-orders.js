// db/default-orders.js
// 비공개 서버 단골 메뉴(디폴트 주문) DB 모듈
// 키: (server_id, user_name) — order_stats 동일 패턴

const { getPool } = require('./pool');

// 단일 유저 디폴트 조회 (joinRoom 캐시 로드용)
// 반환: { menuText, mode } | null (mode: 'fixed' | 'random')
async function getDefaultOrder(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId || !userName) return null;
    try {
        const res = await pool.query(
            'SELECT menu_text, mode FROM default_orders WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return res.rows[0] ? { menuText: res.rows[0].menu_text, mode: res.rows[0].mode || 'fixed' } : null;
    } catch (e) {
        const msg = (e && e.message) || '';
        const isMissingMode = /column .*"?mode"?.* does not exist/i.test(msg);
        if (isMissingMode) {
            // mode 컬럼 누락 시 fallback (fixed로 가정)
            try {
                const res2 = await pool.query(
                    'SELECT menu_text FROM default_orders WHERE server_id = $1 AND user_name = $2',
                    [serverId, userName]
                );
                return res2.rows[0] ? { menuText: res2.rows[0].menu_text, mode: 'fixed' } : null;
            } catch (e2) {
                console.warn('default_orders 조회 fallback 실패:', e2.message);
                return null;
            }
        }
        console.warn('default_orders 조회:', msg);
        return null;
    }
}

// 저장: mode 추가. random이면 menuText='' (NOT NULL 컬럼 유지)
async function setDefaultOrder(serverId, userName, menuText, mode) {
    const pool = getPool();
    if (!pool || !serverId) return false;
    const safeMode = mode === 'random' ? 'random' : 'fixed';
    const safeMenu = safeMode === 'random' ? '' : (menuText || '');
    try {
        await pool.query(
            `INSERT INTO default_orders (server_id, user_name, menu_text, mode, updated_at)
             VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
             ON CONFLICT (server_id, user_name)
             DO UPDATE SET menu_text = $3, mode = $4, updated_at = CURRENT_TIMESTAMP`,
            [serverId, userName, safeMenu, safeMode]
        );
        return true;
    } catch (e) {
        // mode 컬럼이 아직 DB에 없을 때 fallback (서버 재시작 전 마이그레이션 미적용 호환)
        // 'column "mode" of relation "default_orders" does not exist' 같은 에러 → mode 빼고 재시도
        const msg = (e && e.message) || '';
        const isMissingMode = /column .*"?mode"?.* does not exist/i.test(msg) || /"?mode"?\s+does not exist/i.test(msg);
        if (isMissingMode) {
            console.warn('default_orders: mode 컬럼 누락 — fallback(fixed만 저장) 실행. 서버 재시작으로 init.js의 ALTER가 적용되어야 합니다:', msg);
            try {
                await pool.query(
                    `INSERT INTO default_orders (server_id, user_name, menu_text, updated_at)
                     VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                     ON CONFLICT (server_id, user_name)
                     DO UPDATE SET menu_text = $3, updated_at = CURRENT_TIMESTAMP`,
                    [serverId, userName, safeMenu]
                );
                return true;
            } catch (e2) {
                console.warn('default_orders 저장 fallback도 실패:', e2.message);
                return false;
            }
        }
        console.warn('default_orders 저장:', msg);
        return false;
    }
}

async function removeDefaultOrder(serverId, userName) {
    const pool = getPool();
    if (!pool || !serverId) return false;
    try {
        await pool.query(
            'DELETE FROM default_orders WHERE server_id = $1 AND user_name = $2',
            [serverId, userName]
        );
        return true;
    } catch (e) {
        console.warn('default_orders 삭제:', e.message);
        return false;
    }
}

module.exports = { getDefaultOrder, setDefaultOrder, removeDefaultOrder };
