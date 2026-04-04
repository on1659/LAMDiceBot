/**
 * Telegram Bot 유틸리티
 * - 회의 결과, 보고 등을 텔레그램으로 전송
 * - chat_id는 config/telegram.json에 저장
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'telegram.json');

function getToken() {
    return process.env.TELEGRAM_BOT_TOKEN || '';
}

function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch {
        return { chatId: '' };
    }
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * 텔레그램 메시지 전송
 * @param {string} text - 전송할 텍스트 (Markdown 지원)
 * @param {object} [options] - { parseMode: 'Markdown'|'HTML' }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendMessage(text, options = {}) {
    const token = getToken();
    if (!token) return { success: false, error: '봇 토큰이 설정되지 않았습니다.' };

    const { chatId } = loadConfig();
    if (!chatId) return { success: false, error: 'Chat ID가 설정되지 않았습니다.' };

    const body = {
        chat_id: chatId,
        text,
    };
    if (options.parseMode) body.parse_mode = options.parseMode;

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) return { success: false, error: data.description || '전송 실패' };
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * getUpdates로 최근 메시지에서 chat_id 자동 감지
 * @returns {Promise<{success: boolean, chatId?: string, error?: string}>}
 */
async function detectChatId() {
    const token = getToken();
    if (!token) return { success: false, error: '봇 토큰이 설정되지 않았습니다.' };

    try {
        const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=5`);
        const data = await res.json();
        if (!data.ok) return { success: false, error: data.description || 'getUpdates 실패' };

        const updates = data.result || [];
        if (updates.length === 0) {
            return { success: false, error: '봇에 메시지를 먼저 보내주세요. 텔레그램에서 봇을 찾아 /start를 눌러주세요.' };
        }

        // 가장 최근 메시지의 chat_id
        const lastUpdate = updates[updates.length - 1];
        const chatId = String(
            lastUpdate.message?.chat?.id ||
            lastUpdate.channel_post?.chat?.id ||
            ''
        );
        if (!chatId) return { success: false, error: '메시지에서 Chat ID를 찾을 수 없습니다.' };

        return { success: true, chatId };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

module.exports = { loadConfig, saveConfig, sendMessage, detectChatId };
