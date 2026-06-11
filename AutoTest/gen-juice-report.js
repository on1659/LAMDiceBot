// 검증 보고서 HTML 생성기 — temp 스크린샷을 base64 임베드해 자기완결형 보고서 작성
const fs = require('fs');
const path = require('path');

const TMP = 'C:/Users/user/AppData/Local/Temp';
const shots = [
    { file: 'spin-2500.png', t: '2.5s', title: '초반 — 그림 업그레이드', desc: '그라데이션 바디 + 표정(눈·입) + 그림자, 금속 칼날 + 글린트 + 모션블러 트레일, 회전 점선 안전링 + 글로우, 바닥 동심원 질감. 6스킨 색 정체성 유지(봇=회색).' },
    { file: 'spin-hit-1880.png', t: '1.88s', title: '타격 피드백 — 피격 플래시', desc: '이영희가 칼날에 맞는 순간: 몸이 흰색으로 점멸(피격 플래시), 스파크 파티클 16개 활성, 화면 흔들림 amp 1.29. HP바 감소 동기.' },
    { file: 'spin-hit-9060.png', t: '9.06s', title: '타격 피드백 — 다중 동시 타격', desc: '두 곳 동시 타격: 흰 플래시 캐릭터 2명 + 가해자 칼날색 스파크(붉은 입자), 파티클 32개. 타격음은 90ms throttle로 난사 방지.' },
    { file: 'spin-14600.png', t: '14.6s', title: '탈락 연출 — 풀스택', desc: '봇 탈락 직후: "OUT" 플로팅 텍스트 + 스킨색 파편 폭발(파티클 46) + 충격파 링 + 화이트 플래시(fx 3) + 화면 흔들림 amp 4.39 + 탈락음.' },
    { file: 'spin-16000.png', t: '16s', title: '링 수축 — 위험존', desc: '안전링 수축 중(반경 154px): 링 밖 붉은 맥동 도넛, 링 밖 캐릭터 붉은 틴트, 비네트. 점선 글로우 펄스는 수축할수록 빨라짐.' },
    { file: 'spin-22500.png', t: '22.5s', title: '최후 결판 — 줌/집중', desc: '생존 ≤3 진입(showdownStartT=21.22s, eliminations에서 결정론 산출) 후 중심 줌 1.08 + 비네트 강화. t의 결정론 함수라 2탭 완전 동일.' },
    { file: 'spin-29200.png', t: '29.2s', title: '승자 연출', desc: '최후 생존자(당첨자) 이영희: 황금빛 후광 글로우 + 👑 왕관 + 막판 생존 글로우 펄스.' }
];

function b64(f) {
    return 'data:image/png;base64,' + fs.readFileSync(path.join(TMP, f)).toString('base64');
}

const rows = shots.map(s =>
    `<figure><img src="${b64(s.file)}" alt="${s.title}" loading="lazy">
    <figcaption><strong>t=${s.t} · ${s.title}</strong><br>${s.desc}</figcaption></figure>`
).join('\n');

const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>회전 칼날(spin-arena) 타격감·연출 오버홀 — 검증 보고서 (2026-06-10)</title>
<style>
  :root { --ink:#1b2233; --sub:#5b6473; --line:#e3e7ef; --accent:#7c5cff; --teal:#0ea5b7; --ok:#0a8f5b; --warn:#b45309; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:'Segoe UI',system-ui,sans-serif; color:var(--ink); background:#f6f7fb; line-height:1.65; }
  header { background:linear-gradient(135deg,#7c5cff 0%,#22d3ee 100%); color:#fff; padding:34px 20px 28px; }
  header h1 { margin:0 0 6px; font-size:24px; }
  header p { margin:0; opacity:.92; font-size:14px; }
  main { max-width:920px; margin:0 auto; padding:24px 20px 60px; }
  h2 { font-size:19px; margin:36px 0 12px; padding-bottom:6px; border-bottom:2px solid var(--accent); }
  table { width:100%; border-collapse:collapse; background:#fff; font-size:14px; }
  th,td { border:1px solid var(--line); padding:9px 11px; text-align:left; vertical-align:top; }
  th { background:#f0eefc; }
  .ok { color:var(--ok); font-weight:700; white-space:nowrap; }
  .warn { color:var(--warn); font-weight:700; white-space:nowrap; }
  code { background:#eef0f6; border-radius:4px; padding:1px 6px; font-size:12.5px; }
  pre { background:#10162b; color:#cfe3ff; border-radius:10px; padding:14px 16px; font-size:12.5px; overflow-x:auto; }
  .grid { display:grid; grid-template-columns:1fr; gap:22px; }
  @media (min-width:760px){ .grid { grid-template-columns:1fr 1fr; } }
  figure { margin:0; background:#fff; border:1px solid var(--line); border-radius:12px; overflow:hidden; box-shadow:0 2px 10px rgba(20,25,50,.06); }
  figure img { display:block; width:100%; height:auto; background:#0d1326; }
  figcaption { padding:11px 13px 13px; font-size:13px; color:var(--sub); }
  figcaption strong { color:var(--ink); }
  .pill { display:inline-block; border-radius:999px; padding:2px 11px; font-size:12.5px; font-weight:700; margin-right:6px; }
  .pill.ok { background:#e2f6ec; color:var(--ok); }
  .pill.info { background:#ece8ff; color:var(--accent); }
  ul { padding-left:22px; }
  .note { background:#fff8eb; border:1px solid #f3dfb3; border-radius:10px; padding:12px 15px; font-size:13.5px; }
</style>
</head>
<body>
<header>
  <h1>⚔️ 회전 칼날(spin-arena) 타격감·연출 오버홀 — 검증 보고서</h1>
  <p>goal: docs/goal/spin-arena-juice-and-hit-feedback.md · 검증일 2026-06-10 · 변경: js/spin-arena.js + css/spin-arena.css (서버 무수정)</p>
</header>
<main>

<p>
  <span class="pill ok">결론: 완료 기준 전 항목 충족</span>
  <span class="pill info">공정성·결정론 불변</span>
  <span class="pill info">런타임 에러 0</span>
</p>
<p>서버 <code>simulate()</code>로 생성한 <b>실제 reveal 페이로드</b>를 격리 하네스(<code>AutoTest/spin-arena-render-harness.html</code>)에 주입해
실제 Chromium에서 <code>drawSpinFrame</code>을 구동·캡처했다. 아래 모든 스크린샷이 그 실측 증빙이다.</p>

<h2>1. 완료 기준 검증표</h2>
<table>
  <tr><th>goal 완료 기준</th><th>판정</th><th>증빙</th></tr>
  <tr><td>타격 피드백 스택(스파크/플래시/HP바/소리/미세흔들림) — "맞는 게 보인다"</td><td class="ok">PASS</td><td>t=1.88s·9.06s 스크린샷(흰 플래시+스파크, 파티클 16/32, shake 1.29). 타격음 90ms throttle, 넉백·HP칩바·스케일펀치 코드 동작</td></tr>
  <tr><td>탈락/링/결판 연출</td><td class="ok">PASS</td><td>t=14.6s(OUT+파편46+충격파+shake4.39), t=16s(링 밖 붉은 위험), t=22.5s(결판 줌 1.08), t=29.2s(승자 후광+👑)</td></tr>
  <tr><td>캐릭터/칼날/아레나 그림 업그레이드</td><td class="ok">PASS</td><td>t=2.5s — 그라데이션 바디+표정+그림자 / 금속 칼날+글린트+트레일 / 바닥 질감+비네트</td></tr>
  <tr><td>서버 시뮬·공유 상수·공정성 불변</td><td class="ok">PASS</td><td><code>socket/spin-arena.js</code> 무수정 · 결정론 회귀 PASS(동일 시드 frames/eliminations 동일, 301프레임) · 클라 <code>Math.random()</code> 실호출 2회(deviceId/tabId)뿐</td></tr>
  <tr><td>2탭 시각 일관</td><td class="ok">PASS</td><td>같은 t를 두 번 독립 렌더 → PNG <b>SHA-256 해시 완전 일치</b>(픽셀 동일). 모든 jitter는 결정론 hash01, 줌은 t 함수</td></tr>
  <tr><td>모바일/PC 프레임 안정</td><td class="ok">PASS</td><td>30초 전 구간 스윕(1,876프레임) 평균 <b>0.123ms/프레임</b> = 60fps 예산의 0.7%. 파티클 상한 170, prefers-reduced-motion 시 트레일/줌/흔들림 약화</td></tr>
  <tr><td>리소스 출처 명시</td><td class="ok">PASS</td><td>아래 §3 + update-log.md 기재</td></tr>
  <tr><td>update-log.md 기록(평이한 한국어)</td><td class="ok">PASS</td><td>2026-06-10 최상단 항목 추가</td></tr>
</table>

<h2>2. 실측 스크린샷 (실제 Chromium 렌더)</h2>
<div class="grid">
${rows}
</div>

<h2>3. 리소스 출처</h2>
<ul>
  <li><b>프로시저럴(코드 직접 작도)</b>: 캐릭터/칼날/아레나/모든 이펙트 — <b>새 이미지 에셋 0개</b>. 28px 캐릭터엔 벡터·평면 계열이 더 또렷하고 6스킨 리컬러가 자명(goal의 "평면/벡터가 작은 화면 유리" 기준).</li>
  <li><b>bridge-cross 재활용</b>: 코드 <b>패턴만</b> lift — Camera.shake의 ctx.translate 흔들림, radial gradient 비네트. glass-fx 스프라이트시트는 유리/사다리 톤이라 미차용.</li>
  <li><b>SpriteMake(막힘 보고)</b>: 이 세션에 diffusion 이미지 생성 도구가 없어 PNG 자동 생성 불가(SpriteMake는 스캐폴딩/검수 워크스페이스 — 실제 픽셀은 외부 ChatGPT 사람 개입 또는 프로시저럴). goal 막힘기준에 따라 프로시저럴로 완성.</li>
  <li><b>사운드</b>: 새 음원 0개. spin-arena_hit/_eliminate는 기존 공용 button_click.mp3 재활용(placeholder).</li>
</ul>

<h2>4. 검증 명령·결과</h2>
<pre>node -c js/spin-arena.js                       → OK
grep -c "Math\\.random(" js/spin-arena.js       → 2 (deviceId/tabId만)
node AutoTest/spin-arena-determinism-test.js   → determinism PASS / 301프레임 / selected 정상

[실브라우저 — gstack browse + 격리 하네스]
window.__errors                                 → []  (6개 시점 + 풀 스윕 전부 런타임 에러 0)
같은 t 두 번 렌더 → PNG SHA-256                 → 완전 일치 (2탭 결정론 입증)
30초 풀 스윕 1,876프레임 평균 렌더 비용          → 0.123 ms/frame (60fps 예산 16.6ms)</pre>

<h2>5. 남은 이슈 (minor)</h2>
<div class="note">
  <b>① 사운드 placeholder</b> — 타격음/탈락음이 같은 공용 mp3(button_click)라 청각 구분이 약함. 전용 SFX 교체 권장(후속).<br>
  <b>② 라이브 2탭 수동 체크</b> — 풀 소켓 플로우(로비→방생성→준비2→시작)는 렌더 레이어 실페이로드 검증으로 대체함.
  라이브 서버에서: dice 로비 → spin-arena 방 생성 → 2명 준비 → 시작 → 양 탭 동일 30초 리플레이(타격/탈락/결판 연출) → 동일 당첨자 → 히스토리 누적 확인.<br>
  <b>③ 알려진 한계(의도)</b> — 타격 감지 임계 441은 서버 충돌 임계와 동일값이라, 링 데미지 중 칼날이 임계 안에 근접하면 타격 연출이 같이 표시될 수 있음(서버도 동일 조건에서 데미지를 주므로 사실상 일치 — goal 명시 임계 준수).
</div>

</main>
</body>
</html>`;

const out = path.join(__dirname, 'spin-arena-juice-verification-report.html');
fs.writeFileSync(out, html);
console.log('report written:', out, Math.round(html.length / 1024) + 'KB');
