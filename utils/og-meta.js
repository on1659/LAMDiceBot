// 자유 방 다이렉트 링크(/free/:game/:shortcode)의 OG 메타 서버 주입.
//
// free.html은 정적 파일이라 모든 방 링크가 같은 미리보기("친구랑 같이 놀기")로 보인다.
// 카톡/텔레그램 등 링크 크롤러는 JS를 실행하지 않으므로, 응답 HTML의
// OG-ROOM-META 마커 블록을 서버가 방 정보로 교체해서 내려준다.
//
// ⚠️ 서버 방(room.serverId)에는 절대 사용하지 않는다.
//    roomName/hostName은 2026-05-17 보안 패치로 비인증 호출자에게 마스킹되는 값이라
//    미리보기에 노출하면 비공개 서버의 방 이름·호스트가 그대로 새어나간다.

const fs = require('fs');

const SITE_ORIGIN = 'https://lamdice.com';

const META_START = '<!-- OG-ROOM-META:START';
const META_END = '<!-- OG-ROOM-META:END -->';

// js/free.js의 GAME_LABELS / GAME_EMOJI와 같은 값을 유지할 것.
// 여기 없는 슬러그는 기본 메타를 그대로 쓴다.
const GAME_LABELS = {
    dice:         '주사위',
    roulette:     '룰렛',
    horse:        '경마',
    bridge:       '다리건너기',
    ladder:       '사다리타기',
    'spin-arena': '회전 칼날'
};
const GAME_EMOJI = {
    dice:         '🎲',
    roulette:     '🎰',
    horse:        '🐎',
    bridge:       '🌉',
    ladder:       '🪜',
    'spin-arena': '⚔️'
};

// free.html 캐시 — mtime이 바뀌면 다시 읽는다 (dev에서 편집 즉시 반영).
let htmlCache = { mtimeMs: 0, content: null };

function readHtml(htmlPath) {
    const mtimeMs = fs.statSync(htmlPath).mtimeMs;
    if (htmlCache.content === null || htmlCache.mtimeMs !== mtimeMs) {
        htmlCache = { mtimeMs, content: fs.readFileSync(htmlPath, 'utf8') };
    }
    return htmlCache.content;
}

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildMetaBlock({ title, description, url, image }) {
    const t = escapeAttr(title);
    const d = escapeAttr(description);
    const u = escapeAttr(url);
    const i = escapeAttr(image);
    return [
        `    <title>${t}</title>`,
        `    <meta name="description" content="${d}">`,
        `    <meta property="og:title" content="${t}">`,
        `    <meta property="og:description" content="${d}">`,
        `    <meta property="og:type" content="website">`,
        `    <meta property="og:url" content="${u}">`,
        `    <meta property="og:site_name" content="LAMDice">`,
        `    <meta property="og:locale" content="ko_KR">`,
        `    <meta property="og:image" content="${i}">`,
        `    <meta property="og:image:width" content="1200">`,
        `    <meta property="og:image:height" content="630">`,
        `    <meta name="twitter:card" content="summary_large_image">`,
        `    <meta name="twitter:title" content="${t}">`,
        `    <meta name="twitter:description" content="${d}">`,
        `    <meta name="twitter:image" content="${i}">`
    ].join('\n');
}

/**
 * 자유 방 하나에 대한 OG 메타 문구를 만든다.
 * room은 반드시 serverId가 없는 자유 방이어야 한다.
 */
function buildRoomMeta(game, shortcode, room) {
    const label = GAME_LABELS[game];
    const emoji = GAME_EMOJI[game] || '';
    const roomName = (room.roomName || '').trim();

    // roomName은 socket/free.js에서 "{닉네임}의 방"으로 자동 생성된다.
    const title = roomName
        ? `${emoji} ${roomName} · ${label} - LAMDice`
        : `${emoji} ${label} 방 - LAMDice`;

    const users = room.gameState && Array.isArray(room.gameState.users) ? room.gameState.users : [];
    const description = users.length > 0
        ? `${label} 방이에요. 지금 ${users.length}명 있어요. 링크를 누르면 바로 들어갈 수 있어요.`
        : `${label} 방이에요. 링크를 누르면 바로 들어갈 수 있어요.`;

    return {
        title,
        description,
        url: `${SITE_ORIGIN}/free/${game}/${shortcode}`,
        image: `${SITE_ORIGIN}/assets/og/${game}.jpg`
    };
}

/**
 * free.html을 읽어 OG 메타를 방 정보로 교체한 HTML을 돌려준다.
 * 방이 없거나(만료), 서버 방이거나, 모르는 게임이면 기본 메타 그대로 돌려준다.
 */
function renderFreeHtml(htmlPath, { game, shortcode, room }) {
    const html = readHtml(htmlPath);

    if (!room || room.serverId || !GAME_LABELS[game]) return html;

    const startIdx = html.indexOf(META_START);
    const endIdx = html.indexOf(META_END);
    if (startIdx === -1 || endIdx === -1) return html;

    const block = buildMetaBlock(buildRoomMeta(game, shortcode, room));
    return html.slice(0, startIdx) + block.trimStart() + html.slice(endIdx + META_END.length);
}

module.exports = { renderFreeHtml };
