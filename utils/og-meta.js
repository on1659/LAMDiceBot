// 방 다이렉트 링크의 링크 미리보기(OG 메타) 서버 주입.
//
// free.html은 정적 파일이라 그대로 두면 모든 방 링크가 같은 미리보기
// ("친구랑 같이 놀기")로 보인다. 카톡/텔레그램 등 링크 크롤러는 JS를
// 실행하지 않으므로, 응답 HTML의 OG-ROOM-META 마커 블록을 서버가
// 방 정보로 교체해서 내려준다.
//
// 자유 방(/free/{game}/{code})과 서버 방(/{game}/{code}) 모두 방 이름을 노출한다.
// 2026-08-24 결정: 서버 방도 자유 방과 동일하게 방 제목을 보여준다.
//   링크 미리보기는 링크 소지자를 대상으로 하므로 방 제목까지 보여주기로 했다.
//   비공개 서버 방 이름도 링크를 가진 사람에게는 보인다는 뜻이다.
//   /api/free/resolve도 같은 판단으로 roomName을 함께 공개한다 —
//   여전히 마스킹하는 것은 서버의 hostName/serverName 두 개다.

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
    'spin-arena': '회전 칼날',
    pirate:       '해적 룰렛'
};
const GAME_EMOJI = {
    dice:         '🎲',
    roulette:     '🎰',
    horse:        '🐎',
    bridge:       '🌉',
    ladder:       '🪜',
    'spin-arena': '⚔️',
    pirate:       '🏴‍☠️'
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

function buildRoomMeta(game, urlPath, room) {
    const label = GAME_LABELS[game];
    const emoji = GAME_EMOJI[game] || '';

    // 자유 방은 "{닉네임}의 방"으로 자동 생성(socket/free.js),
    // 서버 방은 방을 만들 때 사용자가 직접 입력한 제목(socket/rooms.js).
    const roomName = (room.roomName || '').trim();
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
        url: `${SITE_ORIGIN}${urlPath}`,
        image: `${SITE_ORIGIN}/assets/og/${game}.jpg`
    };
}

/**
 * free.html을 읽어 OG 메타를 방 정보로 교체한 HTML을 돌려준다.
 *
 * @param {string} htmlPath  free.html 절대 경로
 * @param {object} opts
 * @param {string} opts.game     게임 슬러그 (dice/roulette/horse/...)
 * @param {string} opts.urlPath  이 방의 링크 경로 (예: /free/horse/AB12C, /horse-race/AB12C)
 * @param {object|null} opts.room  메모리상의 방 객체. 없으면(만료) 기본 메타 유지.
 */
function renderFreeHtml(htmlPath, { game, urlPath, room }) {
    const html = readHtml(htmlPath);

    if (!room || !GAME_LABELS[game]) return html;

    const startIdx = html.indexOf(META_START);
    const endIdx = html.indexOf(META_END);
    if (startIdx === -1 || endIdx === -1) return html;

    const block = buildMetaBlock(buildRoomMeta(game, urlPath, room));
    return html.slice(0, startIdx) + block.trimStart() + html.slice(endIdx + META_END.length);
}

module.exports = { renderFreeHtml };
