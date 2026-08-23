// 링크 미리보기(og:image)용 게임별 카드 이미지 생성기.
//
// 실행:  node scripts/generate-og-cards.js
// 출력:  assets/og/{slug}.jpg (1200x630) + assets/og/free.jpg (기본 카드)
//
// 런타임 의존이 아니라 빌드용 일회성 스크립트다. 생성된 JPG는 커밋해서
// express.static이 /assets/og/*.jpg로 서빙한다.
// PNG는 그라데이션 때문에 장당 300KB를 넘어 저장소가 무거워진다 — JPEG 92로 굽는다.
// 게임 색상은 js/free.js의 GAME_GRADIENT와 같은 값을 유지할 것.

const path = require('path');
const { chromium } = require('playwright');

const OUT_DIR = path.join(__dirname, '..', 'assets', 'og');

const WIDTH = 1200;
const HEIGHT = 630;

const CARDS = [
    { slug: 'free',        emoji: '🎮', label: '친구랑 같이 놀기', gradient: ['#667eea', '#764ba2'] },
    { slug: 'dice',        emoji: '🎲', label: '주사위',           gradient: ['#667eea', '#764ba2'] },
    { slug: 'roulette',    emoji: '🎰', label: '룰렛',             gradient: ['#7c4dff', '#536dfe'] },
    { slug: 'horse',       emoji: '🐎', label: '경마',             gradient: ['#d2691e', '#8B4513'] },
    { slug: 'bridge',      emoji: '🌉', label: '다리건너기',       gradient: ['#42edff', '#1ec8da'] },
    { slug: 'ladder',      emoji: '🪜', label: '사다리타기',       gradient: ['#f59e0b', '#d97706'] },
    { slug: 'spin-arena',  emoji: '⚔️', label: '회전 칼날',        gradient: ['#7c5cff', '#22d3ee'] }
];

function cardHtml({ emoji, label, gradient }) {
    return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px;
    background: linear-gradient(135deg, ${gradient[0]} 0%, ${gradient[1]} 100%);
    font-family: 'Malgun Gothic', 'Segoe UI', sans-serif;
    color: #fff;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    position: relative; overflow: hidden;
  }
  /* 배경 장식 — 살짝 비치는 원 두 개 */
  .blob { position: absolute; border-radius: 50%; background: rgba(255,255,255,.10); }
  .blob-1 { width: 520px; height: 520px; top: -190px; right: -140px; }
  .blob-2 { width: 380px; height: 380px; bottom: -170px; left: -110px; }
  .emoji {
    font-size: 210px; line-height: 1;
    font-family: 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif;
    filter: drop-shadow(0 12px 28px rgba(0,0,0,.28));
  }
  .label {
    margin-top: 34px;
    font-size: 84px; font-weight: 800; letter-spacing: -2px;
    text-shadow: 0 6px 20px rgba(0,0,0,.30);
  }
  .brand {
    position: absolute; bottom: 46px;
    font-size: 34px; font-weight: 700; letter-spacing: 4px;
    opacity: .88;
  }
</style></head>
<body>
  <div class="blob blob-1"></div>
  <div class="blob blob-2"></div>
  <div class="emoji">${emoji}</div>
  <div class="label">${label}</div>
  <div class="brand">LAMDICE</div>
</body></html>`;
}

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1
    });

    for (const card of CARDS) {
        await page.setContent(cardHtml(card), { waitUntil: 'load' });
        const out = path.join(OUT_DIR, `${card.slug}.jpg`);
        await page.screenshot({ path: out, type: 'jpeg', quality: 92 });
        console.log(`생성: ${out}`);
    }

    await browser.close();
})().catch(err => {
    console.error('OG 카드 생성 실패:', err);
    process.exit(1);
});
