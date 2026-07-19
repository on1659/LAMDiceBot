// QA (일회성 라이브 검증): 시즌별 탈것 통계 — DB upsert + 조회 + API 계약
//
// 검증 계약 (docs/goal/horse-vehicle-stats-ui.md):
//   D1: recordVehicleSeasonResult 최초 upsert — (server, current_season, vehicle) 행 생성, rank_N/pick 정확
//   D2: 같은 (server, season, vehicle) 2회 upsert — appearance/pick/rank 누적
//   D3: rank 범위 밖(0, 7) — rank 컬럼 없이 upsert (appearance만 증가)
//   D4: 존재하지 않는 serverId — 행 0개 + throw 없음 (INSERT..SELECT 빈 결과)
//   D5: serverId null / season null 가드 — 조용히 skip / []
//   D6: current_season 변경 후 기록 — 새 시즌 행 분리 (기존 시즌 행 불변, 쓰기 시점 스냅샷)
//   D7: getSeasonVehicleStats 정렬 — rank_1 DESC, 동률 시 승률 DESC
//   A1: GET /api/ranking/:id/vehicles — success/season/vehicles(<=3)/win_rate
//   A2: ?season=N 지정 조회 / 데이터 없는 시즌 → vehicles: []
//   A3: ?season=abc | ?season=-1 → 400 / serverId=0 → 400 / serverId=abc → 404
//   A4: ON DELETE CASCADE — 서버 삭제 시 시즌 통계 동반 삭제
//
// 전제: 로컬 PostgreSQL + 로컬 서버(5173). 실행: node AutoTest/qa-vehicle-season-stats-db-test.js
require('../config'); // .env 로드
const { initPool, getPool } = require('../db/pool');
const { recordVehicleSeasonResult, getSeasonVehicleStats } = require('../db/vehicle-stats');

const URL = 'http://localhost:5173';

(async () => {
    let pass = true;
    const check = (cond, label, detail) => {
        console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? '  [' + detail + ']' : ''));
        if (!cond) pass = false;
    };

    initPool();
    const pool = getPool();
    if (!pool) { console.log('SETUP FAIL: 로컬 DB 없음 — 이 테스트는 DB 필수'); process.exit(2); }

    // 테스트 서버 행 (current_season = 2)
    const sv = await pool.query(
        `INSERT INTO servers (name, host_id, host_name, current_season) VALUES ('QA탈것시즌테스트', 'qa-vss-host', 'qa', 2) RETURNING id`
    );
    const sid = sv.rows[0].id;
    const sv2 = await pool.query(
        `INSERT INTO servers (name, host_id, host_name) VALUES ('QA탈것시즌빈서버', 'qa-vss-host2', 'qa') RETURNING id`
    );
    const sidEmpty = sv2.rows[0].id;
    console.log('QA test server id:', sid, '/ empty server id:', sidEmpty);

    const q = async (season) => (await pool.query(
        `SELECT vehicle_id, appearance_count, pick_count, rank_1, rank_2, rank_3 FROM vehicle_season_stats WHERE server_id=$1 AND season=$2 ORDER BY vehicle_id`,
        [sid, season])).rows;

    try {
        // ── D1: 최초 upsert ──
        // 3인 배팅: 2명이 horse 0(rocket), 1명이 horse 1(turtle)
        await recordVehicleSeasonResult(sid,
            [{ horseIndex: 0, rank: 1 }, { horseIndex: 1, rank: 2 }],
            ['rocket', 'turtle'],
            { userA: 0, userB: 0, userC: 1 });
        let rows = await q(2);
        const rocket = rows.find(r => r.vehicle_id === 'rocket');
        const turtle = rows.find(r => r.vehicle_id === 'turtle');
        check(rows.length === 2 && rocket && rocket.appearance_count === 1 && rocket.pick_count === 2 && rocket.rank_1 === 1
            && turtle && turtle.appearance_count === 1 && turtle.pick_count === 1 && turtle.rank_2 === 1,
            'D1: 최초 upsert (rocket: app1/pick2/r1=1, turtle: app1/pick1/r2=1)', JSON.stringify(rows));

        // ── D2: 누적 upsert ──
        await recordVehicleSeasonResult(sid,
            [{ horseIndex: 0, rank: 1 }, { horseIndex: 1, rank: 2 }],
            ['rocket', 'turtle'],
            { userA: 0, userB: 0, userC: 1 });
        rows = await q(2);
        const rocket2 = rows.find(r => r.vehicle_id === 'rocket');
        check(rocket2 && rocket2.appearance_count === 2 && rocket2.pick_count === 4 && rocket2.rank_1 === 2,
            'D2: 2회 upsert 누적 (rocket: app2/pick4/r1=2)', JSON.stringify(rocket2));

        // ── D3: rank 범위 밖 ──
        await recordVehicleSeasonResult(sid,
            [{ horseIndex: 0, rank: 0 }, { horseIndex: 1, rank: 7 }],
            ['bird', 'crab'], {});
        rows = await q(2);
        const bird = rows.find(r => r.vehicle_id === 'bird');
        const crab = rows.find(r => r.vehicle_id === 'crab');
        const rankSum = bird ? (bird.rank_1 + bird.rank_2 + bird.rank_3) : -1;
        check(bird && bird.appearance_count === 1 && rankSum === 0 && crab && crab.appearance_count === 1,
            'D3: rank 0/7 — rank 컬럼 없이 appearance만 증가', JSON.stringify([bird, crab]));

        // ── D4: 존재하지 않는 serverId ──
        let threw = false;
        try {
            await recordVehicleSeasonResult(99999999, [{ horseIndex: 0, rank: 1 }], ['rocket'], { u: 0 });
        } catch (e) { threw = true; }
        const ghostRows = (await pool.query(`SELECT count(*)::int AS c FROM vehicle_season_stats WHERE server_id=$1`, [99999999])).rows[0].c;
        check(!threw && ghostRows === 0, 'D4: 없는 serverId — throw 없음 + 행 0', 'threw=' + threw + ' rows=' + ghostRows);

        // ── D5: null 가드 ──
        threw = false;
        try {
            await recordVehicleSeasonResult(null, [{ horseIndex: 0, rank: 1 }], ['rocket'], { u: 0 });
        } catch (e) { threw = true; }
        const emptyRes = await getSeasonVehicleStats(sid, null);
        check(!threw && Array.isArray(emptyRes) && emptyRes.length === 0,
            'D5: serverId null skip / season null → []', 'threw=' + threw + ' res=' + JSON.stringify(emptyRes));

        // ── D6: 시즌 전환 후 기록 분리 (쓰기 시점 current_season 스냅샷) ──
        await pool.query(`UPDATE servers SET current_season = 3 WHERE id = $1`, [sid]);
        await recordVehicleSeasonResult(sid,
            [{ horseIndex: 0, rank: 1 }], ['rocket'], { userA: 0 });
        const s2rows = await q(2);
        const s3rows = await q(3);
        const s2rocket = s2rows.find(r => r.vehicle_id === 'rocket');
        const s3rocket = s3rows.find(r => r.vehicle_id === 'rocket');
        check(s2rocket && s2rocket.appearance_count === 2 && s3rocket && s3rocket.appearance_count === 1 && s3rocket.rank_1 === 1,
            'D6: 시즌 3 전환 후 기록 — 시즌2 행 불변(app2) + 시즌3 신규 행(app1)', 's2=' + JSON.stringify(s2rocket) + ' s3=' + JSON.stringify(s3rocket));

        // ── D7: 정렬 (rank_1 DESC → 승률 DESC) ──
        // 시즌 4에 인위 데이터: A(r1=3, app=10, 승률 .3) B(r1=3, app=5, 승률 .6) C(r1=5, app=20)
        await pool.query(`UPDATE servers SET current_season = 4 WHERE id = $1`, [sid]);
        await pool.query(
            `INSERT INTO vehicle_season_stats (server_id, season, vehicle_id, appearance_count, pick_count, rank_1) VALUES
             ($1, 4, 'vehA', 10, 0, 3), ($1, 4, 'vehB', 5, 0, 3), ($1, 4, 'vehC', 20, 0, 5), ($1, 4, 'vehZ', 0, 0, 0)`,
            [sid]);
        const sorted = await getSeasonVehicleStats(sid, 4);
        const order = sorted.map(r => r.vehicle_id).join(',');
        check(order === 'vehC,vehB,vehA,vehZ',
            'D7: 정렬 rank_1 DESC → 승률 DESC (+ appearance 0 NULLS LAST)', 'order=' + order);

        // ── A1: API 정상 조회 (season 지정) ──
        const r1 = await fetch(`${URL}/api/ranking/${sid}/vehicles?season=4`).then(r => r.json());
        const apiOrder = (r1.vehicles || []).map(v => v.vehicle_id).join(',');
        const vC = (r1.vehicles || [])[0];
        check(r1.success === true && r1.season === 4 && r1.vehicles.length === 3 && apiOrder === 'vehC,vehB,vehA'
            && vC && Math.abs(vC.win_rate - 0.25) < 1e-9,
            'A1: GET vehicles?season=4 — success/상위3/정렬/win_rate(5/20=.25)', JSON.stringify(r1));

        // ── A1b: season 생략 → current_season(4) 사용 ──
        const r1b = await fetch(`${URL}/api/ranking/${sid}/vehicles`).then(r => r.json());
        check(r1b.success === true && r1b.season === 4 && r1b.vehicles.length === 3,
            'A1b: season 생략 시 current_season 사용', 'season=' + r1b.season);

        // ── A2: 데이터 없는 시즌 / 빈 서버 → 빈 배열 (에러 아님) ──
        const r2 = await fetch(`${URL}/api/ranking/${sid}/vehicles?season=99`).then(r => r.json());
        const r2b = await fetch(`${URL}/api/ranking/${sidEmpty}/vehicles`).then(r => r.json());
        check(r2.success === true && r2.vehicles.length === 0 && r2b.success === true && r2b.vehicles.length === 0,
            'A2: 빈 시즌/빈 서버 → success + vehicles []', JSON.stringify({ r2, r2b }));

        // ── A3: 검증 분기 ──
        const s400a = (await fetch(`${URL}/api/ranking/${sid}/vehicles?season=abc`)).status;
        const s400b = (await fetch(`${URL}/api/ranking/${sid}/vehicles?season=-1`)).status;
        const s400c = (await fetch(`${URL}/api/ranking/0/vehicles`)).status;
        const s404 = (await fetch(`${URL}/api/ranking/abc/vehicles`)).status;
        check(s400a === 400 && s400b === 400 && s400c === 400 && s404 === 404,
            'A3: season=abc→400, season=-1→400, serverId=0→400, serverId=abc→404',
            `${s400a}/${s400b}/${s400c}/${s404}`);

        // ── A4: ON DELETE CASCADE ──
        await pool.query(`DELETE FROM servers WHERE id = $1`, [sidEmpty]);
        await pool.query(`DELETE FROM servers WHERE id = $1`, [sid]);
        const leftover = (await pool.query(`SELECT count(*)::int AS c FROM vehicle_season_stats WHERE server_id IN ($1, $2)`, [sid, sidEmpty])).rows[0].c;
        check(leftover === 0, 'A4: 서버 삭제 시 시즌 통계 CASCADE 삭제', 'leftover=' + leftover);
    } finally {
        // 안전망 정리 (실패 중단 시에도 테스트 행 제거)
        await pool.query(`DELETE FROM servers WHERE host_id IN ('qa-vss-host', 'qa-vss-host2')`).catch(() => {});
        await pool.query(`DELETE FROM vehicle_season_stats WHERE server_id IN ($1, $2)`, [sid, sidEmpty]).catch(() => {});
    }

    console.log('\n=== ' + (pass ? 'ALL PASS' : 'SOME FAILURES') + ' ===');
    process.exit(pass ? 0 : 1);
})().catch(e => {
    console.error('TEST ERROR:', e);
    process.exit(2);
});
