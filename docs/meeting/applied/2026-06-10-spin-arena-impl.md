# spin-arena (회전 칼날) 구현 명세 — Source of Truth

> COMPLEX 신규 게임. base 골격 = horse-race-multiplayer.html, **실제 참조 모델 = ladder**
> (서버 결정론 시뮬 → reveal 페이로드 → Canvas 리플레이). 절차 = `.claude/rules/new-game.md`.
> 모든 공유 상수/키 이름은 이 문서가 권위. 서버·클라가 **반드시 동일 값** 사용.

---

## 0. 설계 결정 (막힘 기준 — 가장 단순·공정한 쪽 확정)

| 항목 | 결정 | 근거 |
|------|------|------|
| 고정 슬롯 수 | **6** (`SLOT_COUNT=6`) | ladder `LADDER_LANES=6` 선례, 모바일 가독성(명세 §21) |
| 최소 인원 | **2** (`SPIN_MIN_PLAYERS=2`) | 1명이면 "사람 기준 당첨" 무의미. 봇이 나머지 채움 |
| 칼날-칼날 충돌 | **제외**, 캐릭터-칼날만 판정 | 명세 §29 "단순한 쪽", 결정론 단순화 |
| 타임라인 전송 | **위치·HP 키프레임(100ms 샘플) + 탈락 이벤트**. 칼날 각도/링 반경은 t의 결정론 함수라 클라가 계산 | ladder의 "정적구조+progress 보간" 패턴, 페이로드 폭주 방지 |
| 서버 시뮬 | 고정 타임스텝(20ms) 30초, 100프레임마다 `await setImmediate` yield | horse.js CPU 블로킹 가드 선례 |
| 종료 트리거 | **서버 타이머**(`endTimeout`), 클라 핸드셰이크 없음 | ladder 패턴, 클라 신호 분실/조작 회피 |
| 시드 PRNG | socket/spin-arena.js 내부 mulberry32 (서버 전용). 시드는 서버 Math.random로 생성 | 프로젝트에 시퀀스 PRNG 선례 0 → 자체 구현 |
| 당첨(벌칙) 귀속 | **사람 중 최후 생존자 = 당첨자(selected)**. DB는 ladder loser 의미와 동일(selected→rank2/isWinner=false, 나머지 rank1/isWinner=true). 봇은 DB 제외 | 명세 §24, ladder DB 패턴 일관 |
| 스킨 | v1 프리셋 6종(순수 외형, 단색+칼날색). 영속 저장 없음. 봇=회색 | 명세 §31~34, §막힘기준 §75 |
| 사운드 | `spin-arena_*` 키를 기존 common mp3 재활용(새 mp3 없음) | 명세 §막힘기준, ladder sound 패턴 |

---

## 1. 공유 상수 (서버 socket/spin-arena.js 상단 const 블록 + 클라 js/spin-arena.js 상단 동일 정의)

```
// ─ 아레나(논리 좌표 고정, CSS 반응형) ─
ARENA_W = 480, ARENA_H = 480, ARENA_CX = 240, ARENA_CY = 240
ARENA_R = 220              // 바깥벽 반경

// ─ 슬롯/인원 ─
SLOT_COUNT = 6
SPIN_MIN_PLAYERS = 2

// ─ 시간축 ─
GAME_MS = 30000
SIM_DT_MS = 20             // 내부 시뮬 스텝(50fps)
SAMPLE_MS = 100            // 키프레임 샘플 간격 → frames 길이 = GAME_MS/SAMPLE_MS + 1 = 301
SIM_YIELD_EVERY = 100      // 이 스텝마다 await setImmediate (CPU 양보)

// ─ 캐릭터/칼날 ─
CHAR_RADIUS = 14
BLADE_COUNT = 2
BLADE_RADIUS = 46          // 캐릭터 중심 → 칼날 끝 거리
BLADE_TIP_R = 7            // 칼날 끝 충돌 반경
BLADE_SPIN_MIN = 2.2, BLADE_SPIN_MAX = 3.6   // rad/s (슬롯별 시드)

// ─ 체력/데미지 (200시드 배치 시뮬로 "최후 1인" 분포 튜닝 — h2/h3 ~98%, h6 ~90%가 정확히 1명 생존) ─
HP_MAX = 100
HIT_DPS = 42               // 칼날 1개가 몸에 겹친 동안 초당 데미지
RING_DPS = 14              // 안전링 밖일 때 초당 데미지

// ─ 안전구역 링(반경 = t의 함수) ─
RING_R_START = 220
RING_R_END = 90            // 결판 단계 최종 반경 — 최후 2인이 서로 피할 여지를 남겨 동시 전멸 방지
RING_PHASE1_MS = 10000     // 0~10s: 링 풀(RING_R_START)
RING_PHASE2_MS = 22000     // 10~22s: RING_R_START→RING_R_END 선형 수축, 이후 RING_R_END 유지

// ─ 이동 ─
DRIFT_SPEED = 34           // 초기 드리프트 속도(px/s) 기준
INWARD_ACCEL = 90          // 링 밖일 때 중심으로 끌어당기는 가속(px/s^2)
WALL_BOUNCE = 0.9          // 벽 반사 감쇠

// ─ 연출 타이밍 ─
RESULT_HOLD_MS = 2200      // 리플레이 끝난 뒤 결과 오버레이 전 여유(클라 자체 처리)
SPIN_RESET_DELAY = 4500    // gameEnd 후 다음 판 리셋까지(서버)
HISTORY_MAX = 100
```

### 링 반경 함수 (서버·클라 동일 구현)
```js
function ringRadiusAt(t) {                       // t: ms (0~GAME_MS)
  if (t <= RING_PHASE1_MS) return RING_R_START;
  if (t >= RING_PHASE2_MS) return RING_R_END;
  const k = (t - RING_PHASE1_MS) / (RING_PHASE2_MS - RING_PHASE1_MS);
  return RING_R_START + (RING_R_END - RING_R_START) * k;
}
```

### 칼날 끝 각도 (클라가 t로 계산 — 슬롯 meta의 baseAngle/spinSpeed/spinDir 사용)
```js
bladeAngle_k(slot, t, k) = slot.baseAngle + slot.spinDir * slot.spinSpeed * (t/1000) + k * (2π/BLADE_COUNT)
tip = { x: cx + BLADE_RADIUS*cos(angle), y: cy + BLADE_RADIUS*sin(angle) }   // cx,cy = 캐릭터 보간 위치
```

---

## 2. 스킨 프리셋 (서버·클라 동일 — 결과 무관, 순수 외형)

```js
const SPIN_SKINS = [
  { id: 'crimson',  name: '크림슨',  color: '#e23b3b', blade: '#ff7a7a' },
  { id: 'azure',    name: '애저',    color: '#3b82e2', blade: '#7ab0ff' },
  { id: 'emerald',  name: '에메랄드', color: '#2bb673', blade: '#6fe0a8' },
  { id: 'amber',    name: '앰버',    color: '#e2a23b', blade: '#ffce7a' },
  { id: 'violet',   name: '바이올렛', color: '#9b59e2', blade: '#c79aff' },
  { id: 'rose',     name: '로즈',    color: '#e23b8f', blade: '#ff7ac0' },
];
const SPIN_BOT_SKIN = { id: 'bot', name: '봇', color: '#9aa3ad', blade: '#c2c8cf' };
```
서버는 `skinId` 유효성만 검증(`SPIN_SKINS.some(s=>s.id===id)`), 색은 클라가 id로 조회. (페이로드엔 color/blade도 같이 실어 클라 단순화 — 아래 contract 참조.)

---

## 3. 데이터 계약 — 소켓 이벤트 (전부 `spin-arena:` 네임스페이스)

### 클라 → 서버
| 이벤트 | payload | 처리 |
|--------|---------|------|
| `spin-arena:selectSkin` | `{ skinId }` | idle 단계, 준비자만. `gameState.spinArena.skins[name]=skinId` 저장 후 `skinsUpdated` 브로드캐스트 |
| `spin-arena:start` | (없음) | 호스트만. 준비≥2 검증 → 슬롯 배정(사람+봇) → 시뮬 사전계산 → `reveal` emit → endTimeout |

### 서버 → 클라
| 이벤트 | payload | 의미 |
|--------|---------|------|
| `spin-arena:skinsUpdated` | `{ skins: {name:skinId} }` | 누가 어떤 스킨 골랐는지 동기화(스킨 피커 강조) |
| `spin-arena:reveal` | 아래 REVEAL 객체 | 30초 리플레이 데이터 전체. 클라는 받는 즉시 Canvas 재생 시작 |
| `spin-arena:gameEnd` | `{ selected, rankings, round }` | 최종 결과(클라는 리플레이 끝나고 오버레이 표시에 사용; reveal에도 result 포함되나 gameEnd는 종료 확정/주문 트리거 신호) |
| `spin-arena:gameAborted` | `{ reason }` | 참가자/호스트 이탈로 중단 |
| `spin-arena:roundReset` | (없음) | 다음 판 idle 복귀 — 스킨 피커 재표시 |
| `spin-arena:error` | `string` | 토스트 |

### REVEAL 객체 (server-only 정보 없음 — 결과 포함이지만 reveal=공개 시점이라 OK)
```js
{
  durationMs: 30000,
  sampleMs: 100,
  arena: { w:480, h:480, cx:240, cy:240, r:220 },
  ring:  { rStart:220, rEnd:64, phase1Ms:10000, phase2Ms:22000 },
  slots: [
    { id:0, isBot:false, name:'홍길동', skinId:'crimson', color:'#e23b3b', blade:'#ff7a7a',
      bladeCount:2, bladeRadius:46, baseAngle:1.23, spinSpeed:2.9, spinDir:1 },
    ... // 길이 = SLOT_COUNT(6)
  ],
  frames: [            // 길이 = 301. 각 원소 = 슬롯별 flat 배열: [x0,y0,hp0, x1,y1,hp1, ...] (정수 반올림)
    [240,120,100, ...],
    ...
  ],
  eliminations: [ { id:3, timeMs:14200, x:201, y:233 }, ... ],   // 탈락 순서(사람·봇 모두)
  result: {
    selected: '홍길동' | null,        // 사람 중 최후 생존자(당첨자) = 벌칙
    rankings: [                        // 사람만, survivalKey 내림차순(1등=당첨)
      { name:'홍길동', slotId:0, rank:1, eliminatedMs:null },
      { name:'김철수', slotId:1, rank:2, eliminatedMs:8700 }
    ]
  }
}
```
> **마스킹:** reveal 페이로드는 게임 시작(=공개) 시점에 전송되므로 결과 포함이 정상. 단 **idle/대기 중 재진입**(`getCurrentRoom`)에는 `spinArena` server-only 필드(`timeline/seed/result` 등)를 절대 싣지 않는다(§7 rooms.js 마스킹).

---

## 4. 서버 시뮬레이션 알고리즘 (socket/spin-arena.js — 결정론, 클라가 그대로 못 도는 무거운 계산)

```js
function mulberry32(seed){ return function(){ let t=(seed+=0x6D2B79F5); t=Math.imul(t^(t>>>15),t|1);
  t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; }; }

// slots: [{ id, isBot, name, skinId }] (길이 SLOT_COUNT). seed: 32bit int.
function simulate(slots, seed) {
  const rng = mulberry32(seed);
  // 1) 초기 상태: 슬롯을 중심 둘레에 균등 배치 + 약간의 시드 지터
  const st = slots.map((s, i) => {
    const baseAng = (i / SLOT_COUNT) * 2*Math.PI;
    const rr = ARENA_R * 0.55 + rng()*ARENA_R*0.1;
    const px = ARENA_CX + Math.cos(baseAng)*rr, py = ARENA_CY + Math.sin(baseAng)*rr;
    const vAng = rng()*2*Math.PI, sp = DRIFT_SPEED*(0.6+rng()*0.8);
    return {
      id:s.id, alive:true, hp:HP_MAX,
      x:px, y:py, vx:Math.cos(vAng)*sp, vy:Math.sin(vAng)*sp,
      baseAngle: rng()*2*Math.PI,
      spinSpeed: BLADE_SPIN_MIN + rng()*(BLADE_SPIN_MAX-BLADE_SPIN_MIN),
      spinDir: rng()<0.5 ? 1 : -1,
      eliminatedMs: null
    };
  });

  const frames = [];           // 키프레임(SAMPLE_MS 마다)
  const eliminations = [];
  const dt = SIM_DT_MS/1000;
  const totalSteps = Math.round(GAME_MS/SIM_DT_MS);   // 1500
  let nextSampleMs = 0;

  function sample(tMs){
    const f=[];
    for(const c of st){ f.push(Math.round(c.x), Math.round(c.y), Math.round(Math.max(0,c.hp))); }
    frames.push(f);
  }

  for (let step=0; step<=totalSteps; step++){
    const tMs = step*SIM_DT_MS;
    // 샘플(키프레임) — tMs가 nextSampleMs 도달 시
    if (tMs >= nextSampleMs){ sample(tMs); nextSampleMs += SAMPLE_MS; }
    if (step===totalSteps) break;

    const ring = ringRadiusAt(tMs);
    // 결판 규칙(st에 isBot 보유): 사람 최후 1인 확정(decided)이면 그 사람은 무적(서사 보호 — 선택엔 영향 없음,
    // 이미 당첨자 결정), 봇은 계속 갈려 정리(사람1+봇다수 동시정지 연출 방지). 전체 1명(allDone)이면 완전 정지.
    // 최후 2인 동시 전멸을 막아 거의 항상 화면에 사람 생존자 1명을 남긴다(배치 시뮬: h2/h3 ~98%, h6 ~90%가 정확히 1명).
    let humansAlive=0, totalAlive=0;
    for(const c of st){ if(c.alive){ totalAlive++; if(!c.isBot) humansAlive++; } }
    const decided = humansAlive<=1;   // 확정된 최후 사람 = 무적
    const allDone = totalAlive<=1;
    // 2) 칼날 끝 위치 계산(살아있는 캐릭터만)
    const tips=[];
    for(const c of st){ if(!c.alive) continue;
      for(let k=0;k<BLADE_COUNT;k++){
        const a=c.baseAngle + c.spinDir*c.spinSpeed*(tMs/1000) + k*(2*Math.PI/BLADE_COUNT);
        tips.push({owner:c.id, x:c.x+Math.cos(a)*BLADE_RADIUS, y:c.y+Math.sin(a)*BLADE_RADIUS});
      }
    }
    // 3) 데미지 — 캐릭터 vs 남의 칼날 (결판 후 noDamage면 0)
    const dmg={};
    if(!noDamage) for(const c of st){ if(!c.alive) continue; let d=0;
      for(const tp of tips){ if(tp.owner===c.id) continue;
        const dx=c.x-tp.x, dy=c.y-tp.y;
        if(dx*dx+dy*dy < (CHAR_RADIUS+BLADE_TIP_R)*(CHAR_RADIUS+BLADE_TIP_R)) d+=HIT_DPS*dt;
      }
      // 링 밖 지속 데미지
      const cdx=c.x-ARENA_CX, cdy=c.y-ARENA_CY; const cdist=Math.hypot(cdx,cdy);
      if(cdist > ring) d += RING_DPS*dt;
      dmg[c.id]=d;
    }
    // 4) 이동 적분 + 링 안쪽으로 끌기 + 벽 반사
    for(const c of st){ if(!c.alive) continue;
      const cdx=c.x-ARENA_CX, cdy=c.y-ARENA_CY; const cdist=Math.hypot(cdx,cdy)||1;
      if(cdist > ring){ // 링 밖이면 중심으로 가속
        c.vx += (-cdx/cdist)*INWARD_ACCEL*dt; c.vy += (-cdy/cdist)*INWARD_ACCEL*dt;
      }
      c.x += c.vx*dt; c.y += c.vy*dt;
      // 바깥벽 반사
      const nd=Math.hypot(c.x-ARENA_CX, c.y-ARENA_CY);
      if(nd > ARENA_R-CHAR_RADIUS){
        const nx=(c.x-ARENA_CX)/nd, ny=(c.y-ARENA_CY)/nd;
        c.x=ARENA_CX+nx*(ARENA_R-CHAR_RADIUS); c.y=ARENA_CY+ny*(ARENA_R-CHAR_RADIUS);
        const dot=c.vx*nx+c.vy*ny; c.vx=(c.vx-2*dot*nx)*WALL_BOUNCE; c.vy=(c.vy-2*dot*ny)*WALL_BOUNCE;
      }
    }
    // 5) HP 적용 + 탈락(동시 탈락은 적용 전 HP 높은 쪽이 나중 = tie-break)
    const justDead=[];
    for(const c of st){ if(!c.alive) continue; const before=c.hp; c.hp-=(dmg[c.id]||0);
      if(c.hp<=0){ c.hp=0; justDead.push({c, before}); } }
    justDead.sort((a,b)=> a.before - b.before);  // HP 낮은 쪽 먼저 탈락
    for(const jd of justDead){ jd.c.alive=false; jd.c.eliminatedMs=tMs;
      eliminations.push({id:jd.c.id, timeMs:tMs, x:Math.round(jd.c.x), y:Math.round(jd.c.y)}); }

    // (CPU 양보는 호출측 루프에서 SIM_YIELD_EVERY 마다 await setImmediate)
  }

  return { frames, eliminations, finalState: st };
}
```
> 위 함수는 동기지만 호출하는 `runSimulation`은 step 루프를 쪼개 `SIM_YIELD_EVERY`마다 `await new Promise(r=>setImmediate(r))`로 양보. (구현 단순화를 위해 simulate를 async로 만들고 내부 for문에 `if(step%SIM_YIELD_EVERY===0) await ...` 삽입해도 됨 — 둘 중 하나 선택, 핸들러는 async.)

### survivalKey 랭킹(사람만)
```js
// 사람 슬롯만. aliveAtEnd > eliminatedMs(클수록 위) > hpEnd(클수록 위) > slotId
function rankHumans(slots, finalState){
  const humans = slots.filter(s=>!s.isBot).map(s=>{
    const fs = finalState.find(f=>f.id===s.id);
    return { name:s.name, slotId:s.id,
      alive: fs.alive, elimMs: fs.eliminatedMs, hp: fs.hp };
  });
  humans.sort((a,b)=>{
    if(a.alive!==b.alive) return a.alive?-1:1;
    if(a.alive) return b.hp-a.hp;            // 둘 다 생존: HP 높은 쪽이 당첨(더 오래 버팀)
    if(a.elimMs!==b.elimMs) return b.elimMs-a.elimMs;  // 늦게 죽은 쪽 위
    return a.slotId-b.slotId;
  });
  return humans.map((h,i)=>({ name:h.name, slotId:h.slotId, rank:i+1,
    eliminatedMs: h.alive?null:h.elimMs }));
}
// selected(당첨) = rankings[0].name (사람 최후 생존자). 사람 0명이면 불가(min 2).
```

---

## 5. 서버 핸들러 구조 (socket/spin-arena.js — ladder 골격 그대로, 단계 단순화)

`gameState.spinArena` 단계(phase): `'idle'`(스킨 선택/대기) → `'playing'`(reveal 전송~endTimeout) → `'finished'`(결과) → reset → `'idle'`.

```
module.exports = (socket, io, ctx) => {
  const { updateRoomsList, getCurrentRoom, getCurrentRoomGameState } = ctx;
  const checkRateLimit = ctx.checkRateLimit || (()=>true);

  clearSpinTimers(sa)        // playTimeout/endTimeout/resetTimeout
  readyCount(gameState)      // ladder와 동일

  // selectSkin: idle + 준비자만. skinId 유효성. skins[name]=skinId. broadcast skinsUpdated
  socket.on('spin-arena:selectSkin', ...)

  // start: 호스트, phase idle|finished, 준비≥2
  //  - 이전 주문 cycle 가드 해제(ladder 패턴 499~501 복제)
  //  - participants = ready.slice(0, SLOT_COUNT)  (사람은 최대 6)
  //  - 슬롯 배정: 사람 먼저 id 0..(h-1)=각자 skins[name]||기본배정, 나머지 봇 id h..5 (isBot)
  //      · 스킨 미선택 사람은 남는 프리셋을 결정적으로 배정(인덱스 순)
  //  - seed = Math.floor(Math.random()*2147483647)  // 서버 RNG 허용
  //  - sim = await runSimulation(slots, seed)
  //  - rankings = rankHumans(slots, sim.finalState); selected = rankings[0]?.name||null
  //  - sa.phase='playing'; sa.isActive=true; sa.round 준비; sa.timeline 저장(server-only)
  //  - emit 'spin-arena:reveal' { durationMs, sampleMs, arena, ring, slots(공개 meta), frames, eliminations, result:{selected,rankings} }
  //  - endTimeout = setTimeout(endGame, GAME_MS + RESULT_HOLD_MS)
  //  - updateRoomsList()
  socket.on('spin-arena:start', ...)

  function endGame(room, gameState){
    clearSpinTimers(sa);
    // 참가자(사람) 없으면 abort
    sa.phase='finished'; sa.isActive=false; sa.round++;
    sa.history.push({ round, selected, timestamp });  // HISTORY_MAX 트림
    io.emit('spin-arena:gameEnd', { selected, rankings, round })
    // DB: 사람 참가자만
    const players = humanNames;
    recordGamePlay('spin-arena', players.length, room.serverId||null);
    if(room.serverId){
      const sessionId = generateSessionId('spin-arena', room.serverId);
      Promise.all(players.map(name=>{
        const isSelected = name===selected;     // 당첨 = ladder loser 의미
        const isWinner = !isSelected; const rank = isWinner?1:2;
        return recordServerGame(room.serverId, name, rank, 'spin-arena', isWinner, sessionId, rank);
      })).then(()=>recordGameSession({ serverId, sessionId, gameType:'spin-arena',
        gameRules:'spin-survival', winnerName: players.find(n=>n!==selected)||null,
        participantCount: players.length })).catch(e=>console.warn('[회전칼날] DB 기록 실패:', e.message));
    }
    if(ctx.triggerAutoOrder) ctx.triggerAutoOrder(gameState, room);
    sa.resetTimeout = setTimeout(()=>{ resetSpin; readyUsers=[]; users.isReady=false;
      emit('readyUsersUpdated'); emit('spin-arena:roundReset'); updateRoomsList(); }, SPIN_RESET_DELAY);
    updateRoomsList();
  }

  function resetSpin(sa){ clearSpinTimers; phase='idle'; skins={}; timeline=null; result=null;
    participants=[]; isActive=false; }

  // disconnect: 호스트 이탈 grace (ladder 587~618 복제)
  //  - playing: endTimeout 자연 종료 → 개입 안 함
  //  - idle: 타이머 없음. finished: resetTimeout 유지.
  socket.on('disconnect', ...)
};
// 테스트 export: module.exports.simulate / rankHumans / ringRadiusAt
```

> **rate limit**: 모든 핸들러 첫 줄 `if(!checkRateLimit()) return;`
> **updateRoomsList()**: phase/상태 변경마다 호출.

---

## 6. gameState 필드 (utils/room-helpers.js createRoomGameState — ladder 필드 다음에 추가)

```js
spinArena: {
  phase: 'idle',          // idle | playing | finished
  skins: {},              // { userName: skinId }
  participants: [],        // 시작 시점 사람 참가자 이름
  timeline: null,          // server-only: { slots, frames, eliminations } (재진입 마스킹 대상)
  result: null,            // server-only: { selected, rankings }
  seed: 0,                 // server-only
  round: 0,
  history: [],
  isActive: false,
  playTimeout: null, endTimeout: null, resetTimeout: null
}
```

---

## 7. 등록 14곳 (현재 line 기준 — ladder 선례 미러. 각 파일은 Coder가 직접 읽고 ladder 블록 옆에 추가)

> **불변조건:** 기존 게임 값 삭제/변경 금지, 추가만. surgical.

1. **socket/index.js** — `const registerSpinArenaHandlers = require('./spin-arena');`(line 9 ladder 옆), `registerSpinArenaHandlers(socket, io, ctx);`(line 187 ladder 옆).
2. **socket/rooms.js**
   - line 247 allowlist: `'spin-arena'` 추가 → `['dice','roulette','horse-race','crane-game','bridge','ladder','spin-arena']`
   - `getCurrentRoom` 재진입 마스킹(line 174~175 부근): `spinArena` server-only 필드 제거. 권장: 응답에서 `spinArena: gameState.spinArena ? { phase, skins, round, history } : undefined` 로 **timeline/result/seed 제외** (또는 `spinArena: undefined`로 통째 마스킹 + idle 재진입은 skinsUpdated 재emit). **timeline/result/seed가 reveal 전 노출되면 공정성 위반.**
   - leaveRoom cleanup(line 1175~1186 ladder 옆): 나간 사람 `spinArena.skins[name]` 삭제 + `skinsUpdated` 재emit(idle일 때).
3. **utils/room-helpers.js** — §6 필드.
4. **routes/api.js**
   - line 103~108: `app.get('/spin-arena', ...)` (ladder처럼 sendFile `spin-arena-multiplayer.html`)
   - line 266~269: `app.get('/spin-arena-multiplayer.html', (req,res)=>res.redirect(301,'/spin-arena'))`
   - line 23 `FREE_GAME_SLUGS`: `'spin-arena'` 추가
   - line 137 `SERVER_ROOM_DIRECT_PATHS`: `'/spin-arena'` 추가
   - line 161~166 isGameActive 판정: spin-arena phase('playing') 분기 추가
   - line 359 defaultGameStats: `'spin-arena': { count:0, totalParticipants:0 }`
5. **dice-game-multiplayer.html** (5 hunk, ladder 인용)
   - line 146 CSS: `.room-item.game-spin-arena { border-left-color: var(--spin-arena-500); }`
   - line 1685~1690 라디오 label: `spinArenaLabel`/`spinArenaRadio`, 아이콘 🌀(또는 ⚔️), NEW 뱃지, value=`spin-arena`
   - line 1706 colorMap: `'spin-arena': 'var(--game-type-spin-arena)'`
   - line 2869~2873 방카드 분기: `gameType==='spin-arena'` → icon/label/color
   - 3곳 redirect: joinSelectedRoom(3021~3032) `pendingSpinArenaJoin`→`/spin-arena?joinRoom=true`, finalizeRoomCreation(3945~3958) `pendingSpinArenaRoom`→`/spin-arena?createRoom=true`, joinRoomDirectly(4055~4064) `pendingSpinArenaJoin`→`/spin-arena?joinRoom=true`
6. **css/theme.css** — light(147~150 옆): `--spin-arena-500/-rgb/-600/-accent`, `--game-type-spin-arena`(161 옆). dark(347~350 옆) 동일. 색상: 보라+청록 계열 권장(회전/날 느낌). 예 `--spin-arena-500:#7c5cff; -rgb:124,92,255; -600:#6344e6; -accent:#22d3ee`.
7. **js/shared/tutorial-shared.js** — FLAG_BITS line 17(`ladder:64`) 다음 line 18: `'spin-arena': 128`.
8. **js/shared/server-select-shared.js** — set(821~827 ladder 옆): `localStorage.setItem('spinArenaUserName', name)`.
9. **db/stats.js** — DEFAULT_GAME_STATS(line 43): `'spin-arena': { count:0, totalParticipants:0 }`.
10. **routes/api.js defaultGameStats** — (4-line 359와 동일 hunk).
11. **db/ranking.js** — `getFullRanking`(391/399): `const spinArena = await getGameRanking(serverId,'spin-arena');` + 반환 객체에 `'spin-arena': spinArena`. **getMyRank/getTop3Badges는 ladder처럼 건드리지 않음**(불균일 선례 따름).
12. **assets/sounds/sound-config.json** — ladder 키(17~19) 옆: `"spin-arena_start"`, `"spin-arena_hit"`, `"spin-arena_eliminate"`, `"spin-arena_result"` → 전부 기존 common mp3 경로 재활용(예 ladder가 쓰는 common/*.mp3 동일 파일). 새 mp3 없음.

---

## 8. 클라이언트 (js/spin-arena.js — ladder.js 진입/모듈 패턴 + Canvas 리플레이)

### 8-1. 진입 IIFE (ladder.js line 84~ 미러)
- urlParams `createRoom`/`joinRoom` 확인. sessionStorage `spinArenaActiveRoom` 새로고침 재입장. 없으면 `/game` redirect.
- pending localStorage: `pendingSpinArenaRoom`(생성) / `pendingSpinArenaJoin`(입장)에서 serverId/serverName 읽어 setServerId.
- deviceId/tabId: ladder line 19~33 그대로 (Math.random 여기서만 — 공정성 OK). 키: `spinArenaDeviceId`, `tabId`(공용 유지).

### 8-2. roomJoined/roomCreated (new-game.md §5-2)
- sessionStorage `spinArenaActiveRoom` 저장. loadingScreen 숨김. `gameSection.classList.add('active')`.
- initChatModule/initReadyModule/initOrderModule/RankingModule.init/SoundManager.loadConfig/TutorialModule.setUser.
- hostControls 표시(isHost).
- **C-6 방어:** `body.classList.remove('spin-running')` (reconnect 재발신 대비).
- 스킨 피커 렌더(아래 8-4).

### 8-3. updateUsers — _common.md C-3 스니펫 그대로 + renderUsersList(new-game.md §5-3).

### 8-4. 스킨 피커 UI (gameSection 내 placeholder div `#spinSkinPicker`)
- SPIN_SKINS 6개 스와치 버튼 렌더. 클릭 → `socket.emit('spin-arena:selectSkin',{skinId})` + 로컬 강조.
- `spin-arena:skinsUpdated` 수신 → 각 스킨에 누가 골랐는지(닉네임 칩) 표시, 본인 선택 강조.
- idle 단계에서만 조작 가능. playing 동안 숨김.

### 8-5. Canvas 리플레이 (`#spinArenaCanvas`, 논리 480×480 고정, CSS 반응형)
```
canvas.width=ARENA_W; canvas.height=ARENA_H;  // 고정 논리좌표
on 'spin-arena:reveal'(payload):
  - 스킨 피커 숨김, body.classList.add('spin-running'), gameStatus 갱신
  - 사운드 spin-arena_start
  - replay = { payload, startTs: performance.now() }
  - requestAnimationFrame(loop)
loop(now):
  t = clamp(now - startTs, 0, durationMs)
  fi = t / sampleMs; i0=floor(fi); i1=min(i0+1,frames.length-1); a=fi-i0
  draw:
    1) 아레나 배경 원(반경 ARENA_R)
    2) 안전링: ringRadiusAt(t) 반경 점선 원. 링 밖 영역 살짝 어둡게(데미지 존)
    3) 각 슬롯: 보간 위치 (lerp frame[i0],frame[i1]). hp=lerp.
       - 탈락(해당 슬롯 eliminations.timeMs <= t): 회색 페이드/반투명 + 칼날 정지, HP바 숨김
       - 생존: 캐릭터 원(skin color), 닉네임(사람)·회색봇, HP바, 칼날 BLADE_COUNT개(blade color, t로 각도 계산)
    4) 새로 탈락 시각 지나면 1회 death burst(간단 파티클 — Math.random 금지, 슬롯 고정 오프셋) + spin-arena_eliminate 사운드
  if t < durationMs: rAF(loop)
  else: body.remove('spin-running'); 결과 오버레이 표시(payload.result 또는 gameEnd 데이터), spin-arena_result 사운드
```
- **반응형:** CSS `#spinArenaCanvas { width:100%; max-width:480px; aspect-ratio:1/1; height:auto; }`. 입력 없음(관전 전용)이라 좌표 역스케일 불필요.
- **death burst 파티클은 슬롯 id 기반 고정 각도**로 생성(클라 Math.random 0회 유지).

### 8-6. 결과 오버레이
- `resultOverlay`/`resultRankings`(공통 ID) 사용. `selected`(당첨자) 강조 + rankings 표시. ladder gameEnd 핸들러 미러.
- `spin-arena:roundReset` 수신 → 오버레이 닫고 스킨 피커 재표시, body.remove('spin-running').

### 8-7. 글로벌 함수 (new-game.md §5-4): sendMessage/handleChatKeypress/leaveRoom/closePasswordModal/submitPassword/closeResultOverlay. `startSpinArena()` = `socket.emit('spin-arena:start')` (호스트 버튼 onclick).

### 8-8. 공정성: js 내 Math.random은 deviceId/tabId 생성 **2~3회만**(ladder line 19~33 복제분). 그 외 0회. 칼날 회전·파티클·링 전부 결정론.

---

## 9. HTML (spin-arena-multiplayer.html — horse-race base 복사 후 교체)

- horse-race-multiplayer.html 복사.
- 메타(title/description/og/twitter/canonical/JSON-LD): "회전 칼날", URL `https://lamdice.com/spin-arena`.
- CSS link: theme.css → Tailwind → `/css/horse-race.css`(공통 layout 유지) → `/css/spin-arena.css`. (horse-shop.css 제거)
- script: 공통 모듈 유지(socket.io, page-history, chat, ready, order, ranking, countdown, sound-manager). **free-invite(horse 고유) 제거.** horse 고유 4스크립트 → `/js/spin-arena.js` 1개.
- ControlBar.init: `gameKey:'spin-arena'`, `soundKey:'spinArenaSoundEnabled'`.
- HORSE_RACE_TUTORIAL_STEPS 블록 제거(튜토리얼 후속).
- horse 고유 마크업(horseSelectionSection/raceTrackWrapper/replaySection/rouletteOverlay) 제거 → spin-arena 마크업:
  - `<div id="spinSkinPicker">` (스킨 피커)
  - `<div id="spinArenaWrap"><canvas id="spinArenaCanvas"></canvas></div>` (아레나)
  - 호스트 시작 버튼(hostControls 내) `onclick="startSpinArena()"`
- 공통 필수 ID 전부 유지: loadingScreen, controlBarMount, usersSection/usersCount/usersList/dragHint, readySection/readyCount/readyButton/readyUsersList, ordersSection, gameStatus, chatMessages/chatInput, historySection/historyList, resultOverlay/resultRankings, passwordModal.
- AdSense 블록 4곳 유지(삭제 금지).
- inline `var(--horse-*)` → §10 alias로 자동 해결(치환 불필요, but title/색 텍스트는 spin-arena 톤으로).
- showCustomAlert/showCustomConfirm inline script 유지.

---

## 10. CSS (css/spin-arena.css — new-game.md §3 함정 대응 + 아레나 스타일)

```css
:root {
  --spin-arena-gradient: linear-gradient(135deg, #7c5cff 0%, #22d3ee 100%);
  /* horse-race.css가 쓰는 var(--horse-*) alias (페이지별 link라 horse-race 페이지 무영향) */
  --horse-500: var(--spin-arena-500);
  --horse-600: var(--spin-arena-600);
  --horse-accent: var(--spin-arena-accent);
  --horse-gradient: var(--spin-arena-gradient);
  --horse-50: rgba(var(--spin-arena-500-rgb), 0.08);
  --horse-100: rgba(var(--spin-arena-500-rgb), 0.16);
  --horse-200: rgba(var(--spin-arena-500-rgb), 0.24);
  --horse-700: var(--spin-arena-600);
}
.container { max-width: 800px !important; }   /* C-1 */
.game-section { display: block; }             /* C-2 */
#spinArenaWrap { width:100%; max-width:480px; margin:0 auto; }
#spinArenaCanvas { width:100%; max-width:480px; aspect-ratio:1/1; height:auto; display:block;
  background:#0d1326; border-radius:16px; }
#spinSkinPicker { /* 스와치 그리드, 모바일 2~3열 */ }
```

---

## 11. 검증 (명세 §57~62)

```
node -c socket/spin-arena.js socket/index.js socket/rooms.js utils/room-helpers.js js/spin-arena.js server.js routes/api.js
grep -c "Math.random" js/spin-arena.js   # deviceId/tabId용 2~3회만
```
- 로컬 5173 + 2탭: dice 로비 라디오(spin-arena 색 강조) → 방생성 → `/spin-arena` redirect → loadingScreen 닫힘 → 스킨 선택 → 시작 → **2탭 동일 30초 리플레이 + 동일 당첨자** → 히스토리 누적.
- `.container` 800px, #usersCount 갱신, 채팅/준비/주문 동작, 호스트 새로고침 hostControls 유지.
- 경마/사다리/룰렛/주사위 미파손(공유 파일 회귀).
- **소켓 변경 → dev 서버 재시작 필수**(MEMORY: node server.js 자동 리로드 없음).

## 12. 완료 후 산출물
- update-log 기록(/summit). **새 리소스: 스킨=단색/도형 프리셋(에셋 파일 없음), 사운드=common mp3 재활용(새 mp3 없음)** 명시.
- goal 완료 시 `docs/goal/spin-arena.md` 경로를 `.claude/.goal-applied-queue`에 append.
</content>
</invoke>
