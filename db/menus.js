// 자주 쓰는 메뉴 & 이모지 설정
const fs = require('fs');
const path = require('path');
const { getPool } = require('./pool');

const MENUS_FILE = path.join(__dirname, '..', 'frequentMenus.json');
const EMOJI_CONFIG_FILE = path.join(__dirname, '..', 'emoji-config.json');

function loadFrequentMenus() {
    try {
        if (fs.existsSync(MENUS_FILE)) {
            const data = fs.readFileSync(MENUS_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        }
    } catch (error) {
        console.error('메뉴 파일 읽기 오류:', error);
    }
    return ['오초', '오고', '하늘보리', '트레비', '핫식스', '500', '콘', '오쿠', '헛개', '제콜', '펩제', '제사', '비타병', '아제'];
}

async function getMergedFrequentMenus(serverId) {
    const pool = getPool();
    const base = loadFrequentMenus();
    if (!pool || !serverId) return base;
    try {
        const res = await pool.query(
            'SELECT menu_text FROM frequent_menus WHERE server_id = $1 ORDER BY id',
            [serverId]
        );
        const fromDb = (res.rows || []).map(r => r.menu_text).filter(m => !base.includes(m));
        return [...base, ...fromDb];
    } catch (e) {
        console.warn('frequent_menus 조회:', e.message);
        return base;
    }
}

function saveFrequentMenus(menus) {
    try {
        fs.writeFileSync(MENUS_FILE, JSON.stringify(menus, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('메뉴 파일 쓰기 오류:', error);
        return false;
    }
}

function loadEmojiConfigBase() {
    try {
        if (fs.existsSync(EMOJI_CONFIG_FILE)) {
            const data = fs.readFileSync(EMOJI_CONFIG_FILE, 'utf8');
            const parsed = JSON.parse(data);
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
    } catch (error) {
        console.error('이모지 설정 파일 읽기 오류:', error);
    }
    return { '❤️': '좋아요', '👍': '따봉', '😢': '슬퍼요', '🎉': '축하해요', '🔥': '핫해요' };
}

async function getMergedEmojiConfig(serverId) {
    const pool = getPool();
    const base = loadEmojiConfigBase();
    if (!pool || !serverId) return base;
    try {
        const res = await pool.query(
            'SELECT emoji_key, label FROM emoji_config WHERE server_id = $1 ORDER BY id',
            [serverId]
        );
        const merged = { ...base };
        (res.rows || []).forEach(row => {
            if (row.emoji_key) merged[row.emoji_key] = row.label || row.emoji_key;
        });
        return merged;
    } catch (e) {
        console.warn('emoji_config 조회:', e.message);
        return base;
    }
}

module.exports = {
    loadFrequentMenus, getMergedFrequentMenus, saveFrequentMenus,
    loadEmojiConfigBase, getMergedEmojiConfig
};
