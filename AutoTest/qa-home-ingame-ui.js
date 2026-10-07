/** 실제 /home 방 생성 후 반응형 화면·설정·튜토리얼을 검증한다. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.env.QA_URL || 'http://localhost:5175';
const WIDTHS = [375, 1280];
const HEIGHT = 812;
const WAIT = 15000;
const THEME_SETTLE_MS = 350;
const SHOTS = path.join(__dirname, '.shots');
const GAMES = {
    'horse-race': ['경마', '#startHorseRaceButton'],
    deguri: ['데구리', '#startDeguriButton'],
    dice: ['주사위', '#startButton'],
    roulette: ['룰렛', '#startRouletteButton']
};
function luminance(rgb) {
    const channels = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    const results = [];
    try {
        for (const [game, [label, start]] of Object.entries(GAMES)) {
            const context = await browser.newContext({ viewport: { width: WIDTHS[0], height: HEIGHT } });
            const errors = [];
            await context.route('**/*', route => /(^|\.)(googlesyndication\.com|doubleclick\.net)$/.test(new URL(route.request().url()).hostname) ? route.abort() : route.continue());
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(BASE + '/home');
            await page.evaluate(() => {
                localStorage.setItem('freeUserName', '화면' + Date.now() % 100000);
                localStorage.setItem('tutorialSeen_horse', 'v1');
                localStorage.setItem('tutorialSeen_dice', 'v1');
                localStorage.setItem('lamdiceTheme', 'light');
            });
            await page.reload();
            await page.locator(`.tile[data-game="${game}"]`).click();
            await page.locator('#gameSection.active').waitFor({ timeout: WAIT });
            await page.locator('#freeInviteBar').waitFor({ timeout: WAIT });
            assert.equal(await page.locator('.room-game-label').innerText(), label);
            // 로컬 전용 디버그 창은 화면 캡처에서만 제외한다.
            await page.addStyleTag({ content: '#debugLogSection { display: none !important; }' });
            const settings = page.locator('#hostControls details > summary').first();
            await settings.focus();
            await page.keyboard.press('Enter');
            assert.equal(await settings.evaluate(el => el.parentElement.open), true);
            await page.keyboard.press('Enter');
            assert.equal(await settings.evaluate(el => el.parentElement.open), false);
            assert.equal(await page.locator(start).isVisible(), true);
            await page.locator('#roomDockActivity').click();
            await page.locator('#room-tab-history').click();
            assert.equal(await page.locator('#room-panel-chat').isVisible(), false);
            assert.equal(await page.locator('#room-panel-history').isVisible(), true);
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.locator('#room-tab-orders').getAttribute('aria-selected'), 'true');
            await page.keyboard.press('Home');
            assert.equal(await page.locator('#chatInput').isVisible(), true);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#chatInput').isVisible(), false);
            assert.equal(await page.locator('#roomDockActivity').evaluate(el => el === document.activeElement), true);

            await page.locator('#roomDockActivity').click();
            await page.locator('#room-tab-orders').click();
            await page.evaluate(() => OrderModule.showOrderListModal('패널 전환 검증'));
            await page.waitForFunction(() => document.getElementById('orderListModal')?.contains(document.activeElement));
            assert.equal(await page.locator('body').evaluate(el => el.classList.contains('room-activity-open')), false);
            await page.keyboard.press('Escape');
            if (game === 'horse-race' || game === 'dice') {
                const target = game === 'horse-race' ? '#startOrderButton' : '#gameRulesSection';
                await page.evaluate(([game, target]) => {
                    const steps = game === 'horse-race' ? HORSE_RACE_TUTORIAL_STEPS : DICE_TUTORIAL_STEPS;
                    TutorialModule.start(game === 'horse-race' ? 'horse' : 'dice', [steps.find(step => step.target === target)], { force: true });
                }, [game, target]);
                assert.equal(await page.locator(target).isVisible(), true);
                await page.locator('#tutorialShadowHost .tutorial-btn-close').click();
                assert.equal(await page.locator(target).evaluate(el => (el.closest('details') || el).open), false);
                if (game === 'horse-race') {
                    await page.evaluate(() => TutorialModule.start('horse', [HORSE_RACE_TUTORIAL_STEPS.find(step => step.target === '#tutorialFakeOrders')], { force: true }));
                    assert.equal(await page.locator('#tutorialFakeOrders').isVisible(), true);
                    await page.locator('#tutorialShadowHost .tutorial-btn-close').click();
                    assert.equal(await page.locator('#chatInput').isVisible(), false);
                }
            }

            for (const theme of ['light', 'dark']) {
                await page.evaluate(theme => ThemeModule.set(theme), theme);
                await page.waitForTimeout(THEME_SETTLE_MS);
                for (const width of WIDTHS) {
                    await page.setViewportSize({ width, height: HEIGHT });
                    await page.evaluate(() => window.scrollTo(0, 0));
                    // 캔버스의 resize 핸들러가 새 폭을 적용한 뒤 레이아웃을 측정한다.
                    await page.waitForFunction(width => document.documentElement.scrollWidth <= width, width, { timeout: WAIT });
                    const metrics = await page.evaluate(start => {
                        const bar = document.querySelector('#freeInviteBar');
                        const text = bar.querySelector('.room-invite-label');
                        const button = document.querySelector(start);
                        return {
                            width: document.documentElement.scrollWidth,
                            gameTop: Math.round(document.querySelector('.room-playfield').getBoundingClientRect().top),
                            activityTop: Math.round(document.querySelector('.room-extras').getBoundingClientRect().top),
                            dockBottom: Math.round(document.querySelector('.room-action-dock').getBoundingClientRect().bottom),
                            sidebarLeft: Math.round(document.querySelector('.room-sidebar').getBoundingClientRect().left),
                            startBottom: Math.round(button.getBoundingClientRect().bottom),
                            inviteBackground: getComputedStyle(bar).backgroundColor,
                            inviteText: getComputedStyle(text).color
                        };
                    }, start);
                    assert.ok(metrics.startBottom < 650, `${game}: start requires scrolling at ${metrics.startBottom}`);
                    if (width < 760) {
                        assert.ok(metrics.dockBottom <= HEIGHT, `${game}: dock below viewport`);
                        await page.locator('#roomDockActivity').click();
                        assert.equal(await page.locator('#chatInput').isVisible(), true);
                        await page.locator('.room-sheet-close').click();
                    } else assert.ok(metrics.activityTop < 160, `${game}: chat not alongside game`);
                    assert.ok(metrics.width <= width, `${game}/${theme}/${width}: horizontal overflow`);
                    const contrast = [luminance(metrics.inviteBackground), luminance(metrics.inviteText)].sort((a, b) => b - a);
                    metrics.inviteContrast = (contrast[0] + 0.05) / (contrast[1] + 0.05);
                    assert.ok(metrics.inviteContrast >= 4.5, `${game}: invite contrast ${metrics.inviteContrast}`);
                    await page.screenshot({ path: path.join(SHOTS, `ingame-${game}-${theme}-${width}.png`), fullPage: true });
                    results.push({ game, theme, viewport: width, ...metrics });
                }
            }
            assert.deepEqual(errors, [], `${game}: page errors`);
            await context.close();
            console.log('PASS ' + game + ': mobile/desktop, light/dark, keyboard settings, tutorial');
        }
        fs.writeFileSync(path.join(SHOTS, 'ingame-ui-results.json'), JSON.stringify(results, null, 2));
        console.log('ALL PASS: 16 viewport/theme combinations');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
