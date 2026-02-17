/**
 * Before/After Screenshot Automation Script
 *
 * Before 상태와 After 상태를 자동으로 전환하면서
 * 각 게임 페이지의 스크린샷을 번호별로 촬영합니다.
 *
 * Usage:
 *   node scripts/screenshot-before-after.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;

// 촬영 시나리오 정의
const scenarios = [
  // 주사위 게임
  {
    number: '01',
    name: 'dice-main',
    url: '/dice-game-multiplayer.html',
    description: '주사위 게임 메인 화면',
    viewport: { width: 1920, height: 1080 }
  },
  {
    number: '02',
    name: 'dice-ready-button',
    url: '/dice-game-multiplayer.html',
    description: '주사위 게임 준비 버튼',
    viewport: { width: 1920, height: 1080 },
    action: async (page) => {
      // 준비 버튼에 hover
      await page.hover('.ready-button').catch(() => {});
    }
  },
  {
    number: '03',
    name: 'dice-room-list',
    url: '/dice-game-multiplayer.html',
    description: '주사위 게임 방 목록',
    viewport: { width: 1920, height: 1080 },
    clip: { x: 0, y: 200, width: 1920, height: 600 }
  },

  // 룰렛 게임
  {
    number: '04',
    name: 'roulette-main',
    url: '/roulette-game-multiplayer.html',
    description: '룰렛 게임 메인 화면',
    viewport: { width: 1920, height: 1080 }
  },
  {
    number: '05',
    name: 'roulette-ready-button',
    url: '/roulette-game-multiplayer.html',
    description: '룰렛 게임 준비 버튼',
    viewport: { width: 1920, height: 1080 },
    action: async (page) => {
      await page.hover('.ready-button').catch(() => {});
    }
  },

  // 뽑기 게임
  {
    number: '06',
    name: 'crane-main',
    url: '/crane-game-multiplayer.html',
    description: '뽑기 게임 메인 화면',
    viewport: { width: 1920, height: 1080 }
  },
  {
    number: '07',
    name: 'crane-ready-button',
    url: '/crane-game-multiplayer.html',
    description: '뽑기 게임 준비 버튼',
    viewport: { width: 1920, height: 1080 },
    action: async (page) => {
      await page.hover('.ready-button').catch(() => {});
    }
  },

  // 경마 게임
  {
    number: '08',
    name: 'horse-main',
    url: '/horse-race-multiplayer.html',
    description: '경마 게임 메인 화면',
    viewport: { width: 1920, height: 1080 }
  },
  {
    number: '09',
    name: 'horse-ready-button',
    url: '/horse-race-multiplayer.html',
    description: '경마 게임 준비 버튼',
    viewport: { width: 1920, height: 1080 },
    action: async (page) => {
      await page.hover('.ready-button').catch(() => {});
    }
  },

  // 메인 페이지
  {
    number: '10',
    name: 'index-main',
    url: '/',
    description: '메인 페이지',
    viewport: { width: 1920, height: 1080 }
  }
];

// .bak 파일 목록
const bakFiles = [
  'dice-game-multiplayer.html',
  'roulette-game-multiplayer.html',
  'crane-game-multiplayer.html',
  'horse-race-multiplayer.html',
  'index.html'
];

/**
 * Before 상태로 전환 (.bak 파일 사용)
 */
async function switchToBefore() {
  console.log('📸 Before 상태로 전환 중...');

  for (const file of bakFiles) {
    const originalPath = path.join(__dirname, '..', file);
    const bakPath = `${originalPath}.bak`;
    const afterPath = `${originalPath}.after`;

    if (fs.existsSync(bakPath)) {
      // 현재 파일을 .after로 백업
      if (fs.existsSync(originalPath)) {
        fs.copyFileSync(originalPath, afterPath);
      }
      // .bak를 원본으로 복사
      fs.copyFileSync(bakPath, originalPath);
      console.log(`  ✓ ${file} → Before`);
    }
  }

  // 서버 재시작을 위한 대기
  console.log('⏳ 서버 반영 대기 (2초)...');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * After 상태로 복원 (.after 파일 사용)
 */
async function switchToAfter() {
  console.log('📸 After 상태로 복원 중...');

  for (const file of bakFiles) {
    const originalPath = path.join(__dirname, '..', file);
    const afterPath = `${originalPath}.after`;

    if (fs.existsSync(afterPath)) {
      // .after를 원본으로 복사
      fs.copyFileSync(afterPath, originalPath);
      // .after 파일 삭제
      fs.unlinkSync(afterPath);
      console.log(`  ✓ ${file} → After`);
    }
  }

  // 서버 반영 대기
  console.log('⏳ 서버 반영 대기 (2초)...');
  await new Promise(resolve => setTimeout(resolve, 2000));
}

/**
 * 스크린샷 촬영
 */
async function takeScreenshots(state) {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const outputDir = path.join(__dirname, '..', 'docs', 'frontend', state);

  // 디렉토리 생성
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log(`\n📸 ${state.toUpperCase()} 스크린샷 촬영 시작...\n`);

  for (const scenario of scenarios) {
    try {
      const url = `${BASE_URL}${scenario.url}`;
      console.log(`  ${scenario.number}. ${scenario.description}`);
      console.log(`     URL: ${url}`);

      // 페이지 이동
      await page.setViewportSize(scenario.viewport);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

      // 추가 액션 실행
      if (scenario.action) {
        await scenario.action(page);
        await page.waitForTimeout(500); // hover 효과 대기
      }

      // 스크린샷 촬영
      const filename = `${scenario.number}-${scenario.name}.png`;
      const filepath = path.join(outputDir, filename);

      const screenshotOptions = {
        path: filepath,
        fullPage: false
      };

      // clip 옵션이 있으면 추가
      if (scenario.clip) {
        screenshotOptions.clip = scenario.clip;
      }

      await page.screenshot(screenshotOptions);
      console.log(`     ✓ 저장: ${filename}\n`);

    } catch (error) {
      console.error(`     ✗ 실패: ${error.message}\n`);
    }
  }

  await browser.close();
  console.log(`✅ ${state.toUpperCase()} 스크린샷 촬영 완료!\n`);
}

/**
 * 메인 실행
 */
async function main() {
  console.log('🎬 Before/After 스크린샷 자동 촬영 시작\n');
  console.log('=' .repeat(60));

  try {
    // 1. Before 상태로 전환 및 촬영
    await switchToBefore();
    await takeScreenshots('before');

    console.log('=' .repeat(60));

    // 2. After 상태로 복원 및 촬영
    await switchToAfter();
    await takeScreenshots('after');

    console.log('=' .repeat(60));
    console.log('\n🎉 모든 스크린샷 촬영 완료!\n');
    console.log('📁 저장 위치:');
    console.log('   - Before: docs/frontend/before/');
    console.log('   - After:  docs/frontend/after/\n');
    console.log('💡 다음 단계: 같은 번호끼리 비교하여 색상 변경 사항 확인\n');

  } catch (error) {
    console.error('❌ 오류 발생:', error);

    // 오류 발생 시 After 상태로 복원 시도
    console.log('\n⚠️  오류로 인해 After 상태로 복원 중...');
    await switchToAfter().catch(() => {});

    process.exit(1);
  }
}

// 실행
if (require.main === module) {
  main();
}

module.exports = { takeScreenshots, switchToBefore, switchToAfter };
