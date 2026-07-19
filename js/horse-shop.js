/*
 * horse-shop.js — 경마 꾸미기 상점 어댑터 (ShopModule 위에 얇은 게임 어댑터)
 *
 * 전역 `HorseShop`. 공통 셸(인증/지갑/모달/구매/장착/잔고연출)은 js/shared/shop-shared.js
 * (window.ShopModule)이 담당. 이 어댑터는 경마 고유부만 보유:
 *   - 차량 SVG 미리보기(buildPreview hook, getVehicleSVG 의존)
 *   - 내 탈것에 장착 적용(applyToHorse / applyEquippedToHorse / applyToActiveHorses)
 *   - 개인 연출(finish_fx playFinishFx) — 본인 장착을 본인 화면에서만
 *
 * 공개 API(window.HorseShop.*)는 기존 그대로 유지(호출부: js/horse-race.js, HTML onclick).
 *
 * 공정성: cosmetic 데이터는 결과 계산이나 게임 emit에 진입하지 않는다.
 *   도색 필터는 .vehicle-sprite 에만(이벤트 연출이 .horse filter 점유).
 *   Math.random()은 결승연출(playFinishFxInto) 조각의 외형(위치/딜레이/크기) 산개에만 사용 — 결과 무관.
 */
(function () {
    'use strict';

    var CATALOG_URL = '/config/horse/cosmetics.json';
    // 상점 탭(슬롯). finish_fx는 개인 연출 — 내가 장착하면 내 화면에만 적용(방장·우승 무관).
    var SLOTS = [
        { key: 'paint', label: '🎨 도색' },
        { key: 'trail', label: '✨ 잔상' },
        { key: 'accessory', label: '👑 액세서리' },
        { key: 'bib', label: '🏷️ 이름표' },
        { key: 'aura', label: '🌟 오라' },
        { key: 'finish_fx', label: '🎆 결승연출' }
    ];

    // 카드 썸네일에 실제 탈것을 그려 꾸미기 적용 모습을 미리보기로 보여줄 슬롯
    var HORSE_PREVIEW_SLOTS = ['paint', 'trail', 'accessory', 'bib', 'aura'];
    var PREVIEW_VEHICLE = 'car'; // 미리보기 샘플 탈것 (getVehicleSVG, horse-race-sprites.js)

    // ── 오라 스프라이트 아틀라스 (SpriteMake: horse-aura-cosmetics) ──
    //   /assets/cosmetics/aura-atlas.png : 512×2944, 4열(펄스 프레임) × 23행(오라별), 셀 128×128.
    //   행 순서는 매니페스트 rowOrder 기준 — 카탈로그 배열 순서와 다르다(rainbow=21, prism=22).
    //   아틀라스 로드 성공 시에만 data-aura-atlas 부여 → CSS가 스프라이트로 렌더.
    //   로드 실패(미배포 등) 시 data-aura-atlas 미부여 → 기존 currentColor 글로우로 안전 폴백.
    //   공정성: 순수 외관. 결과/속도/기믹/소켓 페이로드에 진입하지 않는다.
    var AURA_ATLAS_URL = '/assets/cosmetics/aura-atlas.png';
    var AURA_ATLAS_ROWS = {
        aura_red: 0, aura_blue: 1, aura_green: 2, aura_gold: 3, aura_violet: 4,
        aura_cyan: 5, aura_pink: 6, aura_orange: 7, aura_lime: 8, aura_white: 9,
        aura_indigo: 10, aura_ad_aqua: 11, aura_ad_flame: 12, aura_ad_mint: 13,
        aura_ad_amber: 14, aura_ad_rose: 15, aura_ad_teal: 16, aura_ad_silver: 17,
        aura_ad_cobalt: 18, aura_ad_neon: 19, aura_ad_plasma: 20,
        aura_rainbow: 21, aura_prism: 22
    };
    var auraAtlasReady = false;
    (function preloadAuraAtlas() {
        try {
            var img = new Image();
            img.onload = function () {
                auraAtlasReady = true;
                // 아틀라스가 늦게 로드되면 이미 그려진 내 탈것을 즉시 업그레이드(미리보기는 상점 재오픈 시 갱신).
                try { applyToActiveHorses(); } catch (e) {}
            };
            img.src = AURA_ATLAS_URL;
        } catch (e) {}
    })();

    // 오라 span에 시각효과 주입: currentColor 글로우 폴백 색 + (아틀라스 준비 시) 스프라이트 행 선택.
    //   auraItem = 카탈로그 오라 항목({ id, color, ... }). el = 빈 span(장식, aria-hidden).
    function applyAuraVisual(el, auraItem) {
        if (!el || !auraItem) return;
        if (auraItem.color) el.style.color = auraItem.color; // 폴백 글로우(currentColor 기반)
        var row = AURA_ATLAS_ROWS[auraItem.id];
        if (auraAtlasReady && row != null) {
            el.style.setProperty('--aura-row', String(row));
            el.setAttribute('data-aura-atlas', '');
        }
    }

    // 액세서리(머리 장식) 탈것별 앵커 — 외관 보정용(공정성 무관, Math.random 미사용).
    //   .cosmetic-accessory 의 offset parent 는 .horse(80×80). 스프라이트(60×45)는 flex 중앙정렬이라
    //   왼쪽 inset 10px, 위쪽 inset 17.5px. SVG viewBox(0..60, 0..45) head 좌표(vbX,vbY) →
    //   left = 10 + vbX, top = 17.5 + vbY (px, .horse 기준). 장식은 머리 바로 위에 얹히도록 y를 살짝 띄움.
    //   x = 머리의 가로 중심(화면 기준, helicopter 는 좌우반전 후 좌표). scale 은 폭 좁은 탈것에서 축소.
    //   탈것 추가(addvehicle) 시 항목 없으면 ACC_ANCHOR_DEFAULT 로 안전 폴백(클리핑 방지).
    var ACC_ANCHOR_DEFAULT = { x: 30, y: 6, scale: 1 };
    var ACC_ANCHOR = {
        car:        { x: 29, y: 8,  scale: 1 },   // 캐빈/앞유리 위, 중앙
        rocket:     { x: 50, y: 10, scale: 1 },   // 노즈콘 우측 상단
        bird:       { x: 48, y: 13, scale: 0.9 }, // 머리(원 cx48) 위, 우향
        boat:       { x: 30, y: 6,  scale: 1 },   // 돛/마스트 꼭대기, 중앙
        bicycle:    { x: 35, y: 7,  scale: 0.9 }, // 라이더 머리(cx35) 위
        rabbit:     { x: 45, y: 1,  scale: 0.85 },// 귀 끝(y~3)보다 위, 우향
        turtle:     { x: 30, y: 8,  scale: 1 },   // 등껍질 정수리
        eagle:      { x: 48, y: 13, scale: 0.9 }, // 머리(원 cx48) 위, 우향
        scooter:    { x: 25, y: 13, scale: 0.9 }, // 라이더 머리(cx25) 위
        helicopter: { x: 20, y: 8,  scale: 0.9 }, // 좌우반전 → 화면상 콕핏 x~20
        horse:      { x: 46, y: 8,  scale: 1 },   // 우측 머리(cx46-48, 귀끝 y~9) 위 — 말은 우향
        knight:     { x: 30, y: 2,  scale: 0.9 }, // 깃털 장식(y~4-5)보다 위, 중앙
        dinosaur:   { x: 41, y: 12, scale: 1 },   // 머리(x34-48) 위, 우중앙
        ninja:      { x: 31, y: 9,  scale: 0.85 },// 머리/머리띠(y~11) 위, 폭 좁음
        crab:       { x: 30, y: 16, scale: 1 }    // 눈자루(y~18) 위, 정면
    };

    // ── 미리보기 빌더 (getVehicleSVG 등 게임 전역 접근은 이 어댑터 안에서만) ──

    // 샘플 탈것 SVG 1프레임 HTML (없으면 빈 문자열)
    function sampleVehicleHTML() {
        if (typeof getVehicleSVG !== 'function') return '';
        try {
            var svgs = getVehicleSVG(PREVIEW_VEHICLE);
            if (!svgs) return '';
            var data = svgs.idle || svgs.run || svgs.rest || svgs;
            return (data && data.frame1) ? data.frame1 : (svgs.frame1 || '');
        } catch (e) { return ''; }
    }

    // (slot, item)을 실제 탈것에 입힌 미리보기 노드. paint=필터, trail/accessory/bib=오버레이.
    function buildItemPreview(slot, item) {
        var box = document.createElement('div');
        box.className = 'hshop-preview';

        if (slot === 'trail') {
            var tr = document.createElement('span');
            tr.className = 'hshop-preview-trail';
            tr.setAttribute('aria-hidden', 'true');
            applyTrailStreakVisual(tr, item);
            box.appendChild(tr);
        }

        // aura → 스프라이트 뒤(z-index 낮음) 글로우. 색은 인라인(item.color), CSS가 box-shadow/링 형태.
        if (slot === 'aura' && item.color) {
            var au = document.createElement('span');
            au.className = 'hshop-preview-aura';
            au.setAttribute('aria-hidden', 'true');
            applyAuraVisual(au, item); // 스프라이트(로드 시) 또는 currentColor 글로우 폴백
            box.appendChild(au);
        }

        var sprite = document.createElement('div');
        sprite.className = 'hshop-preview-sprite';
        sprite.innerHTML = sampleVehicleHTML(); // 상수 SVG (유저입력 없음)
        if (slot === 'paint' && item.filter) sprite.style.filter = item.filter;
        box.appendChild(sprite);

        if (slot === 'accessory' && item.emoji) {
            var ac = document.createElement('span');
            ac.className = 'hshop-preview-acc';
            ac.setAttribute('aria-hidden', 'true');
            ac.textContent = item.emoji;
            box.appendChild(ac);
        }
        if (slot === 'bib') {
            var bb = document.createElement('span');
            bb.className = 'hshop-preview-bib';
            bb.setAttribute('aria-hidden', 'true');
            var _nm = '이름';
            try { var _a = JSON.parse(localStorage.getItem('userAuth') || 'null'); if (_a && _a.name) _nm = _a.name; } catch (e) {}
            bb.textContent = _nm;   // 사용자 입력 → textContent (안전)
            if (item.color) bb.style.color = item.color;
            if (item.bg) bb.style.background = item.bg;
            if (item.border) bb.style.borderColor = item.border;
            box.appendChild(bb);
        }
        return box;
    }

    // 결승연출 미리보기: 큰 이모지 펄스 + 작은 조각 낙하 루프 + "▶ 미리보기"(실제 승리 연출 재생).
    //   미리보기 버튼 클릭 시 playFinishFxInto(stage, emoji)로 실제 in-race 결승 연출을 stage에 1회 재생.
    //   stage는 position:relative + overflow:hidden(CSS)이라 낙하가 카드 안에 클리핑된다.
    function buildFinishFxPreview(item) {
        var emoji = (item && item.emoji) ? item.emoji : '🎆';
        var box = document.createElement('div');
        box.className = 'hshop-fx-mini';

        var burst = document.createElement('span');
        burst.className = 'hshop-fx-burst';
        burst.setAttribute('aria-hidden', 'true');
        burst.textContent = emoji;
        box.appendChild(burst);

        for (var i = 0; i < 4; i++) {
            var p = document.createElement('span');
            p.className = 'hshop-fx-confetti';
            p.setAttribute('aria-hidden', 'true');
            p.textContent = emoji;
            p.style.left = (18 + i * 20) + '%';
            p.style.animationDelay = (i * 0.3) + 's';
            box.appendChild(p);
        }

        // 실제 결승 연출이 재생될 무대(빈 div). 낙하 클리핑은 CSS(.hshop-fx-stage)에서 보장.
        var stage = document.createElement('div');
        stage.className = 'hshop-fx-stage';
        stage.setAttribute('aria-hidden', 'true');
        box.appendChild(stage);

        // "▶ 미리보기" 버튼 — 클릭 시 실제 승리 연출 1회 재생(재생 중 disable, ~3500ms 후 해제).
        var playBtn = document.createElement('button');
        playBtn.type = 'button';
        playBtn.className = 'hshop-fx-preview-btn';
        playBtn.textContent = '▶ 미리보기';
        playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (playBtn.disabled) return;
            playBtn.disabled = true;
            playFinishFxInto(stage, emoji);
            setTimeout(function () { playBtn.disabled = false; }, 3500);
        });
        box.appendChild(playBtn);

        return box;
    }

    // ShopModule이 카드 썸네일에 부를 미리보기 hook (slot별 분기). null이면 셸이 글리프 fallback.
    function buildPreview(slot, item) {
        if (slot === 'finish_fx') return buildFinishFxPreview(item);
        if (HORSE_PREVIEW_SLOTS.indexOf(slot) !== -1 && typeof getVehicleSVG === 'function') {
            return buildItemPreview(slot, item);
        }
        return null;
    }

    // ── 인벤토리 큰 미리보기 (내 탈것 + 현재 장착 전부 합성) ──

    // 인벤토리 미리보기 탈것 로스터(셸 ◀▶ 스위처용). ALL_VEHICLES(js/horse-race.js)에서
    // id/name만 추려 노출. 아직 미로드/비었으면 'car' 단일 폴백(상점은 로스터 로드 전에도 열림).
    function inventoryVehicles() {
        var roster = (window.ALL_VEHICLES || []).map(function (v) { return { id: v.id, name: v.name }; });
        return roster.length ? roster : [{ id: 'car', name: '자동차' }];
    }

    // 내가 고른 탈것을 알면 그걸, 모르면 'car'(상점은 탈것 선택 전에도 열림). 전역은 가드하며 읽음.
    function myVehicleType() {
        try {
            var sel = window.selectedVehicleTypes;
            var bets = window.userHorseBets;
            var me = window.currentUser;
            if (sel && bets && me != null) {
                var idx = bets[me];
                if (idx != null && sel[idx]) return sel[idx];
            }
        } catch (e) {}
        return PREVIEW_VEHICLE;
    }

    // 지정 탈것 SVG 1프레임 HTML (없으면 빈 문자열) — sampleVehicleHTML의 vehicle 가변 버전.
    function vehicleHTML(vehicleType) {
        if (typeof getVehicleSVG !== 'function') return '';
        try {
            var svgs = getVehicleSVG(vehicleType);
            if (!svgs) return '';
            var data = svgs.idle || svgs.run || svgs.rest || svgs;
            return (data && data.frame1) ? data.frame1 : (svgs.frame1 || '');
        } catch (e) { return ''; }
    }

    // 인벤토리 상단 큰 미리보기 노드. mergedEquipped() 기준(실제 탈것에 보이는 것과 동일).
    // paint=sprite filter, trail/accessory=오버레이, bib=이름 라벨. 장착 0개면 빈 탈것이 안전하게 나옴.
    function buildInventoryPreview(vehicleId) {
        var eq = mergedEquipped();
        var vt = vehicleId || myVehicleType();

        var box = document.createElement('div');
        box.className = 'hshop-inv-preview';

        // 오라: 스프라이트 뒤 글로우. (기존 버그: 인벤토리 미리보기가 오라를 전혀 안 그려 "적용 안 됨"으로 보임 — 여기서 수정)
        if (eq.aura) {
            var invAura = findItem('aura', eq.aura);
            if (invAura && invAura.color) {
                var iau = document.createElement('span');
                iau.className = 'hshop-inv-aura';
                iau.setAttribute('aria-hidden', 'true');
                applyAuraVisual(iau, invAura);
                box.appendChild(iau); // 스프라이트 append 전에 넣어 뒤에 깔리게(z-index로도 보장)
            }
        }

        if (eq.trail) {
            var trail = findItem('trail', eq.trail);
            if (trail) {
                var tr = document.createElement('span');
                tr.className = 'hshop-inv-trail';
                tr.setAttribute('aria-hidden', 'true');
                applyTrailStreakVisual(tr, trail);
                box.appendChild(tr);
            }
        }

        var sprite = document.createElement('div');
        sprite.className = 'hshop-inv-sprite';
        sprite.innerHTML = vehicleHTML(vt); // 상수 SVG (유저입력 없음)
        var paint = eq.paint ? findItem('paint', eq.paint) : null;
        if (paint && paint.filter) sprite.style.filter = paint.filter;
        box.appendChild(sprite);

        if (eq.accessory) {
            var acc = findItem('accessory', eq.accessory);
            if (acc && acc.emoji) {
                var ac = document.createElement('span');
                ac.className = 'hshop-inv-acc';
                ac.setAttribute('aria-hidden', 'true');
                ac.textContent = acc.emoji;
                // 인벤토리 스프라이트는 120px(=60px 의 2배) 렌더 → 앵커 px 도 2배. 중앙(left:50%) 기준 가로 오프셋만 적용.
                var ia = ACC_ANCHOR[vt] || ACC_ANCHOR_DEFAULT;
                ac.style.setProperty('--acc-dx', ((ia.x - 30) * 2) + 'px'); // 스프라이트 가로중심(x=30) 대비 오프셋
                ac.style.setProperty('--acc-y', (ia.y * 2) + 'px');         // 스프라이트 상단부터 머리까지(2배)
                ac.style.setProperty('--acc-scale', ia.scale);
                box.appendChild(ac);
            }
        }

        var bb = document.createElement('span');
        bb.className = 'hshop-inv-bib';
        var _nm = '이름';
        try { var _a = JSON.parse(localStorage.getItem('userAuth') || 'null'); if (_a && _a.name) _nm = _a.name; } catch (e) {}
        bb.textContent = _nm;   // 사용자 입력 → textContent (안전)
        var bib = eq.bib ? findItem('bib', eq.bib) : null;
        if (bib) {
            if (bib.color) bb.style.color = bib.color;
            if (bib.bg) bb.style.background = bib.bg;
            if (bib.border) bb.style.borderColor = bib.border;
        }
        box.appendChild(bb);

        return box;
    }

    // ── 카탈로그 헬퍼 (ShopModule getter 위임) ──────────────

    function getCatalog() { return ShopModule.getCatalog(); }
    function getEquipped() { return ShopModule.getEquipped(); }
    function findItem(slot, id) { return ShopModule.findItem(slot, id); }
    function getCatalogItem(id) { return ShopModule.getCatalogItem(id); }

    // ── 잔상(trail) 시각 헬퍼 ──────────────────────────────

    // 잔상 streak 시각 주입 — 색 글로우 띠(rainbow는 CSS 그라데이션 클래스),
    // 이모지 머리는 data-emoji 로 전달해 CSS ::after 가 그린다(아이템 정체성).
    function applyTrailStreakVisual(el, item) {
        if (!el || !item) return;
        if (item.color === 'rainbow') el.classList.add('rainbow');
        else if (item.color) el.style.color = item.color;
        if (item.emoji) el.setAttribute('data-emoji', item.emoji);
    }

    // ── 잔상(afterimage) 스포너 — 경주 중 과거 위치에 탈것 실루엣 사본을 남긴다 ──
    //   탈것 스프라이트(현재 프레임 SVG)의 단색 실루엣이 크기 그대로 옅어지며 사라지는 방식
    //   (소닉/드래곤볼식). 빛 오브/맥동 streak 는 부스터 기믹(item_boost 등)과 시각 언어가
    //   충돌해 폐기 — 실루엣은 "속도 부여"가 아니라 "지나간 자취"로 읽힌다.
    //   순수 외관: .horse/.vehicle-sprite 를 읽기만 하고(레이스 상태 무접촉), 실루엣은 track에
    //   append 후 자기 제거. 결정적: rAF 타임스탬프 + per-horse 카운터만 사용, Math.random 0회.
    //   좌표계 주의: 말은 화면 좌표(track), 월드 스크롤은 레인 backgroundPosition 시뮬레이션 —
    //   카메라 lock 구간에서 말이 화면상 정지하므로, 실루엣을 .finish-line inline left(=finishLine+
    //   bgScrollOffset, horse-race.js가 매 프레임 갱신) 차분으로 역보정해 월드에 앵커한다.
    var AFTERIMAGE_SPAWN_MS = 130;   // 실루엣 스폰 간격 — 오브보다 시각 밀도 높아 낱개 도장 느낌 + 노드 수 절감(fade 0.65s÷130ms ≈ 5개 겹침)
    var AFTERIMAGE_MIN_MOVE_PX = 6;  // 스폰 간 최소 월드 이동량 — 정지한 말(완주 후 racing 클래스 잔존)의 제자리 스폰 방지
    var AFTERIMAGE_EMOJI_EVERY = 3;  // N번째 스폰마다 이모지 유령 1개(실루엣 혼성 — 아이템 정체성 유지)
    var AFTERIMAGE_LIFE_MS = 1000;   // 자기 제거 안전 타이머(fade 애니메이션 0.65s + 여유)
    // afterimageReg 항목: { horse, item, lastSpawn, lastMeasure, lastWorldX, n }
    //   lastSpawn   = 마지막 "실제 스폰"(모든 게이트 통과) 시각 — 스폰 밀도(간격) 제어
    //   lastMeasure = 마지막 rect 측정 시각 — 게이트 skip(정지 말)이어도 측정을 스폰 간격으로 스로틀
    //                 (이동 재개 시 최대 130ms 지연 — 체감 무해, 매 프레임 rect 읽기 방지)
    var afterimageReg = [];          // applyEquippedToHorse 가 등록
    var afterimageOrbs = [];         // { el, baseX, ref } — 살아있는 잔상 노드(월드 스크롤 역보정 대상)
    var afterimageRaf = null;

    // 월드 앵커 기준값: track 안 .finish-line 의 inline left. 카메라 스크롤만큼 변하므로
    // (스폰 시 ref) - (현재 값) 차분이 곧 그동안의 월드 이동량. 없으면(선택화면 등) null → 보정 생략.
    function afterimageScrollRef(host) {
        var fl = host && host.querySelector ? host.querySelector('.finish-line') : null;
        var v = fl ? parseFloat(fl.style.left) : NaN;
        return isNaN(v) ? null : v;
    }
    var reducedMotion = false;
    try { reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

    function unregisterAfterimage(horseEl) {
        for (var i = afterimageReg.length - 1; i >= 0; i--) {
            if (afterimageReg[i].horse === horseEl) afterimageReg.splice(i, 1);
        }
    }

    function registerAfterimage(horseEl, item) {
        if (reducedMotion) return;          // 모션 최소화: 부착 streak만 남긴다
        unregisterAfterimage(horseEl);      // 멱등(재장착 시 중복 방지)
        afterimageReg.push({ horse: horseEl, item: item, lastSpawn: 0, lastMeasure: 0, lastWorldX: null, n: 0 });
        if (!afterimageRaf) afterimageRaf = requestAnimationFrame(afterimageTick);
    }

    function afterimageTick(now) {
        var anyRacing = false;
        for (var i = afterimageReg.length - 1; i >= 0; i--) {
            var r = afterimageReg[i];
            if (!r.horse.isConnected) { afterimageReg.splice(i, 1); continue; } // 트랙 재구성 → 자동 해제
            var cls = r.horse.classList;
            if (!(cls.contains('racing') || cls.contains('running'))) continue; // 달릴 때만
            anyRacing = true;
            if (r.horse.style.visibility === 'hidden') continue;                // 화면 밖 컬링 제외
            if (now - r.lastSpawn < AFTERIMAGE_SPAWN_MS) continue;    // 스폰 간격 게이트
            if (now - r.lastMeasure < AFTERIMAGE_SPAWN_MS) continue;  // 측정 스로틀 — 아래 게이트/실패로 skip 돼도 rect 읽기는 스폰 간격으로 제한
            r.lastMeasure = now;
            // 측정(rect 읽기 1회) → 월드 이동량 게이트 → 통과 시에만 스폰 (rect 이중 읽기 방지)
            var spot = measureAfterimageSpot(r.horse);
            if (!spot) continue; // 구조 미비/레이아웃 0 — lastMeasure 가 재시도를 스로틀
            // 월드 좌표 이동량 게이트: 완주해 정지한 말(racing 클래스는 라운드 끝까지 유지)이
            // 제자리에서 실루엣을 계속 뿜는 것을 막는다. 화면 좌표가 아니라 월드 좌표인 이유 —
            // 카메라 lock 구간에서 선두 말은 화면상 정지하지만 월드는 이동 중(.finish-line inline
            // left 가 매 프레임 변함)이라, 화면 델타로 게이트하면 lock 구간에서 잔상이 끊긴다.
            // 월드 델타는 lock 구간에도 계속 스폰되고, 진짜 정지(스크롤도 정지) 시에만 멎는다.
            // lastSpawn 은 갱신하지 않는다("실제 스폰 시각" 유지) — 이동 재개 시 다음 측정에서 즉시 스폰.
            if (r.lastWorldX != null && Math.abs(spot.worldX - r.lastWorldX) < AFTERIMAGE_MIN_MOVE_PX) continue;
            r.lastSpawn = now;
            r.lastWorldX = spot.worldX;
            r.n++;
            spawnAfterimageGhost(r, spot);
        }
        // 살아있는 오브 월드 스크롤 역보정 — 카메라가 흐른 만큼 뒤(왼쪽)로 밀어 "과거 위치"에 남긴다
        if (afterimageOrbs.length) {
            afterimageOrbs = afterimageOrbs.filter(function (o) { return o.el.isConnected; });
            if (afterimageOrbs.length) {
                var cur = afterimageScrollRef(afterimageOrbs[0].el.parentElement);
                if (cur != null) {
                    for (var j = 0; j < afterimageOrbs.length; j++) {
                        var o = afterimageOrbs[j];
                        if (o.ref != null) o.el.style.left = (o.baseX + (cur - o.ref)) + 'px';
                    }
                }
            }
        }
        if (!afterimageReg.length && !afterimageOrbs.length) { afterimageRaf = null; return; }
        if (anyRacing || afterimageOrbs.length) {
            afterimageRaf = requestAnimationFrame(afterimageTick);
        } else {
            // 대기(선택화면/경주 종료) 중엔 저빈도 폴링 — 상시 rAF 낭비 방지
            setTimeout(function () { afterimageRaf = requestAnimationFrame(afterimageTick); }, 300);
        }
    }

    // 스폰 지점 측정 — sprite/host rect 를 1회만 읽어 화면 좌표 + 월드 x 를 계산(tick 의 이동량
    // 게이트와 실제 스폰이 공유). 반환: { host, sprite, x, y, w, h, ref, worldX } 또는 null.
    // worldX = 화면x - 카메라 스크롤 기준(ref). ref 없음(선택화면/합성 픽스처)이면 화면x 그대로.
    function measureAfterimageSpot(horseEl) {
        var host = horseEl.parentElement; // = track (말은 track 직속 자식 — 레인은 형제)
        if (!host) return null;
        var sprite = horseEl.querySelector('.vehicle-sprite');
        if (!sprite) return null; // 합성 테스트/미구성 방어
        // 현재 "시각" 위치/크기(track 좌표) — 점프/흔들림 transform·모바일 축소까지 반영되게 rect 기반
        var sr = sprite.getBoundingClientRect();
        var lr = host.getBoundingClientRect();
        if (!sr.width || !lr.width) return null;
        var x = sr.left - lr.left;                    // 실루엣은 스프라이트가 있던 자리 그대로
        var y = sr.top - lr.top;
        var ref = afterimageScrollRef(host);          // 월드 역보정 기준(카메라 스크롤 차분용)
        return {
            host: host, sprite: sprite,
            x: x, y: y, w: sr.width, h: sr.height,
            ref: ref,
            worldX: x - (ref != null ? ref : 0)
        };
    }

    function spawnAfterimageGhost(r, spot) {
        var host = spot.host;
        var x = spot.x;
        var y = spot.y;
        var ref = spot.ref;
        // 질주 포즈 스냅샷: frame1/frame2 를 카운터로 교차 선택 → 갤럽 잔상.
        // 선택 프레임이 비면 다른 프레임(lose 상태 background-image 모드 등), 둘 다 비면 스폰 생략.
        var f1 = spot.sprite.querySelector('.vehicle-active-layer .frame1');
        var f2 = spot.sprite.querySelector('.vehicle-active-layer .frame2');
        var pick = (r.n % 2 === 0) ? f1 : f2;
        var alt = (pick === f1) ? f2 : f1;
        var markup = (pick && pick.innerHTML) || (alt && alt.innerHTML) || '';
        if (!markup) return;
        var ghost = document.createElement('span');
        ghost.className = 'cosmetic-afterimage';
        ghost.setAttribute('aria-hidden', 'true');
        // innerHTML 허용: markup 출처는 horse-race-sprites.js 하드코딩 상수 SVG (사용자 입력 아님)
        ghost.innerHTML = markup;
        // 새니타이즈 — power 변신 variant 는 defs(radialGradient/filter id) + url(#...) 참조를 품는다.
        // 그대로 복제하면 문서 내 id 충돌·죽은 url 참조로 요소 미렌더/타 스프라이트 def 오참조.
        // base variant 는 해당 없음(no-op).
        var strip = ghost.querySelectorAll('defs, [fill^="url("]');
        for (var s = 0; s < strip.length; s++) strip[s].remove();
        var filtered = ghost.querySelectorAll('[filter]');
        for (var f = 0; f < filtered.length; f++) filtered[f].removeAttribute('filter');
        var color = r.item.color;
        if (color === 'rainbow') color = 'hsl(' + ((r.n * 22) % 360) + ', 92%, 62%)'; // 연속 hue 사이클(결정적)
        ghost.style.color = color || '#ffd54a';       // CSS가 fill/stroke 를 currentColor 로 강제 → 단색 실루엣
        ghost.style.left = x + 'px';
        ghost.style.top = y + 'px';
        ghost.style.width = spot.w + 'px';
        ghost.style.height = spot.h + 'px';
        // reverse 기믹(.horse inline scaleX(-1)) 대응 — 읽기만, 반전은 별도 노드인 ghost 에만 적용
        if ((r.horse.style.transform || '').indexOf('scaleX(-1)') !== -1) {
            ghost.style.transform = 'scaleX(-1)';
        }
        host.appendChild(ghost);
        afterimageOrbs.push({ el: ghost, baseX: x, ref: ref });
        scheduleAfterimageRemoval(ghost);
        // N번째마다 이모지 유령 — 실루엣 위(상단 중앙)에 희미하게 남는 아이템 정체성(rainbow 는 순수 실루엣)
        if (r.item.emoji && r.item.color !== 'rainbow' && r.n % AFTERIMAGE_EMOJI_EVERY === 0) {
            var emojiX = x + spot.w * 0.5;
            var em = document.createElement('span');
            em.className = 'cosmetic-afterimage-emoji';
            em.setAttribute('aria-hidden', 'true');
            em.textContent = r.item.emoji;  // 카탈로그 상수 → textContent
            em.style.left = emojiX + 'px';
            em.style.top = (y - 6) + 'px';
            host.appendChild(em);
            afterimageOrbs.push({ el: em, baseX: emojiX, ref: ref });
            scheduleAfterimageRemoval(em);
        }
    }

    function scheduleAfterimageRemoval(el) {
        var done = false;
        function rm() { if (!done) { done = true; el.remove(); } }
        el.addEventListener('animationend', rm);
        setTimeout(rm, AFTERIMAGE_LIFE_MS); // 애니메이션 미발화(탭 숨김 등) 안전판
    }

    // ── 탈것 꾸미기 적용 (경마 고유) ───────────────────────

    // 주어진 .horse 에 명시적 equipped 객체를 적용(멱등). catalog 필요.
    function applyEquippedToHorse(horseEl, equipped) {
        if (!horseEl || !getCatalog()) return;
        equipped = equipped || {};

        // 멱등: 이전 cosmetic-* 자식 제거
        var stale = horseEl.querySelectorAll('.cosmetic-accessory, .cosmetic-trail, .cosmetic-aura');
        for (var i = 0; i < stale.length; i++) stale[i].remove();

        // aura → 탈것 뒤 글로우(별도 노드, z-index 낮게 — paint의 .vehicle-sprite filter와 무간섭)
        var aura = findItem('aura', equipped.aura);
        if (aura && aura.color) {
            var auraEl = document.createElement('span');
            auraEl.className = 'cosmetic-aura';
            auraEl.setAttribute('aria-hidden', 'true');
            applyAuraVisual(auraEl, aura); // 스프라이트(로드 시) 또는 currentColor 글로우 폴백
            horseEl.appendChild(auraEl);
        }

        // paint → .vehicle-sprite filter (.horse가 아니라: 이벤트 연출이 .horse filter 점유)
        var sprite = horseEl.querySelector('.vehicle-sprite');
        if (sprite) {
            var paint = findItem('paint', equipped.paint);
            sprite.style.filter = (paint && paint.filter) ? paint.filter : '';
        }

        // trail(잔상) → 부착 streak(빛 띠) + 경주 중 과거 위치 오브 스포너 등록
        var trail = findItem('trail', equipped.trail);
        if (trail) {
            var trailEl = document.createElement('span');
            trailEl.className = 'cosmetic-trail';
            trailEl.setAttribute('aria-hidden', 'true');
            applyTrailStreakVisual(trailEl, trail);
            horseEl.appendChild(trailEl);
            registerAfterimage(horseEl, trail);
        } else {
            unregisterAfterimage(horseEl); // 잔상 해제 재적용 시 스포너도 해제
        }

        // accessory → 머리 위 오버레이 (탈것별 앵커로 위치/크기 보정 — 외관만)
        var acc = findItem('accessory', equipped.accessory);
        if (acc && acc.emoji) {
            var accEl = document.createElement('span');
            accEl.className = 'cosmetic-accessory';
            accEl.setAttribute('aria-hidden', 'true');
            accEl.textContent = acc.emoji;
            var vid = horseEl.dataset ? horseEl.dataset.vehicleId : null;
            var a = (vid && ACC_ANCHOR[vid]) || ACC_ANCHOR_DEFAULT;
            // CSS 커스텀 프로퍼티로 전달 → .cosmetic-accessory 가 left/top/scale 소비 (px = .horse 기준).
            accEl.style.setProperty('--acc-x', (10 + a.x) + 'px');
            accEl.style.setProperty('--acc-y', (17.5 + a.y) + 'px');
            accEl.style.setProperty('--acc-scale', a.scale);
            horseEl.appendChild(accEl);
        }

        // bib(이름표)는 .horse가 아니라 닉네임 라벨(.race-name-tag)에 적용 — getLabelStyle 참조.
    }

    // bibId → 이름표 라벨 스타일. 카탈로그 미로드/미존재 시 null.
    function getLabelStyle(bibId) {
        var item = bibId ? findItem('bib', bibId) : null;
        if (!item) return null;
        return { color: item.color || null, bg: item.bg || null, border: item.border || null };
    }

    // 내가 현재 장착한 이름표 id (선택화면 자기 미리보기용). 없으면 null.
    function getMyEquippedLabel() { return mergedEquipped().bib || null; }
    // 내 이름표 라벨의 라이브 재색칠 책임은 horse-race.js(window.refreshMyNameTags)로 일원화 —
    // 스타일 소유권을 렌더 쪽에 두고, 셀렉터에 유저입력(닉네임)을 넣지 않기 위함.

    // 미인증 시 일반 상품 클릭 → 로그인 모달 유도(셸은 게임 중립이라 typeof 가드 필수).
    function promptLogin() {
        if (typeof ServerSelectModule !== 'undefined' && ServerSelectModule.showLoginModal) {
            ServerSelectModule.showLoginModal();
        } else if (typeof showCustomAlert === 'function') {
            showCustomAlert('로그인 후 이용할 수 있어요.');
        }
    }

    // 내 DB 장착 + 광고 장착(슬롯 단위로 광고가 우선)을 병합. 광고는 서버 broadcast와 동일 의미.
    function mergedEquipped() {
        var merged = {};
        var dbEq = getEquipped() || {};
        Object.keys(dbEq).forEach(function (slot) { merged[slot] = dbEq[slot]; });
        var adEq = (ShopModule.getAdWallet && ShopModule.getAdWallet().equipped) || {};
        Object.keys(adEq).forEach(function (slot) { merged[slot] = adEq[slot]; });
        return merged;
    }

    // 내 장착(서버 권위 + 광고 transient)을 .horse 에 적용.
    function applyToHorse(horseEl) {
        if (!horseEl) return;
        if (!getCatalog()) {
            ShopModule.loadCatalog().then(function () { applyToHorse(horseEl); }).catch(function () {});
            return;
        }
        applyEquippedToHorse(horseEl, mergedEquipped());
    }

    function applyToActiveHorses() {
        var horses = document.querySelectorAll('.horse.my-horse');
        for (var i = 0; i < horses.length; i++) applyToHorse(horses[i]);
    }

    // ── 개인 연출 (finish_fx) ──────────────────────────────
    //   "개인 꾸미기": 각 플레이어가 본인 장착(코인 DB + 광고 transient)을 본인 화면에서 본다.
    //   방장 무관·우승 무관. 결승 폭죽 레이어(.cosmetic-finish-fx)는 자체 타이머(5.5s)로 정리된다.

    // 결승 이펙트 1회 재생을 임의 컨테이너에 그리는 헬퍼(in-race·상점 미리보기 공용).
    //   이모지 28개 낙하(화면 전폭 커버 + 크기/딜레이 jitter). Math.random은 외형(위치/딜레이/크기)
    //   전용 — 게임 결과·시뮬과 무관(공정성 영향 0). ~5500ms 후 자동 정리(레이어 leak 방지, 멱등).
    //   containerEl은 position:relative + overflow:hidden 이어야 낙하가 그 안에 클리핑된다.
    var FINISH_FX_PIECES = 28;       // 강화: 12 → 28 (질량 ↑)
    var FINISH_FX_LIFETIME = 5500;   // CSS hshopFxFall 3.6s + 최대 delay ~1.5s 보다 길게
    function playFinishFxInto(containerEl, emoji) {
        if (!containerEl || !emoji) return;
        var layer = document.createElement('div');
        layer.className = 'cosmetic-finish-fx';
        layer.setAttribute('aria-hidden', 'true');
        for (var i = 0; i < FINISH_FX_PIECES; i++) {
            var p = document.createElement('span');
            p.className = 'cosmetic-fx-piece';
            p.textContent = emoji;
            // 전폭 균등 분포(1.5~98.5%) + 가로 jitter (외형 전용 random — 공정성 무관)
            var base = 1.5 + (i / (FINISH_FX_PIECES - 1)) * 97;
            p.style.left = Math.max(0, Math.min(99, base + (Math.random() - 0.5) * 6)) + '%';
            p.style.animationDelay = (Math.random() * 1.5).toFixed(2) + 's'; // 0~1.5s 산개
            p.style.fontSize = (24 + Math.random() * 18).toFixed(0) + 'px';  // 24~42px 크기 변주
            layer.appendChild(p);
        }
        containerEl.appendChild(layer);
        setTimeout(function () { if (layer && layer.parentNode) layer.remove(); }, FINISH_FX_LIFETIME);
    }

    // 결승 이펙트(폭죽/색종이) 1회 재생 — 본인이 장착한 finish_fx 기준(개인 꾸미기, 방장 무관).
    //   인자(roomCosmetics)는 기존 호출부 시그니처 호환용으로 유지하되 더 이상 사용하지 않는다.
    //   mergedEquipped()로 본인 DB 장착 + 광고 장착(우선)을 읽어 모든 플레이어가 자기 화면에서 자기 연출을 본다.
    function playFinishFx(_roomCosmetics) {
        var id = mergedEquipped().finish_fx;
        if (!id) return;
        var fx = getCatalogItem(id);
        if (!fx || !fx.emoji) return;
        playFinishFxInto(document.getElementById('raceTrackContainer'), fx.emoji);
    }

    // ── ShopModule 설정 등록 ───────────────────────────────

    ShopModule.init({
        mountId: 'horseShopMount',
        catalogUrl: CATALOG_URL,
        title: '꾸미기 상점',
        subtitle: '경마 · 내 탈것',
        slots: SLOTS,
        // 미인증(게스트/만료토큰)도 ad-티어로 상점 진입 허용 (v1 경마 한정). 스핀은 이 플래그 없음 → 토큰 필수.
        allowGuestShop: true,
        hooks: {
            buildPreview: buildPreview,
            // 인벤토리('내 아이템') 메인탭 상단 큰 미리보기 — mergedEquipped 합성을 어댑터에서 빌드.
            buildInventoryPreview: buildInventoryPreview,
            // 인벤토리 ◀▶ 스위처용 탈것 로스터(id/name). ALL_VEHICLES에서 추림.
            inventoryVehicles: inventoryVehicles,
            // 인벤토리 카드 장착표시를 "실제 탈것에 보이는 것"과 일치시키기 위한 현재 장착(슬롯→id) 조회.
            // 광고>코인(같은 슬롯 광고 우선). 셸은 이 단일 진실로 ✓를 1개에만 표시.
            mergedEquipped: mergedEquipped,
            // 일반(비-광고) 아이템 상태. ad 아이템은 셸이 ad-wallet 기준으로 별도 처리(여기 미진입).
            // 미인증(게스트/만료토큰)이면 일반 상품은 잠금 → 클릭 시 로그인 유도.
            itemState: function (item) {
                if (!ShopModule.isAuthed()) {
                    return { owned: false, buyable: false, lockLabel: '로그인하세요', onLockedClick: promptLogin };
                }
                var owned = ShopModule.getWallet().owned.indexOf(item.id) !== -1;
                return { owned: owned, buyable: true };
            },
            noticeText: function (activeSlot) {
                return (activeSlot === 'finish_fx')
                    ? '결승연출은 내가 장착하면 내 화면에 보여요. 게임 결과엔 영향 없어요.'
                    : '꾸미기는 게임 결과에 영향을 주지 않아요. 코인으로 구매 후 장착하세요.';
            },
            // free 서버(자유플레이·로그인 없음 → currentServerId === null)에서는 코인 경제가
            // 실제로 돌지 않으므로 코인샵 카드 대신 안내문만 보여준다. 잠금이면 안내 카피 반환,
            // 정규 서버면 null → 셸 기본 카드 렌더. 광고샵('ad')엔 영향 없음(셸이 'coin' 한정 호출).
            coinShopLocked: function () {
                return (window.currentServerId == null)
                    ? '여기서는 코인샵을 사용할 수 없어요. 서버를 새로 만들어 진행해 주세요.'
                    : null;
            },
            // 인증/지갑 동기화 직후 — 내 활성 말 + 이름표 라벨에 장착 반영
            onWalletSynced: function () { applyToActiveHorses(); if (window.refreshMyNameTags) window.refreshMyNameTags(); },
            // 장착/해제 직후 — 내 활성 말 + 이름표 라벨 즉시 반영 (force 무관)
            onEquipApplied: function () { applyToActiveHorses(); if (window.refreshMyNameTags) window.refreshMyNameTags(); },
            // 광고 코스메틱 장착/해제 직후 — 내 활성 말 + 이름표 라벨 즉시 반영
            onAdEquipApplied: function () { applyToActiveHorses(); if (window.refreshMyNameTags) window.refreshMyNameTags(); }
            // onPurchased: no-op (구매만으로 외관 변화 없음 — 장착 시 반영)
        }
    });

    // ── 공개 API (기존 시그니처 유지) ──────────────────────

    window.HorseShop = {
        connect: function (socket) { ShopModule.connect(socket); },
        authenticate: function (token, done) { ShopModule.authenticate(token, done); },
        loadCatalog: function () { return ShopModule.loadCatalog(); },
        openShop: function () { ShopModule.openShop(); },
        closeShop: function () { ShopModule.closeShop(); },
        applyToHorse: applyToHorse,
        applyEquippedToHorse: applyEquippedToHorse,
        applyToActiveHorses: applyToActiveHorses,
        playFinishFx: playFinishFx,
        getEquipped: getEquipped,
        getCatalogItem: getCatalogItem,
        getLabelStyle: getLabelStyle,
        getMyEquippedLabel: getMyEquippedLabel,
        isAuthed: function () { return ShopModule.isAuthed(); }
    };

    // 이름표 색 해석은 카탈로그가 로드돼야 한다. 레이스 전에 미리 캐시(멱등 — 중복 무해).
    ShopModule.loadCatalog().catch(function () {});
})();
