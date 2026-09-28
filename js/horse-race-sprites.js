// 경마 탈것 스프라이트 — GPT 도트 그림(P차, docs/goal/horse-vehicle-raster-sprites.md).
// 프레임 파일: assets/horse-race/vehicles/{id}/{base|power}-{state}-{1|2}.webp (120×90 = 표시 60×45의 2x).
// 프레임 마크업은 <svg> 한 겹 안의 <image> 하나다 — 호출부가 여는 태그의 width/height 를 고치고(썸네일),
// 넘어짐·진화 빌더가 안쪽 마크업을 감싼다. 중첩 <svg> 금지(넘어짐 빌더의 안쪽 추출이 첫 </svg> 에서 끊긴다).
// <image> 는 width/height="100%" — 전역 치환(width="60")에 걸리지 않고 여는 태그 크기를 따라간다.
const VEHICLE_SPRITE_VER = 5; // 2: 2컷 겹침 맞춤, 3: 약한 9종 달리기, 4: 발 재의뢰, 5: 상태별 행동(15종 7상태·넘어짐 그림·꼴찌)
const VEHICLE_SPRITE_BASE_PATH = '/assets/horse-race/vehicles';
// 탈것마다 그린 상태 — 15종 전부 같은 7상태(2026-09-28 사용자: 상태마다 그 행동이 보여야 한다).
// fallen 은 그린 그림이 있으면 ensureVehicleFallenState 가 회전 생성 대신 그대로 쓴다(1컷 고꾸라짐 → 2컷 엎어짐, 순서 재생).
const VEHICLE_SPRITE_ALL_STATES = ['idle', 'run', 'rest', 'finish', 'victory', 'dead', 'fallen'];
const VEHICLE_SPRITE_STATES = {
    horse: VEHICLE_SPRITE_ALL_STATES,
    knight: VEHICLE_SPRITE_ALL_STATES,
    dinosaur: VEHICLE_SPRITE_ALL_STATES,
    ninja: VEHICLE_SPRITE_ALL_STATES,
    crab: VEHICLE_SPRITE_ALL_STATES,
    rabbit: VEHICLE_SPRITE_ALL_STATES,
    turtle: VEHICLE_SPRITE_ALL_STATES,
    bird: VEHICLE_SPRITE_ALL_STATES,
    boat: VEHICLE_SPRITE_ALL_STATES,
    bicycle: VEHICLE_SPRITE_ALL_STATES,
    rocket: VEHICLE_SPRITE_ALL_STATES,
    car: VEHICLE_SPRITE_ALL_STATES,
    eagle: VEHICLE_SPRITE_ALL_STATES,
    scooter: VEHICLE_SPRITE_ALL_STATES,
    helicopter: VEHICLE_SPRITE_ALL_STATES
};

function getVehicleSpriteFrameUrl(vehicleId, variant, state, frameNo) {
    return `${VEHICLE_SPRITE_BASE_PATH}/${vehicleId}/${variant}-${state}-${frameNo}.webp?v=${VEHICLE_SPRITE_VER}`;
}

function buildVehicleSpriteFrame(vehicleId, variant, state, frameNo) {
    return `<svg viewBox="0 0 60 45" width="60" height="45"><image href="${getVehicleSpriteFrameUrl(vehicleId, variant, state, frameNo)}" x="0" y="0" width="100%" height="100%"/></svg>`;
}

function buildVehicleSpriteResource(vehicleId, variant) {
    const resource = {};
    VEHICLE_SPRITE_STATES[vehicleId].forEach(state => {
        resource[state] = {
            frame1: buildVehicleSpriteFrame(vehicleId, variant, state, 1),
            frame2: buildVehicleSpriteFrame(vehicleId, variant, state, 2)
        };
    });
    Object.defineProperty(resource, 'frame1', { get() { return this.run.frame1; }, enumerable: true });
    Object.defineProperty(resource, 'frame2', { get() { return this.run.frame2; }, enumerable: true });
    return resource;
}

function normalizeVehicleSpriteId(vehicleId) {
    return VEHICLE_SPRITE_STATES[vehicleId] ? vehicleId : 'car';
}

// ── '예전 그림 보기' 토글 — 옛 SVG(js/horse-race-sprites-legacy.js, 약 390KB)는 켤 때만 받는다. 선택은 이 브라우저에만 저장.
const VEHICLE_LEGACY_STORAGE_KEY = 'horseVehicleLegacySprites';
const VEHICLE_LEGACY_SCRIPT = '/js/horse-race-sprites-legacy.js?v=1';
let vehicleLegacyOn = false;
let vehicleLegacyLoading = null;

function isVehicleLegacyMode() {
    return vehicleLegacyOn && !!window.HorseLegacySprites;
}

function loadVehicleLegacySprites() {
    if (window.HorseLegacySprites) return Promise.resolve();
    if (!vehicleLegacyLoading) {
        vehicleLegacyLoading = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = VEHICLE_LEGACY_SCRIPT;
            script.onload = resolve;
            script.onerror = () => { vehicleLegacyLoading = null; reject(new Error('legacy vehicle sprites load failed')); };
            document.head.appendChild(script);
        });
    }
    return vehicleLegacyLoading;
}

function getSavedVehicleLegacyMode() {
    try { return localStorage.getItem(VEHICLE_LEGACY_STORAGE_KEY) === '1'; } catch (e) { return false; }
}

// 켜기는 옛 그림을 받은 뒤에 적용된다 — 반환 Promise 가 끝나면 화면을 다시 그려라.
function setVehicleLegacyMode(on) {
    try { localStorage.setItem(VEHICLE_LEGACY_STORAGE_KEY, on ? '1' : '0'); } catch (e) { /* 저장 불가(사생활 모드) — 이번 페이지에만 적용 */ }
    if (!on) {
        vehicleLegacyOn = false;
        return Promise.resolve(false);
    }
    return loadVehicleLegacySprites().then(() => { vehicleLegacyOn = true; return true; });
}

function getVehicleSVG(vehicleId) {
    if (isVehicleLegacyMode()) return window.HorseLegacySprites.getVehicleSVG(vehicleId);
    return ensureVehicleFallenState(buildVehicleSpriteResource(normalizeVehicleSpriteId(vehicleId), 'base'));
}

// 경주에 나온 탈것의 기본형 전 프레임 + 진화형 run 을 미리 받아 둔다 — 상태가 처음 바뀔 때 빈 칸이 번쩍이지 않게.
// 진화 전환은 run 으로 들어가고, 진화형 finish/victory 등은 진화한 탈것만 쓰므로 그때 받는다(판당 전송량 절약).
const preloadedVehicleSprites = new Set();
function preloadVehicleSprites(vehicleIds) {
    (vehicleIds || []).forEach(rawId => {
        const vehicleId = normalizeVehicleSpriteId(rawId);
        if (preloadedVehicleSprites.has(vehicleId)) return;
        preloadedVehicleSprites.add(vehicleId);
        const frames = VEHICLE_SPRITE_STATES[vehicleId].map(state => ['base', state]).concat([['power', 'run']]);
        frames.forEach(([variant, state]) => [1, 2].forEach(frameNo => {
            new Image().src = getVehicleSpriteFrameUrl(vehicleId, variant, state, frameNo);
        }));
    });
}

// 트랙 오브젝트 SVG 생성 함수
function getTrackObjectSVG(objectId) {
    const objects = {
        // ===== 경주장 시설물 =====
        'start-gate': `<svg viewBox="0 0 80 75" width="80" height="75">
            <!-- 좌측 기둥 -->
            <rect x="2" y="5" width="6" height="65" fill="#555" stroke="#333" stroke-width="0.5"/>
            <rect x="0" y="65" width="10" height="10" rx="1" fill="#444"/>
            <!-- 우측 기둥 -->
            <rect x="72" y="5" width="6" height="65" fill="#555" stroke="#333" stroke-width="0.5"/>
            <rect x="70" y="65" width="10" height="10" rx="1" fill="#444"/>
            <!-- 상단 바 -->
            <rect x="2" y="3" width="76" height="6" rx="1" fill="#666" stroke="#444" stroke-width="0.5"/>
            <!-- 게이트 칸막이 -->
            <rect x="10" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="25" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="40" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <rect x="55" y="9" width="15" height="56" fill="none" stroke="#888" stroke-width="0.8"/>
            <!-- 번호 -->
            <text x="17" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">1</text>
            <text x="32" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">2</text>
            <text x="47" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">3</text>
            <text x="62" y="20" text-anchor="middle" font-size="7" fill="#ddd" font-weight="bold">4</text>
            <!-- 리벳 -->
            <circle cx="5" cy="10" r="1.5" fill="#777"/>
            <circle cx="5" cy="60" r="1.5" fill="#777"/>
            <circle cx="75" cy="10" r="1.5" fill="#777"/>
            <circle cx="75" cy="60" r="1.5" fill="#777"/>
        </svg>`,

        'fence': `<svg viewBox="0 0 60 12" width="60" height="12">
            <!-- 가로 레일 -->
            <rect x="0" y="2" width="60" height="2.5" rx="0.5" fill="#8B7355"/>
            <rect x="0" y="7" width="60" height="2.5" rx="0.5" fill="#8B7355"/>
            <!-- 세로 기둥 -->
            <rect x="2" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="17" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="32" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <rect x="47" y="0" width="3" height="12" rx="0.5" fill="#6B5340" stroke="#5a4535" stroke-width="0.3"/>
            <!-- 기둥 꼭대기 -->
            <circle cx="3.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="18.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="33.5" cy="1" r="2" fill="#7B6350"/>
            <circle cx="48.5" cy="1" r="2" fill="#7B6350"/>
        </svg>`,

        'grandstand': `<svg viewBox="0 0 120 60" width="120" height="60">
            <!-- 관중석 계단 -->
            <rect x="5" y="35" width="110" height="10" fill="#A0522D"/>
            <rect x="10" y="25" width="100" height="10" fill="#8B4513"/>
            <rect x="15" y="15" width="90" height="10" fill="#6B3410"/>
            <!-- 관중 실루엣 (뒷줄) -->
            <circle cx="25" cy="12" r="3" fill="#444"/>
            <circle cx="35" cy="11" r="3" fill="#555"/>
            <circle cx="50" cy="12" r="3" fill="#444"/>
            <circle cx="65" cy="11" r="3" fill="#555"/>
            <circle cx="80" cy="12" r="3" fill="#444"/>
            <circle cx="95" cy="11" r="3" fill="#555"/>
            <!-- 관중 실루엣 (중간줄) -->
            <circle cx="20" cy="22" r="3" fill="#555"/>
            <circle cx="33" cy="23" r="3.5" fill="#666"/>
            <circle cx="48" cy="22" r="3" fill="#555"/>
            <circle cx="62" cy="23" r="3.5" fill="#666"/>
            <circle cx="77" cy="22" r="3" fill="#555"/>
            <circle cx="92" cy="23" r="3.5" fill="#666"/>
            <circle cx="105" cy="22" r="3" fill="#555"/>
            <!-- 관중 실루엣 (앞줄) -->
            <circle cx="15" cy="33" r="3.5" fill="#666"/>
            <circle cx="30" cy="32" r="3.5" fill="#777"/>
            <circle cx="45" cy="33" r="3.5" fill="#666"/>
            <circle cx="60" cy="32" r="4" fill="#777"/>
            <circle cx="75" cy="33" r="3.5" fill="#666"/>
            <circle cx="90" cy="32" r="3.5" fill="#777"/>
            <circle cx="105" cy="33" r="3.5" fill="#666"/>
            <!-- 깃발 -->
            <line x1="40" y1="5" x2="40" y2="15" stroke="#666" stroke-width="0.8"/>
            <polygon points="40,5 50,8 40,11" fill="#e74c3c"/>
            <line x1="80" y1="5" x2="80" y2="15" stroke="#666" stroke-width="0.8"/>
            <polygon points="80,5 90,8 80,11" fill="#3498db"/>
            <!-- 지붕 -->
            <rect x="3" y="45" width="114" height="4" fill="#5a3a1a"/>
            <rect x="0" y="49" width="120" height="11" fill="#4a2a0a"/>
        </svg>`,

        // ===== 장애물 =====
        'rock': `<svg viewBox="0 0 30 25" width="30" height="25">
            <!-- 큰 바위 -->
            <path d="M5,22 Q2,18 4,14 Q6,10 10,8 Q14,6 18,7 Q22,6 25,9 Q28,12 27,17 Q26,22 22,24 Q15,25 8,24 Z" fill="#808080" stroke="#666" stroke-width="0.5"/>
            <!-- 하이라이트 -->
            <path d="M10,10 Q13,8 16,9 Q18,8 20,10" fill="none" stroke="#999" stroke-width="0.5"/>
            <!-- 그림자 -->
            <ellipse cx="15" cy="24" rx="10" ry="2" fill="rgba(0,0,0,0.15)"/>
            <!-- 작은 바위 -->
            <path d="M22,20 Q24,18 26,19 Q27,21 25,22 Q23,22 22,20 Z" fill="#707070"/>
            <!-- 금 -->
            <line x1="12" y1="12" x2="16" y2="18" stroke="#6a6a6a" stroke-width="0.3"/>
            <line x1="18" y1="10" x2="20" y2="16" stroke="#6a6a6a" stroke-width="0.3"/>
        </svg>`,

        'puddle': `<svg viewBox="0 0 35 15" width="35" height="15">
            <!-- 물웅덩이 본체 -->
            <ellipse cx="17" cy="9" rx="15" ry="5" fill="#4a90d9" opacity="0.7"/>
            <ellipse cx="17" cy="9" rx="13" ry="4" fill="#5ba3ec" opacity="0.6"/>
            <!-- 반사광 -->
            <ellipse cx="12" cy="7" rx="4" ry="1.5" fill="white" opacity="0.3"/>
            <ellipse cx="22" cy="8" rx="2" ry="1" fill="white" opacity="0.2"/>
            <!-- 물결 -->
            <path d="M8,9 Q11,7 14,9 Q17,11 20,9 Q23,7 26,9" fill="none" stroke="white" stroke-width="0.4" opacity="0.4"/>
            <!-- 물방울 튀김 -->
            <circle cx="6" cy="5" r="1" fill="#5ba3ec" opacity="0.5"/>
            <circle cx="28" cy="6" r="0.8" fill="#5ba3ec" opacity="0.4"/>
        </svg>`,

        'hurdle': `<svg viewBox="0 0 25 30" width="25" height="30">
            <!-- 좌측 기둥 -->
            <rect x="2" y="5" width="3" height="25" fill="#ddd" stroke="#bbb" stroke-width="0.3"/>
            <!-- 우측 기둥 -->
            <rect x="20" y="5" width="3" height="25" fill="#ddd" stroke="#bbb" stroke-width="0.3"/>
            <!-- 허들 바 (빨간/흰 줄무늬) -->
            <rect x="1" y="8" width="23" height="4" fill="#e74c3c"/>
            <rect x="1" y="8" width="5" height="4" fill="white"/>
            <rect x="11" y="8" width="5" height="4" fill="white"/>
            <rect x="1" y="16" width="23" height="3" fill="#e74c3c"/>
            <rect x="6" y="16" width="5" height="3" fill="white"/>
            <rect x="16" y="16" width="5" height="3" fill="white"/>
            <!-- 기둥 꼭대기 -->
            <circle cx="3.5" cy="5" r="2" fill="#eee" stroke="#ccc" stroke-width="0.3"/>
            <circle cx="21.5" cy="5" r="2" fill="#eee" stroke="#ccc" stroke-width="0.3"/>
            <!-- 그림자 -->
            <ellipse cx="12.5" cy="29" rx="10" ry="1.5" fill="rgba(0,0,0,0.1)"/>
        </svg>`,

        // ===== 부스트 아이템 =====
        'carrot': `<svg viewBox="0 0 20 30" width="20" height="30">
            <!-- 당근 본체 -->
            <path d="M10,5 Q13,10 12,18 Q11,24 10,28 Q9,24 8,18 Q7,10 10,5 Z" fill="#FF6B2B" stroke="#E55B1B" stroke-width="0.3"/>
            <!-- 당근 줄무늬 -->
            <line x1="8.5" y1="12" x2="11.5" y2="12" stroke="#E55B1B" stroke-width="0.4"/>
            <line x1="8.8" y1="16" x2="11.2" y2="16" stroke="#E55B1B" stroke-width="0.4"/>
            <line x1="9.2" y1="20" x2="10.8" y2="20" stroke="#E55B1B" stroke-width="0.3"/>
            <!-- 잎사귀 -->
            <path d="M10,5 Q7,1 5,0" fill="none" stroke="#2ecc71" stroke-width="1.2"/>
            <path d="M10,5 Q10,0 10,-1" fill="none" stroke="#27ae60" stroke-width="1"/>
            <path d="M10,5 Q13,1 15,0" fill="none" stroke="#2ecc71" stroke-width="1.2"/>
            <!-- 하이라이트 -->
            <path d="M9,8 Q9.5,12 9.5,16" fill="none" stroke="#FF8C4B" stroke-width="0.5"/>
            <!-- 반짝이 -->
            <circle cx="6" cy="8" r="0.8" fill="#FFD700" opacity="0.8"/>
            <circle cx="14" cy="12" r="0.6" fill="#FFD700" opacity="0.6"/>
        </svg>`,

        'star': `<svg viewBox="0 0 25 25" width="25" height="25">
            <!-- 별 본체 -->
            <polygon points="12.5,1 15.5,8.5 23.5,9.5 17.5,15 19,23 12.5,19 6,23 7.5,15 1.5,9.5 9.5,8.5" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
            <!-- 하이라이트 -->
            <polygon points="12.5,4 14,9 12.5,7.5 11,9" fill="#FFE44D" opacity="0.6"/>
            <!-- 반짝이 이펙트 -->
            <line x1="12.5" y1="0" x2="12.5" y2="2" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
            <line x1="24" y1="12.5" x2="22" y2="12.5" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
            <line x1="1" y1="12.5" x2="3" y2="12.5" stroke="#FFF" stroke-width="0.5" opacity="0.7"/>
        </svg>`,

        'horseshoe': `<svg viewBox="0 0 25 25" width="25" height="25">
            <!-- 말발굽 U자 -->
            <path d="M5,4 Q5,16 7,20 Q9,24 12.5,24 Q16,24 18,20 Q20,16 20,4" fill="none" stroke="#DAA520" stroke-width="3" stroke-linecap="round"/>
            <!-- 안쪽 하이라이트 -->
            <path d="M7,5 Q7,15 9,19 Q10,22 12.5,22 Q15,22 16,19 Q18,15 18,5" fill="none" stroke="#FFD700" stroke-width="1.5" stroke-linecap="round"/>
            <!-- 못 구멍 -->
            <circle cx="6" cy="7" r="1" fill="#B8860B"/>
            <circle cx="6" cy="13" r="1" fill="#B8860B"/>
            <circle cx="19" cy="7" r="1" fill="#B8860B"/>
            <circle cx="19" cy="13" r="1" fill="#B8860B"/>
            <!-- 반짝이 -->
            <circle cx="10" cy="10" r="0.6" fill="white" opacity="0.5"/>
            <circle cx="15" cy="8" r="0.5" fill="white" opacity="0.4"/>
        </svg>`,

        // ===== 배경 장식 =====
        'tree': `<svg viewBox="0 0 30 50" width="30" height="50">
            <!-- 나무 줄기 -->
            <rect x="12" y="30" width="6" height="18" fill="#8B6914" stroke="#6B4914" stroke-width="0.3"/>
            <!-- 뿌리 -->
            <path d="M12,48 Q10,50 8,50" fill="none" stroke="#6B4914" stroke-width="1"/>
            <path d="M18,48 Q20,50 22,50" fill="none" stroke="#6B4914" stroke-width="1"/>
            <!-- 나뭇잎 (3단계) -->
            <ellipse cx="15" cy="28" rx="12" ry="8" fill="#27ae60"/>
            <ellipse cx="15" cy="20" rx="10" ry="7" fill="#2ecc71"/>
            <ellipse cx="15" cy="13" rx="7" ry="6" fill="#3ddc84"/>
            <!-- 하이라이트 -->
            <ellipse cx="12" cy="16" rx="3" ry="2" fill="#4deca4" opacity="0.5"/>
            <ellipse cx="18" cy="24" rx="3" ry="2" fill="#4deca4" opacity="0.4"/>
        </svg>`,

        'flower': `<svg viewBox="0 0 15 20" width="15" height="20">
            <!-- 줄기 -->
            <path d="M7.5,10 Q7,14 7.5,19" fill="none" stroke="#27ae60" stroke-width="1"/>
            <!-- 잎 -->
            <path d="M7.5,14 Q4,12 3,14 Q4,15 7.5,14" fill="#2ecc71"/>
            <path d="M7.5,16 Q11,14 12,16 Q11,17 7.5,16" fill="#2ecc71"/>
            <!-- 꽃잎 (5장) -->
            <ellipse cx="7.5" cy="5" rx="2.5" ry="3" fill="#e74c3c"/>
            <ellipse cx="4" cy="7.5" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-72,7.5,7.5)"/>
            <ellipse cx="5.5" cy="11" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-144,7.5,7.5)"/>
            <ellipse cx="9.5" cy="11" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-216,7.5,7.5)"/>
            <ellipse cx="11" cy="7.5" rx="2.5" ry="3" fill="#e74c3c" transform="rotate(-288,7.5,7.5)"/>
            <!-- 꽃술 -->
            <circle cx="7.5" cy="7.5" r="2" fill="#f1c40f"/>
            <circle cx="7.5" cy="7.5" r="1" fill="#e67e22"/>
        </svg>`,

        'checkered-flag': `<svg viewBox="0 0 20 30" width="20" height="30">
            <!-- 깃대 -->
            <rect x="1" y="2" width="1.5" height="28" fill="#888" stroke="#666" stroke-width="0.2"/>
            <circle cx="1.75" cy="2" r="1.2" fill="#FFD700"/>
            <!-- 깃발 (체커 패턴) -->
            <rect x="2.5" y="2" width="16" height="14" fill="white" stroke="#333" stroke-width="0.3"/>
            <!-- 체커 패턴 -->
            <rect x="2.5" y="2" width="4" height="3.5" fill="#111"/>
            <rect x="10.5" y="2" width="4" height="3.5" fill="#111"/>
            <rect x="6.5" y="5.5" width="4" height="3.5" fill="#111"/>
            <rect x="14.5" y="5.5" width="4" height="3.5" fill="#111"/>
            <rect x="2.5" y="9" width="4" height="3.5" fill="#111"/>
            <rect x="10.5" y="9" width="4" height="3.5" fill="#111"/>
            <rect x="6.5" y="12.5" width="4" height="3.5" fill="#111"/>
            <rect x="14.5" y="12.5" width="4" height="3.5" fill="#111"/>
            <!-- 깃발 펄럭임 -->
            <path d="M18.5,2 Q19,5 18.5,9 Q19,12 18.5,16" fill="none" stroke="#333" stroke-width="0.2"/>
        </svg>`,

        'balloon': `<svg viewBox="0 0 15 25" width="15" height="25">
            <!-- 풍선 본체 -->
            <ellipse cx="7.5" cy="8" rx="6" ry="7.5" fill="#e74c3c"/>
            <!-- 하이라이트 -->
            <ellipse cx="5.5" cy="6" rx="2" ry="2.5" fill="white" opacity="0.3"/>
            <!-- 풍선 꼭지 -->
            <polygon points="6.5,15 8.5,15 7.5,17" fill="#c0392b"/>
            <!-- 끈 -->
            <path d="M7.5,17 Q6,20 7.5,22 Q9,24 7.5,25" fill="none" stroke="#999" stroke-width="0.5"/>
        </svg>`
    };
    return objects[objectId] || '';
}

const POWER_VEHICLE_PALETTES = {
    default: { glow: '#6ee7ff', spark: '#ffe082', core: '#f7fdff' },
    car: { glow: '#ffb347', spark: '#fff4a3', core: '#fff7e8' },
    rocket: { glow: '#ff8f5f', spark: '#ffe07b', core: '#fff6ef' },
    bird: { glow: '#c892ff', spark: '#7cecff', core: '#faf0ff' },
    boat: { glow: '#5cd2ff', spark: '#d9f7ff', core: '#f2fbff' },
    bicycle: { glow: '#8dff91', spark: '#fff29a', core: '#f4fff0' },
    rabbit: { glow: '#ffd5f0', spark: '#fff6a3', core: '#fff8fd' },
    turtle: { glow: '#7dffb4', spark: '#d9ff9f', core: '#f2fff8' },
    eagle: { glow: '#7fd8ff', spark: '#ffe27a', core: '#f8fdff' },
    scooter: { glow: '#8ad8ff', spark: '#fff0a1', core: '#f3fbff' },
    helicopter: { glow: '#ff8d8d', spark: '#ffe48b', core: '#fff6f6' },
    horse: { glow: '#ffca80', spark: '#fff0a8', core: '#fff9f2' },
    knight: { glow: '#7be1ff', spark: '#fff2a0', core: '#f4fcff' },
    dinosaur: { glow: '#6fffb3', spark: '#fff08f', core: '#f2fff8' },
    ninja: { glow: '#9da7ff', spark: '#85f6ff', core: '#f4f6ff' },
    crab: { glow: '#ff9b7e', spark: '#fff3a2', core: '#fff7f2' }
};

const vehicleVariantCache = {
    base: Object.create(null),
    power: Object.create(null)
};

let vehiclePowerSvgSequence = 0;
var generatedVehicleFallenStateCache;

function cloneVehicleSpriteResource(resource) {
    if (typeof resource === 'string') return resource;
    if (!resource || typeof resource !== 'object') return resource;

    const cloned = Array.isArray(resource) ? [] : {};
    Object.keys(resource).forEach(key => {
        cloned[key] = cloneVehicleSpriteResource(resource[key]);
    });
    return cloned;
}

function mapVehicleSpriteResource(resource, transform, path = []) {
    if (typeof resource === 'string') return transform(resource, path);
    if (!resource || typeof resource !== 'object') return resource;

    const mapped = Array.isArray(resource) ? [] : {};
    Object.keys(resource).forEach(key => {
        mapped[key] = mapVehicleSpriteResource(resource[key], transform, [...path, key]);
    });
    return mapped;
}

function extractVehicleSvgInnerMarkup(svgMarkup) {
    if (typeof svgMarkup !== 'string') return '';
    const match = svgMarkup.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
    return match ? match[1].trim() : svgMarkup;
}

function buildVehicleFallenFrame(svgMarkup, variant = 1) {
    const innerMarkup = extractVehicleSvgInnerMarkup(svgMarkup);
    if (!innerMarkup) return svgMarkup;

    const config = variant === 2
        ? {
            translateX: -1.0,
            translateY: 5.0,
            rotate: 82,
            scale: 0.9,
            dustOpacity: 0.28,
            dustY: 37.8
        }
        : {
            translateX: -2.0,
            translateY: 4.2,
            rotate: 74,
            scale: 0.92,
            dustOpacity: 0.36,
            dustY: 37.1
        };

    return `<svg viewBox="0 0 60 45" width="60" height="45">
        <ellipse cx="30" cy="${config.dustY + 1.2}" rx="17.5" ry="4.6" fill="#091121" opacity="0.22"/>
        <g opacity="${config.dustOpacity}">
            <ellipse cx="18.2" cy="${config.dustY}" rx="6.2" ry="2.5" fill="#d7c29a"/>
            <ellipse cx="29.8" cy="${config.dustY - 0.4}" rx="9.2" ry="3.4" fill="#e7d5ad"/>
            <ellipse cx="41.6" cy="${config.dustY + 0.2}" rx="6.8" ry="2.7" fill="#d8c29a"/>
        </g>
        <g transform="translate(${config.translateX} ${config.translateY}) rotate(${config.rotate} 30 24)">
            <g transform="translate(30 24) scale(${config.scale}) translate(-30 -24)">
                ${innerMarkup}
            </g>
        </g>
    </svg>`;
}

function ensureVehicleFallenState(resource) {
    if (!resource || typeof resource !== 'object') return resource;
    if (resource.fallen && resource.fallen.frame1) return resource;

    const fallenStateCache = generatedVehicleFallenStateCache || (generatedVehicleFallenStateCache = new WeakMap());
    const cached = fallenStateCache.get(resource);
    if (cached) return cached;

    const sourceState = resource.finish || resource.run || resource.idle || resource.rest || (resource.frame1 ? resource : null);
    if (!sourceState || (!sourceState.frame1 && !sourceState.frame2)) return resource;

    const sourceFrame1 = sourceState.frame1 || sourceState.frame2 || '';
    const sourceFrame2 = sourceState.frame2 || sourceState.frame1 || '';
    const enriched = {
        ...resource,
        fallen: {
            frame1: buildVehicleFallenFrame(sourceFrame1, 1),
            frame2: buildVehicleFallenFrame(sourceFrame2, 2)
        }
    };

    fallenStateCache.set(resource, enriched);
    return enriched;
}

function getVehiclePowerPalette(vehicleId) {
    return POWER_VEHICLE_PALETTES[vehicleId] || POWER_VEHICLE_PALETTES.default;
}

function getVehiclePowerStateIntensity(state) {
    switch (state) {
        case 'run':
            return 1;
        case 'finish':
            return 1.12;
        case 'victory':
            return 1.2;
        case 'idle':
            return 0.82;
        case 'rest':
            return 0.62;
        case 'fallen':
            return 0.38;
        case 'dead':
            return 0.22;
        default:
            return 0.55;
    }
}

function getVehiclePowerBadgeMarkup(state, box, palette) {
    if (!['finish', 'victory'].includes(state)) return '';

    const { minX, minY, width, height, intensity } = box;
    const crownX = minX + (width * 0.5);
    const crownY = minY + (height * 0.08);
    const crownOpacity = Math.min(0.65 + (intensity * 0.12), 0.9).toFixed(2);

    return `
        <g opacity="${crownOpacity}">
            <path d="M${crownX - (width * 0.12)},${crownY + (height * 0.08)} L${crownX - (width * 0.07)},${crownY - (height * 0.02)} L${crownX},${crownY + (height * 0.06)} L${crownX + (width * 0.07)},${crownY - (height * 0.02)} L${crownX + (width * 0.12)},${crownY + (height * 0.08)} L${crownX + (width * 0.1)},${crownY + (height * 0.16)} L${crownX - (width * 0.1)},${crownY + (height * 0.16)} Z" fill="${palette.spark}" stroke="${palette.glow}" stroke-width="${Math.max(0.5, width * 0.01)}"/>
            <circle cx="${crownX}" cy="${crownY + (height * 0.1)}" r="${Math.max(1.2, width * 0.022)}" fill="${palette.core}"/>
        </g>
    `;
}

function buildPoweredVehicleSVG(svgMarkup, vehicleId, state, palette) {
    if (typeof svgMarkup !== 'string') return svgMarkup;

    const openingTagMatch = svgMarkup.match(/^<svg\b[^>]*>/i);
    const closingIndex = svgMarkup.lastIndexOf('</svg>');
    if (!openingTagMatch || closingIndex === -1) return svgMarkup;

    const openingTag = openingTagMatch[0];
    const innerMarkup = svgMarkup.slice(openingTag.length, closingIndex);
    const svgTag = openingTag.slice(0, -1);
    const viewBoxMatch = openingTag.match(/viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/i);
    const minX = viewBoxMatch ? Number(viewBoxMatch[1]) : 0;
    const minY = viewBoxMatch ? Number(viewBoxMatch[2]) : 0;
    const width = viewBoxMatch ? Number(viewBoxMatch[3]) : 60;
    const height = viewBoxMatch ? Number(viewBoxMatch[4]) : 45;
    const centerX = minX + (width / 2);
    const centerY = minY + (height / 2);
    const intensity = getVehiclePowerStateIntensity(state);
    const glowId = `vehicle-power-glow-${vehiclePowerSvgSequence}`;
    const auraId = `vehicle-power-aura-${vehiclePowerSvgSequence}`;
    vehiclePowerSvgSequence += 1;

    const enhancedOpeningTag = svgTag.includes('overflow=')
        ? openingTag
        : `${svgTag} overflow="visible" data-variant="power" data-resource-id="${vehicleId}_power">`;
    const box = { minX, minY, width, height, intensity };
    const badgeMarkup = getVehiclePowerBadgeMarkup(state, box, palette);

    return `${enhancedOpeningTag}
        <defs>
            <radialGradient id="${auraId}" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stop-color="${palette.core}" stop-opacity="${Math.min(0.74 + (intensity * 0.08), 0.92).toFixed(2)}"/>
                <stop offset="55%" stop-color="${palette.glow}" stop-opacity="${Math.min(0.22 + (intensity * 0.2), 0.55).toFixed(2)}"/>
                <stop offset="100%" stop-color="${palette.glow}" stop-opacity="0"/>
            </radialGradient>
            <filter id="${glowId}" x="-45%" y="-45%" width="190%" height="190%">
                <feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="${palette.glow}" flood-opacity="0.55"/>
                <feDropShadow dx="0" dy="0" stdDeviation="4.5" flood-color="${palette.spark}" flood-opacity="0.25"/>
            </filter>
        </defs>
        <ellipse cx="${centerX}" cy="${centerY}" rx="${width * 0.37}" ry="${height * 0.33}" fill="url(#${auraId})" opacity="${Math.min(0.35 + (intensity * 0.15), 0.65).toFixed(2)}"/>
        <g opacity="${Math.min(0.56 + (intensity * 0.24), 0.92).toFixed(2)}">
            <circle cx="${minX + (width * 0.18)}" cy="${minY + (height * 0.2)}" r="${Math.max(0.8, width * 0.022)}" fill="${palette.spark}"/>
            <circle cx="${minX + (width * 0.82)}" cy="${minY + (height * 0.18)}" r="${Math.max(0.7, width * 0.018)}" fill="${palette.glow}"/>
            <circle cx="${minX + (width * 0.74)}" cy="${minY + (height * 0.78)}" r="${Math.max(0.8, width * 0.02)}" fill="${palette.spark}"/>
            <path d="M${minX + (width * 0.12)},${minY + (height * 0.55)} L${minX + (width * 0.16)},${minY + (height * 0.48)} L${minX + (width * 0.2)},${minY + (height * 0.55)} L${minX + (width * 0.16)},${minY + (height * 0.62)} Z" fill="${palette.spark}" opacity="0.85"/>
            <path d="M${minX + (width * 0.88)},${minY + (height * 0.48)} L${minX + (width * 0.91)},${minY + (height * 0.42)} L${minX + (width * 0.94)},${minY + (height * 0.48)} L${minX + (width * 0.91)},${minY + (height * 0.54)} Z" fill="${palette.glow}" opacity="0.82"/>
        </g>
        <g filter="url(#${glowId})">
            ${innerMarkup}
        </g>
        ${badgeMarkup}
    </svg>`;
}

function getVehicleBaseSVG(vehicleId) {
    if (isVehicleLegacyMode()) return window.HorseLegacySprites.getVehicleBaseSVG(vehicleId);
    const cacheKey = vehicleId || 'car';
    if (!vehicleVariantCache.base[cacheKey]) {
        vehicleVariantCache.base[cacheKey] = cloneVehicleSpriteResource(getVehicleSVG(vehicleId));
    }
    return cloneVehicleSpriteResource(vehicleVariantCache.base[cacheKey]);
}

function getVehiclePowerSVG(vehicleId) {
    if (isVehicleLegacyMode()) return window.HorseLegacySprites.getVehiclePowerSVG(vehicleId);
    const cacheKey = vehicleId || 'car';
    if (!vehicleVariantCache.power[cacheKey]) {
        const poweredSource = ensureVehicleFallenState(buildVehicleSpriteResource(normalizeVehicleSpriteId(vehicleId), 'power'));
        vehicleVariantCache.power[cacheKey] = mapVehicleSpriteResource(
            poweredSource,
            (markup, path) => buildPoweredVehicleSVG(markup, vehicleId, path[0] || 'run', getVehiclePowerPalette(vehicleId))
        );
    }
    return cloneVehicleSpriteResource(vehicleVariantCache.power[cacheKey]);
}

function getVehicleSVGVariants(vehicleId) {
    return {
        base: getVehicleBaseSVG(vehicleId),
        power: getVehiclePowerSVG(vehicleId)
    };
}

function getVehicleVariantSVG(vehicleId, variant = 'base') {
    return variant === 'power' ? getVehiclePowerSVG(vehicleId) : getVehicleBaseSVG(vehicleId);
}

function getVehicleSpriteResourceIds(vehicleId) {
    const normalizedId = String(vehicleId || 'car').replace(/_power$/, '');
    return {
        base: normalizedId,
        power: `${normalizedId}_power`
    };
}

function parseVehicleSpriteResourceId(resourceId) {
    const normalizedId = String(resourceId || 'car');
    if (normalizedId.endsWith('_power')) {
        return {
            vehicleId: normalizedId.slice(0, -6) || 'car',
            variant: 'power'
        };
    }

    return {
        vehicleId: normalizedId,
        variant: 'base'
    };
}

function getVehicleSVGByResourceId(resourceId) {
    const parsed = parseVehicleSpriteResourceId(resourceId);
    return getVehicleVariantSVG(parsed.vehicleId, parsed.variant);
}
