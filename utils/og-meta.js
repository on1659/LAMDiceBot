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

// js/free.js의 GAME_LABELS와 같은 값을 유지할 것.
// 여기 없는 슬러그는 기본 메타를 그대로 쓴다.
const GAME_LABELS = {
    dice:         '주사위',
    roulette:     '룰렛',
    horse:        '경마',
    bridge:       '다리건너기',
    ladder:       '사다리타기',
    'spin-arena': '회전 칼날',
    pirate:       '해적 룰렛',
    deguri:       '데구리'
};

// 링크 미리보기 문구 — 요청마다 하나를 무작위로 고른다 (도발·설득 섞어서).
// 인원수는 넣지 않는다: 메신저는 방장이 링크를 보내는 순간 미리보기를 한 번만
// 가져가므로 그때는 항상 방장 1명이고, 이후 입장해도 갱신되지 않는다.
const DESCRIPTIONS = [
    label => `${label} 한 판 뜰 사람? 지면 핑계 금지.`,
    label => `${label}에서 실력 좀 보자. 안 들어오면 쫄은 걸로.`,
    label => `${label} 방장이 기다리는 중. 도망칠 거면 지금.`,
    label => `오늘 ${label} 꼴찌는 누구? 들어와서 확인해 봐.`,
    label => `${label} 1등 자리 비어 있음. 주인 찾는 중.`,
    label => `딱 ${label} 한 판만. 설치도 가입도 없이 누르면 끝.`,
    label => `${label} 방 열렸어요. 한 판이면 충분해요, 진짜로.`,
    label => `${label} 한 판 진다고 큰일 안 나요. 아마도.`
];

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

    // 자유 방은 "{닉네임}의 방"으로 자동 생성(socket/free.js),
    // 서버 방은 방을 만들 때 사용자가 직접 입력한 제목(socket/rooms.js).
    const roomName = (room.roomName || '').trim();
    const title = roomName
        ? `${roomName} · ${label} - LAMDice`
        : `${label} 방 - LAMDice`;

    const description = DESCRIPTIONS[Math.floor(Math.random() * DESCRIPTIONS.length)](label);

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
