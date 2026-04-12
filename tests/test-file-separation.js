/**
 * 파일 분리 검증 테스트 (HTTP 기반)
 *
 * 실행: node test-file-separation.js
 * 서버가 실행 중이어야 함 (node server.js)
 */

const http = require('http');
const https = require('https');

const BASE_URL = 'http://localhost:5173';

// 색상 출력
const colors = {
    green: (text) => `\x1b[32m${text}\x1b[0m`,
    red: (text) => `\x1b[31m${text}\x1b[0m`,
    yellow: (text) => `\x1b[33m${text}\x1b[0m`,
    cyan: (text) => `\x1b[36m${text}\x1b[0m`,
    bold: (text) => `\x1b[1m${text}\x1b[0m`
};

// HTTP GET 요청
function httpGet(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        }).on('error', reject);
    });
}

// 테스트 결과 저장
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

// 테스트 실행
async function test(name, fn) {
    try {
        await fn();
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(colors.green(`  ✓ ${name}`));
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: error.message });
        console.log(colors.red(`  ✗ ${name}`));
        console.log(colors.red(`    → ${error.message}`));
    }
}

// 어설션 함수
function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertContains(text, substring, message) {
    if (!text.includes(substring)) {
        throw new Error(`${message}: "${substring}" not found`);
    }
}

// ==================== 테스트 케이스 ====================

function isReactHorseApp(html) {
    return html.includes('/horse-app/assets/') || html.includes('/src/main.tsx');
}

async function testHTMLLoad() {
    const res = await httpGet(`${BASE_URL}/horse-race`);
    assertEqual(res.status, 200, 'HTML status');
    assertContains(res.data, '<!DOCTYPE html>', 'DOCTYPE');

    if (isReactHorseApp(res.data)) {
        assertContains(res.data, '/horse-app/assets/', 'React bundle link');
    } else {
        assertContains(res.data, '<link rel="stylesheet" href="/css/horse-race.css">', 'Legacy CSS link');
        assertContains(res.data, '<script src="/js/horse-race.js">', 'Legacy JS link');
    }
}

async function testCSSLoad() {
    const html = await httpGet(`${BASE_URL}/horse-race`);
    if (isReactHorseApp(html.data)) {
        const cssPathMatch = html.data.match(/href="(\/horse-app\/assets\/[^\"]+\.css)"/);
        assert(cssPathMatch && cssPathMatch[1], 'React CSS bundle path not found');
        const res = await httpGet(`${BASE_URL}${cssPathMatch[1]}`);
        assertEqual(res.status, 200, 'React CSS bundle status');
        assert(res.data.length > 1000, 'React CSS bundle too small');
        return;
    }

    const res = await httpGet(`${BASE_URL}/css/horse-race.css`);
    assertEqual(res.status, 200, 'Legacy CSS status');
    assert(res.data.length > 10000, 'Legacy CSS file too small');
    assertContains(res.data, '.race-track', 'race-track class');
    assertContains(res.data, '@keyframes', 'keyframes');
}

async function testJSLoad() {
    const html = await httpGet(`${BASE_URL}/horse-race`);
    if (isReactHorseApp(html.data)) {
        const bundlePathMatch = html.data.match(/src="(\/horse-app\/assets\/[^\"]+\.js)"/);
        assert(bundlePathMatch && bundlePathMatch[1], 'React JS bundle path not found');
        const res = await httpGet(`${BASE_URL}${bundlePathMatch[1]}`);
        assertEqual(res.status, 200, 'React JS bundle status');
        assert(res.data.length > 10000, 'React bundle too small');
        return;
    }

    const res = await httpGet(`${BASE_URL}/js/horse-race.js`);
    assertEqual(res.status, 200, 'Legacy JS status');
    assert(res.data.length > 100000, 'Legacy JS file too small');
    assertContains(res.data, 'var socket', 'socket variable');
    assertContains(res.data, 'var currentRoomId', 'currentRoomId variable');
    assertContains(res.data, 'function startRaceAnimation', 'startRaceAnimation function');
}

async function testSocketIOLoad() {
    const res = await httpGet(`${BASE_URL}/socket.io/socket.io.js`);
    assertEqual(res.status, 200, 'Socket.IO status');
    assertContains(res.data, 'socket.io', 'socket.io reference');
}

async function testSharedModules() {
    const modules = ['chat-shared.js', 'ready-shared.js', 'order-shared.js'];
    for (const mod of modules) {
        const res = await httpGet(`${BASE_URL}/${mod}`);
        assertEqual(res.status, 200, `${mod} status`);
    }
}

async function testSoundManager() {
    const res = await httpGet(`${BASE_URL}/assets/sounds/sound-manager.js`);
    assertEqual(res.status, 200, 'Sound manager status');
    assertContains(res.data, 'SoundManager', 'SoundManager class');
}

async function testNoInlineScript() {
    const res = await httpGet(`${BASE_URL}/horse-race`);
    // 인라인 스크립트가 없어야 함 (script 태그 안에 코드가 없어야 함)
    const scriptTags = res.data.match(/<script[^>]*>[\s\S]*?<\/script>/gi) || [];
    const inlineScripts = scriptTags.filter(tag => {
        // src 속성이 있으면 외부 스크립트
        if (tag.includes('src=')) return false;
        // 내용이 비어있으면 OK
        const content = tag.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
        return content.length > 0;
    });
    assertEqual(inlineScripts.length, 0, `Found ${inlineScripts.length} inline scripts`);
}

async function testNoInlineStyle() {
    const res = await httpGet(`${BASE_URL}/horse-race`);
    // <style> 태그가 없어야 함
    const styleTags = res.data.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || [];
    assertEqual(styleTags.length, 0, `Found ${styleTags.length} style tags`);
}

async function testGlobalVariables() {
    const html = await httpGet(`${BASE_URL}/horse-race`);
    if (isReactHorseApp(html.data)) {
        // React 앱은 전역 var 기반이 아님
        return;
    }

    const res = await httpGet(`${BASE_URL}/js/horse-race.js`);
    const globalVars = [
        'var isLocalhost',
        'var currentRoomId',
        'var currentUser',
        'var isHost',
        'var isReady',
        'var socket'
    ];
    for (const v of globalVars) {
        assertContains(res.data, v, `Global variable: ${v}`);
    }
}

async function testHTMLStructure() {
    const res = await httpGet(`${BASE_URL}/horse-race`);

    if (isReactHorseApp(res.data)) {
        assertContains(res.data, 'id="root"', 'React root element');
        return;
    }

    const elements = [
        'id="lobbySection"',
        'id="gameSection"',
        'id="createRoomSection"',
        'id="resultOverlay"',
        'id="chatMessages"'
    ];
    for (const el of elements) {
        assertContains(res.data, el, `HTML element: ${el}`);
    }
}

async function testContentType() {
    const html = await httpGet(`${BASE_URL}/horse-race`);
    const htmlType = html.headers['content-type'] || '';
    assert(htmlType.includes('text/html'), `/horse-race: expected text/html, got ${htmlType}`);

    const tests = isReactHorseApp(html.data)
        ? []
        : [
            { url: '/css/horse-race.css', type: 'text/css' },
            { url: '/js/horse-race.js', type: 'application/javascript' }
        ];

    for (const t of tests) {
        const res = await httpGet(`${BASE_URL}${t.url}`);
        const contentType = res.headers['content-type'] || '';
        assert(
            contentType.includes(t.type) || contentType.includes('text/javascript'),
            `${t.url}: expected ${t.type}, got ${contentType}`
        );
    }
}

async function testFileSizes() {
    const html = await httpGet(`${BASE_URL}/horse-race`);

    if (isReactHorseApp(html.data)) {
        const len = html.data.length;
        assert(len >= 300 && len <= 30000, `/horse-race (react): size ${len} out of range`);
        return;
    }

    const expected = {
        '/horse-race': { min: 10000, max: 50000 },
        '/css/horse-race.css': { min: 30000, max: 80000 },
        '/js/horse-race.js': { min: 150000, max: 300000 }
    };
    for (const [path, size] of Object.entries(expected)) {
        const res = await httpGet(`${BASE_URL}${path}`);
        const len = res.data.length;
        assert(len >= size.min && len <= size.max,
            `${path}: size ${len} not in range [${size.min}, ${size.max}]`);
    }
}

// ==================== 메인 실행 ====================

async function runTests() {
    console.log('\n' + colors.bold('═'.repeat(50)));
    console.log(colors.bold('  파일 분리 검증 테스트'));
    console.log(colors.bold('═'.repeat(50)) + '\n');

    console.log(colors.cyan('📁 파일 로드 테스트'));
    await test('HTML 파일 로드', testHTMLLoad);
    await test('CSS 파일 로드', testCSSLoad);
    await test('JS 파일 로드', testJSLoad);
    await test('Socket.IO 로드', testSocketIOLoad);
    await test('공유 모듈 로드', testSharedModules);
    await test('사운드 매니저 로드', testSoundManager);

    console.log('\n' + colors.cyan('🔍 코드 검증'));
    await test('인라인 스크립트 없음', testNoInlineScript);
    await test('인라인 스타일 없음', testNoInlineStyle);
    await test('전역 변수 var 선언', testGlobalVariables);

    console.log('\n' + colors.cyan('📄 구조 검증'));
    await test('HTML 구조', testHTMLStructure);
    await test('Content-Type 헤더', testContentType);
    await test('파일 크기 범위', testFileSizes);

    // 결과 출력
    console.log('\n' + colors.bold('═'.repeat(50)));
    console.log(colors.bold('  테스트 결과'));
    console.log(colors.bold('═'.repeat(50)));
    console.log(`  통과: ${colors.green(results.passed)}`);
    console.log(`  실패: ${colors.red(results.failed)}`);
    console.log(`  총계: ${results.passed + results.failed}`);
    console.log(colors.bold('═'.repeat(50)) + '\n');

    if (results.failed === 0) {
        console.log(colors.green('✅ 모든 테스트 통과! 파일 분리 검증 완료\n'));
        process.exit(0);
    } else {
        console.log(colors.red('❌ 일부 테스트 실패\n'));
        process.exit(1);
    }
}

// 서버 연결 확인 후 테스트 실행
async function main() {
    try {
        await httpGet(BASE_URL);
        await runTests();
    } catch (error) {
        console.log(colors.red('\n❌ 서버에 연결할 수 없습니다.'));
        console.log(colors.yellow('   서버를 먼저 실행하세요: node server.js\n'));
        process.exit(1);
    }
}

main();
