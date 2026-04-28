// 다리건너기 시나리오 결정 공정성 테스트
// socket/bridge-cross.js의 핵심 함수를 inline 복제하여 분포 측정.
// 코드 변경 시 동기화 필요.
//
// 실행: node AutoTest/bridge-cross-fairness-test.js

const BRIDGE_COLUMNS = 6;

function oppositeRow(row) { return row === 'top' ? 'bottom' : 'top'; }
function randomRow() { return Math.random() < 0.5 ? 'top' : 'bottom'; }
function makeRandomSafeRows() {
    return Array.from({ length: BRIDGE_COLUMNS }, () => randomRow());
}

function buildForcedFailPath(safeRows, brokenRows) {
    const path = [];
    const next = brokenRows.slice();
    for (let col = 0; col < BRIDGE_COLUMNS; col++) {
        if (next[col]) {
            path.push({ col, row: oppositeRow(next[col]), success: true });
            continue;
        }
        const row = oppositeRow(safeRows[col]);
        path.push({ col, row, success: false });
        next[col] = row;
        return { path, brokenRows: next };
    }
    return { path, brokenRows: next, impossible: true };
}

function buildRandomFailPath(safeRows, brokenRows) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const sim = brokenRows.slice();
        const path = [];
        for (let col = 0; col < BRIDGE_COLUMNS; col++) {
            const row = sim[col] ? oppositeRow(sim[col]) : randomRow();
            const success = row === safeRows[col];
            path.push({ col, row, success });
            if (!success) {
                sim[col] = row;
                return { path, brokenRows: sim };
            }
        }
    }
    return buildForcedFailPath(safeRows, brokenRows);
}

function buildPassPath(safeRows, brokenRows) {
    const path = [];
    for (let col = 0; col < BRIDGE_COLUMNS; col++) {
        const row = brokenRows[col] ? oppositeRow(brokenRows[col]) : safeRows[col];
        path.push({ col, row, success: true });
    }
    return { path };
}

function buildOutboundScenarios(M, winnerPos) {
    const safeRows = makeRandomSafeRows();
    let brokenRows = Array(BRIDGE_COLUMNS).fill(null);
    const paths = new Array(M);
    for (let i = 0; i < M; i++) {
        if (i === winnerPos) {
            paths[i] = buildPassPath(safeRows, brokenRows).path;
        } else {
            const r = buildRandomFailPath(safeRows, brokenRows);
            paths[i] = r.path;
            brokenRows = r.brokenRows;
        }
    }
    return { safeRows, paths, survivorPositions: [winnerPos], finalBrokenRows: brokenRows };
}

function simulateRound(activeColors) {
    const M = activeColors.length;
    const winnerPos = Math.floor(Math.random() * M);
    const outbound = buildOutboundScenarios(M, winnerPos);

    // 정합성: winnerPos 외 도전자는 마지막 step.success === false (=fail)
    const wrongFails = [];
    outbound.paths.forEach((p, i) => {
        const last = p[p.length - 1];
        if (i === winnerPos) {
            if (!last || !last.success) wrongFails.push({ idx: i, kind: 'winner-not-pass' });
        } else {
            if (last && last.success) wrongFails.push({ idx: i, kind: 'fail-passed' });
        }
    });

    return {
        winnerPos,
        winnerColor: activeColors[winnerPos],
        survivorPositions: outbound.survivorPositions,
        wrongFails
    };
}

function runTest(name, M, rounds) {
    console.log(`\n=== ${name} (M=${M}, ${rounds} rounds) ===`);
    const activeColors = Array.from({ length: M }, (_, i) => i);
    const winCount = new Array(M).fill(0);
    const survivorLengthDist = {};
    const correctnessFail = [];
    const ruleViolation = [];

    for (let r = 0; r < rounds; r++) {
        const result = simulateRound(activeColors);
        winCount[result.winnerPos]++;
        const sl = result.survivorPositions.length;
        survivorLengthDist[sl] = (survivorLengthDist[sl] || 0) + 1;

        if (sl !== 1 || result.survivorPositions[0] !== result.winnerPos) {
            correctnessFail.push({ round: r, winnerPos: result.winnerPos, survivors: result.survivorPositions });
        }
        if (result.wrongFails.length > 0) {
            ruleViolation.push({ round: r, winnerPos: result.winnerPos, wrong: result.wrongFails });
        }
    }

    const expected = rounds / M;
    const expectedPct = 100 / M;
    console.log(`색별 우승 수 (기대값 ${expected.toFixed(0)} = ${expectedPct.toFixed(1)}%):`);
    let maxDev = 0;
    winCount.forEach((c, i) => {
        const pct = (c / rounds * 100).toFixed(2);
        const dev = Math.abs((c / rounds - 1 / M) / (1 / M) * 100);
        if (dev > maxDev) maxDev = dev;
        console.log(`  색 ${i}: ${c} (${pct}%, dev ${dev.toFixed(1)}%)`);
    });
    console.log(`최대 편차: ${maxDev.toFixed(1)}% ${maxDev < 5 ? '✓ 균등' : '✗ 편향'}`);
    console.log(`survivorPositions 길이 분포:`, survivorLengthDist);
    console.log(`survivorPositions === [winnerPos] 정합성 실패: ${correctnessFail.length}`);
    console.log(`룰 위반(winner pass + 다른 색 fail): ${ruleViolation.length}`);
    if (correctnessFail.length > 0) console.log(`  첫 3건:`, correctnessFail.slice(0, 3));
    if (ruleViolation.length > 0) console.log(`  첫 3건:`, ruleViolation.slice(0, 3));
}

runTest('M=2 (베팅 색 2개)', 2, 10000);
runTest('M=3 (베팅 색 3개)', 3, 10000);
runTest('M=4 (베팅 색 4개)', 4, 20000);
runTest('M=6 (베팅 색 6개)', 6, 60000);
