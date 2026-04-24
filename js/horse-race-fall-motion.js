/* =========================================================================
 * Horse Race — Fall Motion System
 * ---
 * devtools (AutoTest/horse-devtools.html) 의 fallProfile 애니메이션 시스템을
 * 게임 런타임용으로 포팅한 파일.
 *
 * 공개 함수:
 *   - animateVehicleFallState(horseElement, vehicleId, targetState)
 *       targetState: 'fallen' | 'run'
 *   - getFallMotionProfile(vehicleId)
 *   - FINISH_STUN_BUFFER_PX (상수)
 *
 * devtools 와 동일한 키프레임 빌더, FX 팔레트, 프로필을 공유한다.
 * ========================================================================= */

// ─── 기본 타이밍/거리 상수 ───
const FALL_PREVIEW_SWAP_MS = 420;
const FALL_TRAVEL_DISTANCE_PX = 24;
const FALL_OVERSHOOT_DISTANCE_PX = 28;

// fallen SVG 내 시각 내용 끝 위치 (60px 프레임 기준, x축 48 지점까지 먼지+회전된 탈것)
const FALL_VISIBLE_MAX_X = 48;

// 최종 정착 시 결승선까지의 gap — 모든 탈것이 동일하게 finishLine - FALL_FINAL_GAP_PX 위치에 정렬
const FALL_FINAL_GAP_PX = 15;

// 탈것별 동적 버퍼 계산
// buffer = slideX + fallenMaxX + finalGap - vW
// → 최종 fallenRight = currentPos + slideX + fallenMaxX = finishLine - finalGap (모든 탈것 동일)
function getFinishStunBuffer(visualWidth) {
    const vw = (typeof visualWidth === 'number' && visualWidth > 0) ? visualWidth : 50;
    return FALL_TRAVEL_DISTANCE_PX + FALL_VISIBLE_MAX_X + FALL_FINAL_GAP_PX - vw;
}

// 후방 호환 상수 (고정값이 필요한 경우 fallback)
const FINISH_STUN_BUFFER_PX = FALL_OVERSHOOT_DISTANCE_PX + 22; // = 50

// ─── 프로필 정의 ───
const FALL_MOTION_BASE_PROFILES = {
    default: {
        category: 'glide',
        motionType: 'faceplant',
        fallMs: 440,
        recoverMs: 320,
        braceX: 1.2,
        braceY: -1.2,
        slideX: 10,
        overshootX: 13,
        dropY: 5,
        tiltDeg: 18,
        reboundY: -1.4,
        impactScale: 1.05,
        outgoingScale: 0.86,
        incomingStartScale: 0.8,
        incomingLiftY: 6,
        outgoingBlur: 1.2,
        fxType: 'dust',
        fxStrength: 0.55
    },
    glide: {
        category: 'glide',
        fallMs: 430,
        recoverMs: 300,
        braceX: 1.7,
        braceY: -1.6,
        reboundY: -1.6,
        impactScale: 1.06,
        outgoingScale: 0.84,
        incomingStartScale: 0.78,
        incomingLiftY: 6
    },
    heavy: {
        category: 'heavy',
        fallMs: 470,
        recoverMs: 340,
        braceX: 0.8,
        braceY: -0.8,
        reboundY: -0.8,
        impactScale: 1.08,
        outgoingScale: 0.9,
        incomingStartScale: 0.86,
        incomingLiftY: 4,
        outgoingBlur: 1.05
    },
    air: {
        category: 'air',
        fallMs: 450,
        recoverMs: 310,
        braceX: 1.4,
        braceY: -3.8,
        reboundY: -2.2,
        impactScale: 1.07,
        outgoingScale: 0.83,
        incomingStartScale: 0.76,
        incomingLiftY: 8,
        outgoingBlur: 1.35
    },
    special: {
        category: 'special',
        fallMs: 430,
        recoverMs: 320,
        braceX: 1,
        braceY: -1,
        reboundY: -1.2,
        impactScale: 1.04,
        outgoingScale: 0.87,
        incomingStartScale: 0.82,
        incomingLiftY: 5
    }
};

const FALL_MOTION_PROFILES = {
    car:        { category: 'glide', motionType: 'faceplant', slideX: 11, overshootX: 15, dropY: 6, tiltDeg: 22, fxType: 'spark',   fxStrength: 0.45, outgoingBlur: 1.3 },
    rocket:     { category: 'air',   motionType: 'thrust-fade', slideX: 13, overshootX: 16, dropY: 8, tiltDeg: 18, fxType: 'smoke',   fxStrength: 0.85, braceX: 2.5, outgoingBlur: 1.55 },
    bird:       { category: 'air',   motionType: 'arc-drop',  slideX: 8,  overshootX: 10, dropY: 7, tiltDeg: 20, fxType: 'feather', fxStrength: 0.75, braceY: -4.5 },
    boat:       { category: 'special', motionType: 'splash-dip', slideX: 9,  overshootX: 12, dropY: 4, tiltDeg: 14, fxType: 'splash',  fxStrength: 0.78, braceY: -0.4, reboundY: -0.7 },
    bicycle:    { category: 'glide', motionType: 'faceplant', slideX: 14, overshootX: 18, dropY: 7, tiltDeg: 26, fxType: 'spark',   fxStrength: 0.68, braceX: 2.2, outgoingBlur: 1.45 },
    rabbit:     { category: 'glide', motionType: 'faceplant', slideX: 12, overshootX: 15, dropY: 5, tiltDeg: 18, fxType: 'dust',    fxStrength: 0.5,  braceY: -2.6, reboundY: -2.5, impactScale: 1.08 },
    turtle:     { category: 'heavy', motionType: 'heavy-flop', slideX: 5,  overshootX: 7,  dropY: 3, tiltDeg: 9,  fxType: 'dust',    fxStrength: 0.32, braceX: 0.4, braceY: -0.3, impactScale: 1.02, outgoingScale: 0.92 },
    eagle:      { category: 'air',   motionType: 'arc-drop',  slideX: 9,  overshootX: 12, dropY: 8, tiltDeg: 17, fxType: 'feather', fxStrength: 0.82, braceY: -5.2, incomingLiftY: 9 },
    scooter:    { category: 'glide', motionType: 'faceplant', slideX: 10, overshootX: 13, dropY: 6, tiltDeg: 19, fxType: 'spark',   fxStrength: 0.42 },
    helicopter: { category: 'air',   motionType: 'thrust-fade', slideX: 10, overshootX: 12, dropY: 8, tiltDeg: 16, fxType: 'wind',    fxStrength: 0.7,  braceY: -3.6, outgoingBlur: 1.45 },
    horse:      { category: 'heavy', motionType: 'heavy-flop', slideX: 11, overshootX: 14, dropY: 6, tiltDeg: 20, fxType: 'dust',    fxStrength: 0.72, impactScale: 1.08, outgoingScale: 0.84 },
    knight:     { category: 'heavy', motionType: 'burst-stop', slideX: 7,  overshootX: 9,  dropY: 5, tiltDeg: 15, fxType: 'spark',   fxStrength: 0.74, outgoingBlur: 1.35 },
    dinosaur:   { category: 'heavy', motionType: 'heavy-flop', slideX: 8,  overshootX: 11, dropY: 7, tiltDeg: 13, fxType: 'dust',    fxStrength: 0.88, impactScale: 1.1 },
    ninja:      { category: 'glide', motionType: 'faceplant', slideX: 13, overshootX: 17, dropY: 4, tiltDeg: 15, fxType: 'smoke',   fxStrength: 0.52, braceX: 2.4, braceY: -1.8 },
    crab:       { category: 'special', motionType: 'side-slip', slideX: 6,  overshootX: 8,  dropY: 3, tiltDeg: 11, fxType: 'dust',    fxStrength: 0.38, braceX: -0.6, braceY: -0.2 }
};

const FALL_FX_PALETTES = {
    dust: {
        flashCore: 'rgba(245, 222, 177, 0.92)',
        flashMid: 'rgba(213, 188, 139, 0.55)',
        trail: 'radial-gradient(circle at 28% 65%, rgba(232, 212, 167, 0.92) 0%, rgba(220, 194, 143, 0.78) 26%, rgba(191, 156, 108, 0.34) 56%, rgba(255,255,255,0) 82%), radial-gradient(circle at 64% 70%, rgba(230, 205, 154, 0.74) 0%, rgba(203, 170, 124, 0.3) 42%, rgba(255,255,255,0) 78%)'
    },
    spark: {
        flashCore: 'rgba(255, 243, 165, 0.96)',
        flashMid: 'rgba(255, 153, 82, 0.62)',
        trail: 'radial-gradient(circle at 22% 72%, rgba(255, 230, 150, 0.96) 0%, rgba(255, 187, 84, 0.78) 20%, rgba(255,255,255,0) 52%), radial-gradient(circle at 55% 58%, rgba(255, 139, 62, 0.8) 0%, rgba(255, 139, 62, 0.38) 26%, rgba(255,255,255,0) 66%), linear-gradient(90deg, rgba(255,194,96,0) 0%, rgba(255,194,96,0.88) 36%, rgba(255,194,96,0) 100%)'
    },
    smoke: {
        flashCore: 'rgba(255, 233, 196, 0.82)',
        flashMid: 'rgba(137, 176, 210, 0.38)',
        trail: 'radial-gradient(circle at 28% 60%, rgba(204, 215, 226, 0.68) 0%, rgba(162, 175, 192, 0.52) 26%, rgba(255,255,255,0) 70%), radial-gradient(circle at 62% 68%, rgba(131, 147, 168, 0.56) 0%, rgba(106, 120, 138, 0.34) 30%, rgba(255,255,255,0) 72%)'
    },
    feather: {
        flashCore: 'rgba(255, 247, 223, 0.86)',
        flashMid: 'rgba(215, 183, 255, 0.34)',
        trail: 'radial-gradient(circle at 26% 64%, rgba(255, 249, 229, 0.84) 0%, rgba(255, 223, 194, 0.48) 22%, rgba(255,255,255,0) 58%), radial-gradient(circle at 56% 48%, rgba(240, 210, 255, 0.72) 0%, rgba(212, 176, 240, 0.3) 26%, rgba(255,255,255,0) 62%), radial-gradient(circle at 76% 72%, rgba(255, 242, 214, 0.66) 0%, rgba(255,255,255,0) 52%)'
    },
    splash: {
        flashCore: 'rgba(221, 247, 255, 0.88)',
        flashMid: 'rgba(92, 193, 255, 0.52)',
        trail: 'radial-gradient(circle at 28% 70%, rgba(226, 248, 255, 0.92) 0%, rgba(150, 219, 255, 0.5) 22%, rgba(255,255,255,0) 60%), radial-gradient(circle at 56% 66%, rgba(96, 198, 255, 0.72) 0%, rgba(96, 198, 255, 0.32) 28%, rgba(255,255,255,0) 64%), linear-gradient(0deg, rgba(86,188,255,0) 0%, rgba(86,188,255,0.66) 42%, rgba(255,255,255,0) 100%)'
    },
    wind: {
        flashCore: 'rgba(239, 252, 255, 0.84)',
        flashMid: 'rgba(122, 239, 255, 0.44)',
        trail: 'linear-gradient(90deg, rgba(152, 241, 255, 0) 0%, rgba(152, 241, 255, 0.9) 30%, rgba(255,255,255,0) 60%), linear-gradient(90deg, rgba(192, 247, 255, 0) 16%, rgba(192, 247, 255, 0.72) 44%, rgba(255,255,255,0) 72%)'
    }
};

function getFallMotionProfile(vehicleId) {
    const vehicleProfile = FALL_MOTION_PROFILES[vehicleId] || {};
    const category = vehicleProfile.category || FALL_MOTION_BASE_PROFILES.default.category;
    return {
        ...FALL_MOTION_BASE_PROFILES.default,
        ...(FALL_MOTION_BASE_PROFILES[category] || {}),
        ...vehicleProfile,
        slideX: FALL_TRAVEL_DISTANCE_PX,
        overshootX: FALL_OVERSHOOT_DISTANCE_PX
    };
}

function getFallFxPalette(profile) {
    return FALL_FX_PALETTES[profile.fxType] || FALL_FX_PALETTES.dust;
}

function getFallFlashGradient(profile) {
    const palette = getFallFxPalette(profile);
    const radius = 80 + Math.round(profile.fxStrength * 14);
    return `radial-gradient(circle, ${palette.flashCore} 0%, ${palette.flashMid} 38%, rgba(255, 255, 255, 0) ${radius}%)`;
}

function getFallTrailBackground(profile) {
    return getFallFxPalette(profile).trail;
}

// ─── 키프레임 빌더 (devtools에서 복사) ───
function buildFallOffsetKeyframes(profile, targetState) {
    const motionType = profile.motionType || 'faceplant';

    if (motionType === 'burst-stop') {
        if (targetState === 'fallen') {
            return [
                { x: 0, offset: 0 },
                { x: Math.max(0.8, profile.braceX * 0.7), offset: 0.1 },
                { x: profile.slideX * 0.24, offset: 0.28 },
                { x: profile.slideX * 0.78, offset: 0.74 },
                { x: profile.slideX, offset: 1 }
            ];
        }
        return [
            { x: profile.slideX, offset: 0 },
            { x: profile.slideX * 0.62, offset: 0.34 },
            { x: profile.slideX * 0.18, offset: 0.76 },
            { x: 0, offset: 1 }
        ];
    }

    if (motionType === 'arc-drop' || motionType === 'thrust-fade') {
        if (targetState === 'fallen') {
            return [
                { x: 0, offset: 0 },
                { x: Math.max(1.5, profile.braceX), offset: 0.16 },
                { x: profile.slideX * 0.34, offset: 0.42 },
                { x: profile.overshootX * 0.82, offset: 0.78 },
                { x: profile.slideX, offset: 1 }
            ];
        }
        return [
            { x: profile.slideX, offset: 0 },
            { x: profile.slideX * 0.7, offset: 0.26 },
            { x: profile.slideX * 0.22, offset: 0.72 },
            { x: 0, offset: 1 }
        ];
    }

    if (motionType === 'heavy-flop') {
        if (targetState === 'fallen') {
            return [
                { x: 0, offset: 0 },
                { x: Math.max(0.2, profile.braceX * 0.4), offset: 0.18 },
                { x: profile.slideX * 0.46, offset: 0.56 },
                { x: profile.overshootX * 0.74, offset: 0.84 },
                { x: profile.slideX, offset: 1 }
            ];
        }
        return [
            { x: profile.slideX, offset: 0 },
            { x: profile.slideX * 0.72, offset: 0.38 },
            { x: profile.slideX * 0.24, offset: 0.82 },
            { x: 0, offset: 1 }
        ];
    }

    if (motionType === 'side-slip') {
        if (targetState === 'fallen') {
            return [
                { x: 0, offset: 0 },
                { x: -Math.abs(profile.braceX || 1), offset: 0.14 },
                { x: profile.slideX * 0.28, offset: 0.4 },
                { x: profile.overshootX, offset: 0.82 },
                { x: profile.slideX, offset: 1 }
            ];
        }
        return [
            { x: profile.slideX, offset: 0 },
            { x: profile.slideX * 0.5, offset: 0.3 },
            { x: -Math.abs(profile.braceX || 1) * 0.5, offset: 0.74 },
            { x: 0, offset: 1 }
        ];
    }

    if (motionType === 'splash-dip') {
        if (targetState === 'fallen') {
            return [
                { x: 0, offset: 0 },
                { x: Math.max(0.6, profile.braceX * 0.55), offset: 0.16 },
                { x: profile.slideX * 0.42, offset: 0.48 },
                { x: profile.overshootX * 0.88, offset: 0.82 },
                { x: profile.slideX, offset: 1 }
            ];
        }
        return [
            { x: profile.slideX, offset: 0 },
            { x: profile.slideX * 0.64, offset: 0.3 },
            { x: profile.slideX * 0.18, offset: 0.74 },
            { x: 0, offset: 1 }
        ];
    }

    // faceplant (default)
    if (targetState === 'fallen') {
        return [
            { x: 0, offset: 0 },
            { x: profile.braceX, offset: 0.18 },
            { x: profile.overshootX * 0.68, offset: 0.5 },
            { x: profile.overshootX, offset: 0.78 },
            { x: profile.slideX, offset: 1 }
        ];
    }
    return [
        { x: profile.slideX, offset: 0 },
        { x: profile.overshootX * 0.58, offset: 0.3 },
        { x: Math.max(0, profile.braceX * 0.5), offset: 0.74 },
        { x: 0, offset: 1 }
    ];
}

function buildFallOutgoingKeyframes(profile) {
    const motionType = profile.motionType || 'faceplant';
    const halfTilt = profile.tiltDeg * 0.44;

    if (motionType === 'burst-stop') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)', filter: 'none' },
            { offset: 0.16, opacity: 1,    transform: `translate(${profile.braceX}px, ${profile.braceY}px) scale(1.01, 0.98) rotate(${-Math.max(4, profile.tiltDeg * 0.18)}deg)`, filter: 'brightness(1.08)' },
            { offset: 0.42, opacity: 0.96, transform: `translate(${Math.max(2, profile.slideX * 0.24)}px, ${Math.max(0.4, profile.dropY * 0.14)}px) scale(1.04, 0.94) rotate(${Math.max(2, profile.tiltDeg * 0.12)}deg)`, filter: 'brightness(1.14)' },
            { offset: 0.78, opacity: 0.74, transform: `translate(${profile.slideX * 0.9}px, ${Math.max(1.2, profile.dropY * 0.38)}px) scale(${Math.max(0.94, profile.outgoingScale + 0.08)}, ${Math.max(0.82, profile.outgoingScale - 0.06)}) rotate(${Math.max(3, profile.tiltDeg * 0.18)}deg)`, filter: `blur(${Math.max(0.5, profile.outgoingBlur * 0.75)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 1}px, ${Math.max(2, profile.dropY * 0.55)}px) scale(${Math.max(0.9, profile.outgoingScale + 0.02)}, ${Math.max(0.78, profile.outgoingScale - 0.1)}) rotate(${Math.max(4, profile.tiltDeg * 0.22)}deg)`, filter: `blur(${Math.max(0.7, profile.outgoingBlur * 0.85)}px)` }
        ];
    }

    if (motionType === 'arc-drop') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
            { offset: 0.18, opacity: 1,    transform: `translate(${profile.braceX}px, ${-Math.max(4, profile.incomingLiftY * 0.54)}px) scale(1.02) rotate(${-Math.max(6, profile.tiltDeg * 0.28)}deg)`, filter: 'brightness(1.04)' },
            { offset: 0.52, opacity: 0.9,  transform: `translate(${Math.max(3, profile.slideX * 0.36)}px, ${-Math.max(7, profile.incomingLiftY)}px) scale(0.98) rotate(${Math.max(8, profile.tiltDeg * 0.32)}deg)`, filter: 'brightness(1.02)' },
            { offset: 0.84, opacity: 0.62, transform: `translate(${profile.overshootX}px, ${Math.max(4, profile.dropY * 0.9)}px) scale(${profile.outgoingScale}) rotate(${profile.tiltDeg + 10}deg)`, filter: `blur(${Math.max(0.9, profile.outgoingBlur)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 3}px, ${profile.dropY + 5}px) scale(${Math.max(0.74, profile.outgoingScale - 0.04)}) rotate(${profile.tiltDeg + 18}deg)`, filter: `blur(${Math.max(1.2, profile.outgoingBlur + 0.25)}px)` }
        ];
    }

    if (motionType === 'thrust-fade') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
            { offset: 0.2,  opacity: 1,    transform: `translate(${Math.max(2, profile.braceX)}px, ${-Math.max(3, profile.incomingLiftY * 0.4)}px) scale(1.01) rotate(${-Math.max(4, profile.tiltDeg * 0.16)}deg)`, filter: 'brightness(1.02)' },
            { offset: 0.54, opacity: 0.88, transform: `translate(${Math.max(4, profile.slideX * 0.42)}px, ${-Math.max(5, profile.incomingLiftY * 0.2)}px) scale(0.96) rotate(${Math.max(6, profile.tiltDeg * 0.18)}deg)`, filter: 'brightness(0.98)' },
            { offset: 0.82, opacity: 0.58, transform: `translate(${profile.overshootX}px, ${Math.max(5, profile.dropY * 0.88)}px) scale(${profile.outgoingScale}) rotate(${profile.tiltDeg + 6}deg)`, filter: `blur(${Math.max(1, profile.outgoingBlur)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 2}px, ${profile.dropY + 6}px) scale(${Math.max(0.72, profile.outgoingScale - 0.05)}) rotate(${profile.tiltDeg + 14}deg)`, filter: `blur(${Math.max(1.3, profile.outgoingBlur + 0.35)}px)` }
        ];
    }

    if (motionType === 'heavy-flop') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
            { offset: 0.24, opacity: 1,    transform: `translate(${profile.braceX * 0.35}px, ${profile.braceY * 0.4}px) scale(1.01) rotate(${-Math.max(2, profile.tiltDeg * 0.12)}deg)`, filter: 'brightness(1.02)' },
            { offset: 0.62, opacity: 0.9,  transform: `translate(${profile.slideX * 0.42}px, ${profile.dropY * 0.62}px) scale(0.98) rotate(${Math.max(4, profile.tiltDeg * 0.18)}deg)`, filter: 'brightness(1.01)' },
            { offset: 0.88, opacity: 0.7,  transform: `translate(${profile.overshootX * 0.82}px, ${profile.dropY + 2}px) scale(${Math.max(0.88, profile.outgoingScale)}) rotate(${Math.max(6, profile.tiltDeg * 0.44)}deg)`, filter: `blur(${Math.max(0.8, profile.outgoingBlur * 0.78)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 1}px, ${profile.dropY + 4}px) scale(${Math.max(0.82, profile.outgoingScale - 0.02)}) rotate(${Math.max(8, profile.tiltDeg * 0.6)}deg)`, filter: `blur(${Math.max(0.95, profile.outgoingBlur * 0.9)}px)` }
        ];
    }

    if (motionType === 'side-slip') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
            { offset: 0.18, opacity: 1,    transform: `translate(${-Math.abs(profile.braceX || 1)}px, ${profile.braceY}px) scale(1) rotate(${-Math.max(6, profile.tiltDeg * 0.4)}deg)`, filter: 'brightness(1.04)' },
            { offset: 0.5,  opacity: 0.92, transform: `translate(${Math.max(3, profile.slideX * 0.34)}px, ${Math.max(1, profile.dropY * 0.24)}px) scale(0.98) rotate(${Math.max(9, profile.tiltDeg * 0.58)}deg)`, filter: 'brightness(1.03)' },
            { offset: 0.82, opacity: 0.68, transform: `translate(${profile.overshootX}px, ${Math.max(2, profile.dropY * 0.44)}px) scale(${profile.outgoingScale}) rotate(${-Math.max(4, profile.tiltDeg * 0.22)}deg)`, filter: `blur(${Math.max(0.8, profile.outgoingBlur * 0.86)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 1}px, ${profile.dropY + 2}px) scale(${Math.max(0.76, profile.outgoingScale - 0.03)}) rotate(${Math.max(8, profile.tiltDeg * 0.5)}deg)`, filter: `blur(${Math.max(0.95, profile.outgoingBlur)}px)` }
        ];
    }

    if (motionType === 'splash-dip') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
            { offset: 0.2,  opacity: 1,    transform: `translate(${profile.braceX}px, ${-Math.max(1, profile.dropY * 0.2)}px) scale(1.01) rotate(${-Math.max(4, profile.tiltDeg * 0.2)}deg)`, filter: 'brightness(1.03)' },
            { offset: 0.56, opacity: 0.92, transform: `translate(${profile.slideX * 0.4}px, ${Math.max(1, profile.dropY * 0.2)}px) scale(0.98, 0.99) rotate(${Math.max(7, profile.tiltDeg * 0.42)}deg)`, filter: 'brightness(1.01)' },
            { offset: 0.86, opacity: 0.62, transform: `translate(${profile.overshootX}px, ${profile.dropY + 3}px) scale(${Math.max(0.84, profile.outgoingScale)}) rotate(${profile.tiltDeg + 3}deg)`, filter: `blur(${Math.max(0.9, profile.outgoingBlur * 0.84)}px)` },
            { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + 2}px, ${profile.dropY + 5}px) scale(${Math.max(0.8, profile.outgoingScale - 0.02)}) rotate(${profile.tiltDeg + 8}deg)`, filter: `blur(${Math.max(1, profile.outgoingBlur)}px)` }
        ];
    }

    // faceplant (default)
    return [
        { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
        { offset: 0.18, opacity: 1,    transform: `translate(${profile.braceX}px, ${profile.braceY}px) scale(1.01) rotate(${-halfTilt}deg)`, filter: 'brightness(1.04)' },
        { offset: 0.52, opacity: 0.94, transform: `translate(${profile.overshootX * 0.6}px, ${profile.dropY * 0.35}px) scale(0.97) rotate(${profile.tiltDeg * 0.38}deg)`, filter: 'brightness(1.06)' },
        { offset: 0.82, opacity: 0.7,  transform: `translate(${profile.overshootX}px, ${profile.dropY}px) scale(${profile.outgoingScale}) rotate(${profile.tiltDeg}deg)`, filter: `blur(${Math.max(0.6, profile.outgoingBlur * 0.85)}px)` },
        { offset: 1,    opacity: 0,    transform: `translate(${profile.slideX + Math.max(2, profile.overshootX - profile.slideX)}px, ${profile.dropY + 2}px) scale(${Math.max(0.72, profile.outgoingScale - 0.05)}) rotate(${profile.tiltDeg + 8}deg)`, filter: `blur(${Math.max(0.9, profile.outgoingBlur)}px)` }
    ];
}

function buildFallIncomingKeyframes(profile) {
    const motionType = profile.motionType || 'faceplant';
    const incomingStartX = Math.max(5, profile.overshootX - (profile.slideX * 0.15));

    if (motionType === 'burst-stop') {
        return [
            { offset: 0,    opacity: 0.06, transform: `translate(${Math.max(4, profile.slideX * 0.6)}px, ${-Math.max(2, profile.incomingLiftY * 0.24)}px) scale(${Math.max(0.88, profile.incomingStartScale)}, ${Math.max(0.76, profile.incomingStartScale - 0.06)}) rotate(${-Math.max(4, profile.tiltDeg * 0.14)}deg)`, filter: 'brightness(1.12) blur(0.9px)' },
            { offset: 0.44, opacity: 0.92, transform: `translate(${Math.max(1, profile.slideX * 0.18)}px, ${Math.max(1, profile.dropY * 0.2)}px) scale(${Math.min(1.02, profile.impactScale)}, ${Math.max(0.9, profile.impactScale - 0.08)}) rotate(${Math.max(2, profile.tiltDeg * 0.08)}deg)`, filter: 'brightness(1.06)' },
            { offset: 0.76, opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.22}px) scale(${Math.min(1.03, profile.impactScale)}, ${Math.max(0.94, profile.impactScale - 0.04)}) rotate(0deg)`, filter: 'brightness(1.01)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)', filter: 'none' }
        ];
    }

    if (motionType === 'arc-drop') {
        return [
            { offset: 0,    opacity: 0.04, transform: `translate(${incomingStartX}px, ${-Math.max(8, profile.incomingLiftY)}px) scale(${profile.incomingStartScale}) rotate(${-Math.max(10, profile.tiltDeg * 0.6)}deg)`, filter: 'brightness(1.18) saturate(1.08) blur(1.2px)' },
            { offset: 0.42, opacity: 0.78, transform: `translate(${Math.max(2, profile.slideX * 0.24)}px, ${-Math.max(3, profile.incomingLiftY * 0.36)}px) scale(${Math.min(1.02, profile.impactScale - 0.01)}) rotate(${Math.max(8, profile.tiltDeg * 0.24)}deg)`, filter: 'brightness(1.08)' },
            { offset: 0.78, opacity: 1,    transform: `translate(-1px, ${Math.min(1, profile.reboundY * 0.9)}px) scale(${profile.impactScale}) rotate(${Math.max(4, profile.tiltDeg * 0.1)}deg)`, filter: 'brightness(1.02)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
        ];
    }

    if (motionType === 'thrust-fade') {
        return [
            { offset: 0,    opacity: 0.03, transform: `translate(${incomingStartX}px, ${-Math.max(6, profile.incomingLiftY * 0.7)}px) scale(${profile.incomingStartScale}) rotate(${-Math.max(6, profile.tiltDeg * 0.36)}deg)`, filter: 'brightness(1.14) saturate(1.02) blur(1.2px)' },
            { offset: 0.46, opacity: 0.76, transform: `translate(${Math.max(2, profile.slideX * 0.34)}px, ${Math.max(1, profile.dropY * 0.18)}px) scale(${Math.min(1.02, profile.impactScale)}) rotate(${Math.max(6, profile.tiltDeg * 0.18)}deg)`, filter: 'brightness(1.04)' },
            { offset: 0.8,  opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.3}px) scale(${Math.min(1.04, profile.impactScale)}) rotate(${Math.max(2, profile.tiltDeg * 0.05)}deg)`, filter: 'brightness(1.01)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
        ];
    }

    if (motionType === 'heavy-flop') {
        return [
            { offset: 0,    opacity: 0.06, transform: `translate(${Math.max(3, profile.slideX * 0.42)}px, ${-Math.max(2, profile.incomingLiftY * 0.24)}px) scale(${Math.max(0.86, profile.incomingStartScale)}) rotate(${-Math.max(4, profile.tiltDeg * 0.18)}deg)`, filter: 'brightness(1.1) blur(0.8px)' },
            { offset: 0.58, opacity: 1,    transform: `translate(0px, ${Math.max(1, profile.dropY * 0.18)}px) scale(${profile.impactScale}) rotate(${Math.max(2, profile.tiltDeg * 0.08)}deg)`, filter: 'brightness(1.03)' },
            { offset: 0.84, opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.15}px) scale(${Math.min(1.02, profile.impactScale)}) rotate(0deg)`, filter: 'brightness(1.01)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
        ];
    }

    if (motionType === 'side-slip') {
        return [
            { offset: 0,    opacity: 0.04, transform: `translate(${Math.max(3, profile.slideX * 0.36)}px, ${-Math.max(2, profile.incomingLiftY * 0.16)}px) scale(${profile.incomingStartScale}) rotate(${-Math.max(8, profile.tiltDeg * 0.4)}deg)`, filter: 'brightness(1.12) blur(1px)' },
            { offset: 0.4,  opacity: 0.8,  transform: `translate(${Math.max(1, profile.slideX * 0.16)}px, ${Math.max(0.6, profile.dropY * 0.2)}px) scale(${Math.min(1.02, profile.impactScale - 0.01)}) rotate(${Math.max(10, profile.tiltDeg * 0.48)}deg)`, filter: 'brightness(1.05)' },
            { offset: 0.76, opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.35}px) scale(${Math.min(1.03, profile.impactScale)}) rotate(${-Math.max(2, profile.tiltDeg * 0.12)}deg)`, filter: 'brightness(1.02)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
        ];
    }

    if (motionType === 'splash-dip') {
        return [
            { offset: 0,    opacity: 0.05, transform: `translate(${Math.max(4, profile.slideX * 0.28)}px, ${-Math.max(1, profile.incomingLiftY * 0.1)}px) scale(${profile.incomingStartScale}) rotate(${-Math.max(5, profile.tiltDeg * 0.22)}deg)`, filter: 'brightness(1.12) blur(0.9px)' },
            { offset: 0.5,  opacity: 0.86, transform: `translate(${Math.max(1, profile.slideX * 0.2)}px, ${Math.max(2, profile.dropY * 0.42)}px) scale(${Math.min(1.02, profile.impactScale)}, ${Math.min(1.01, profile.impactScale - 0.01)}) rotate(${Math.max(5, profile.tiltDeg * 0.2)}deg)`, filter: 'brightness(1.04)' },
            { offset: 0.82, opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.18}px) scale(${Math.min(1.02, profile.impactScale)}) rotate(0deg)`, filter: 'brightness(1.01)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
        ];
    }

    // faceplant (default)
    return [
        { offset: 0,    opacity: 0.03, transform: `translate(${incomingStartX}px, ${-profile.incomingLiftY}px) scale(${profile.incomingStartScale}) rotate(${-profile.tiltDeg * 0.85}deg)`, filter: 'brightness(1.16) saturate(1.08) blur(1.2px)' },
        { offset: 0.38, opacity: 0.82, transform: `translate(${Math.max(2, profile.slideX * 0.34)}px, ${Math.max(1, profile.dropY * 0.44)}px) scale(${Math.min(1.03, profile.impactScale - 0.01)}) rotate(${profile.tiltDeg * 0.32}deg)`, filter: 'brightness(1.06)' },
        { offset: 0.74, opacity: 1,    transform: `translate(-1px, ${profile.reboundY}px) scale(${profile.impactScale}) rotate(${profile.tiltDeg * 0.08}deg)`, filter: 'brightness(1.01)' },
        { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
    ];
}

function buildRecoverOutgoingKeyframes(profile) {
    const motionType = profile.motionType || 'faceplant';

    if (motionType === 'burst-stop') {
        return [
            { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)', filter: 'none' },
            { offset: 0.4,  opacity: 0.84, transform: `translate(${-Math.max(2, profile.slideX * 0.24)}px, ${Math.max(1, profile.dropY * 0.14)}px) scale(${Math.max(0.96, profile.outgoingScale + 0.08)}, ${Math.max(0.84, profile.outgoingScale - 0.02)}) rotate(${-Math.max(3, profile.tiltDeg * 0.12)}deg)`, filter: 'brightness(1.04)' },
            { offset: 1,    opacity: 0,    transform: `translate(${-Math.max(4, profile.slideX * 0.44)}px, ${-Math.max(1, profile.dropY * 0.22)}px) scale(${Math.max(0.9, profile.outgoingScale + 0.02)}, ${Math.max(0.78, profile.outgoingScale - 0.08)}) rotate(${-Math.max(5, profile.tiltDeg * 0.2)}deg)`, filter: 'blur(0.9px)' }
        ];
    }

    return [
        { offset: 0,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' },
        { offset: 0.44, opacity: 0.86, transform: `translate(${-Math.max(2, profile.slideX * 0.42)}px, ${Math.max(1, profile.dropY * 0.2)}px) scale(${Math.max(0.88, profile.outgoingScale + 0.04)}) rotate(${-profile.tiltDeg * 0.34}deg)`, filter: 'brightness(1.04)' },
        { offset: 1,    opacity: 0,    transform: `translate(${-Math.max(6, profile.slideX * 0.74)}px, ${-Math.max(2, profile.dropY * 0.5)}px) scale(${Math.max(0.76, profile.outgoingScale - 0.02)}) rotate(${-profile.tiltDeg * 0.72}deg)`, filter: 'blur(1.1px)' }
    ];
}

function buildRecoverIncomingKeyframes(profile) {
    const motionType = profile.motionType || 'faceplant';

    if (motionType === 'burst-stop') {
        return [
            { offset: 0,    opacity: 0.08, transform: `translate(${Math.max(2, profile.slideX * 0.24)}px, ${Math.max(1, profile.dropY * 0.12)}px) scale(0.92, 0.96) rotate(${-Math.max(4, profile.tiltDeg * 0.12)}deg)`, filter: 'brightness(1.08) blur(0.9px)' },
            { offset: 0.62, opacity: 1,    transform: `translate(0px, ${profile.reboundY * 0.12}px) scale(1.02, 0.98) rotate(0deg)`, filter: 'brightness(1.04)' },
            { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)', filter: 'none' }
        ];
    }

    return [
        { offset: 0,    opacity: 0.08, transform: `translate(${Math.max(3, profile.slideX * 0.42)}px, ${Math.max(2, profile.dropY * 0.4)}px) scale(${Math.max(0.8, profile.incomingStartScale)}) rotate(${-profile.tiltDeg * 0.4}deg)`, filter: 'brightness(1.12) blur(1px)' },
        { offset: 0.64, opacity: 1,    transform: `translate(1px, ${profile.reboundY * 0.45}px) scale(${Math.min(1.04, profile.impactScale - 0.01)}) rotate(${profile.tiltDeg * 0.08}deg)`, filter: 'brightness(1.04)' },
        { offset: 1,    opacity: 1,    transform: 'translate(0px, 0px) scale(1) rotate(0deg)', filter: 'none' }
    ];
}

// ─── WAAPI 헬퍼 ───
function playFallNodeAnimation(node, keyframes, options) {
    if (!node || typeof node.animate !== 'function') return null;
    return node.animate(keyframes, { fill: 'forwards', ...options });
}

function animateSpriteOffset(sprite, targetOffsetX, duration, easing, keyframeOffsets) {
    if (!sprite) return;
    const sourceOffsetX = parseFloat(sprite.dataset.fallOffsetX || '0') || 0;
    const normalizedTarget = Number.isFinite(targetOffsetX) ? targetOffsetX : 0;

    if (sprite._fallMotionAnimation) {
        sprite._fallMotionAnimation.cancel();
        sprite._fallMotionAnimation = null;
    }

    sprite.dataset.fallOffsetX = String(normalizedTarget);
    const toTransform = `translateX(${normalizedTarget}px)`;

    if (typeof sprite.animate === 'function' && sourceOffsetX !== normalizedTarget) {
        const fromTransform = `translateX(${sourceOffsetX}px)`;
        const keyframes = Array.isArray(keyframeOffsets) && keyframeOffsets.length
            ? keyframeOffsets.map(entry => {
                const x = Number.isFinite(entry?.x) ? entry.x : normalizedTarget;
                const frame = { transform: `translateX(${x}px)` };
                if (Number.isFinite(entry?.offset)) frame.offset = entry.offset;
                return frame;
            })
            : [{ transform: fromTransform }, { transform: toTransform }];

        sprite._fallMotionAnimation = sprite.animate(keyframes, { duration, easing, fill: 'forwards' });
        sprite._fallMotionAnimation.onfinish = () => {
            sprite.style.transform = toTransform;
            sprite._fallMotionAnimation = null;
        };
        sprite._fallMotionAnimation.oncancel = () => { sprite._fallMotionAnimation = null; };
    } else {
        sprite.style.transform = toTransform;
    }
}

// ─── 게임 엔트리 포인트 ───
function clearFallTransitionNodes(sprite) {
    if (!sprite) return;
    sprite.querySelectorAll('.vehicle-transition-layer, .vehicle-transition-flash, .vehicle-transition-dust').forEach(n => n.remove());
    sprite.classList.remove('vehicle-transform-to-fallen', 'vehicle-transform-to-run');
}

function animateVehicleFallState(horseElement, vehicleId, targetState) {
    if (!horseElement || !vehicleId) return;
    const sprite = horseElement.querySelector('.vehicle-sprite');
    if (!sprite) return;

    // resolveVehicleStateData 는 horse-race.js에 정의되어 있음 (전역)
    const variant = horseElement.dataset.vehicleVariant || 'base';
    if (typeof resolveVehicleStateData !== 'function') {
        // fallback: 즉시 스왑
        if (typeof setVehicleState === 'function') setVehicleState(horseElement, vehicleId, targetState);
        return;
    }

    const sourceState = targetState === 'fallen' ? 'run' : 'fallen';
    const sourceData = resolveVehicleStateData(vehicleId, sourceState, variant);
    const targetData = resolveVehicleStateData(vehicleId, targetState, variant);
    if (!targetData) return;

    const profile = getFallMotionProfile(vehicleId);
    const duration = targetState === 'fallen' ? profile.fallMs : profile.recoverMs;

    clearFallTransitionNodes(sprite);

    // 타겟 상태를 active-layer(또는 sprite 내부 frame1/frame2)에 기록
    const outgoingFrame1 = sourceData && sourceData.frame1 ? sourceData.frame1 : '';
    const outgoingFrame2 = sourceData && sourceData.frame2 ? sourceData.frame2 : '';

    if (typeof writeVehicleSpriteState === 'function') {
        writeVehicleSpriteState(sprite, targetData);
    }

    // outgoing 레이어 생성 (이전 상태 스냅샷)
    let outgoingLayer = null;
    if (outgoingFrame1 || outgoingFrame2) {
        if (typeof createVehicleSpriteLayer === 'function') {
            outgoingLayer = createVehicleSpriteLayer(
                outgoingFrame1,
                outgoingFrame2,
                'vehicle-transition-layer vehicle-transition-outgoing'
            );
        } else {
            outgoingLayer = document.createElement('div');
            outgoingLayer.className = 'vehicle-transition-layer vehicle-transition-outgoing';
            outgoingLayer.innerHTML = `<div class="frame1">${outgoingFrame1}</div><div class="frame2">${outgoingFrame2}</div>`;
        }
        sprite.appendChild(outgoingLayer);
    }

    // flash
    const flash = document.createElement('div');
    flash.className = 'vehicle-transition-flash';
    flash.style.background = getFallFlashGradient(profile);
    sprite.appendChild(flash);

    // trail (fallen 진입 시에만)
    let trail = null;
    if (targetState === 'fallen') {
        trail = document.createElement('div');
        trail.className = 'vehicle-transition-dust';
        trail.style.background = getFallTrailBackground(profile);
        trail.style.bottom = (profile.fxType === 'smoke' || profile.fxType === 'wind') ? '2px' : '-2px';
        trail.style.height = profile.fxType === 'feather' ? '26px' : profile.fxType === 'splash' ? '18px' : '22px';
        sprite.appendChild(trail);
    }

    sprite.classList.add(targetState === 'fallen' ? 'vehicle-transform-to-fallen' : 'vehicle-transform-to-run');

    // active-layer WAAPI
    const activeLayer = sprite.querySelector('.vehicle-active-layer') || sprite;

    // sprite 자체의 offset 애니메이션 (stage 역할)
    const targetOffsetX = targetState === 'fallen' ? profile.slideX : 0;
    animateSpriteOffset(
        sprite,
        targetOffsetX,
        duration,
        targetState === 'fallen' ? 'cubic-bezier(0.16, 0.82, 0.22, 1)' : 'cubic-bezier(0.22, 0.74, 0.3, 1)',
        buildFallOffsetKeyframes(profile, targetState)
    );

    if (targetState === 'fallen') {
        if (outgoingLayer) {
            playFallNodeAnimation(outgoingLayer, buildFallOutgoingKeyframes(profile), {
                duration,
                easing: 'cubic-bezier(0.18, 0.3, 0.34, 1)'
            });
        }
        playFallNodeAnimation(activeLayer, buildFallIncomingKeyframes(profile), {
            duration,
            easing: 'cubic-bezier(0.18, 0.82, 0.22, 1)'
        });
        playFallNodeAnimation(flash, [
            { offset: 0,    opacity: 0, transform: 'scale(0.42) translateX(-2px)' },
            { offset: 0.28, opacity: Math.min(0.48 + (profile.fxStrength * 0.56), 0.96), transform: `scale(${1 + (profile.fxStrength * 0.18)}) translateX(${Math.round(profile.slideX * 0.2)}px)` },
            { offset: 1,    opacity: 0, transform: `scale(${1.52 + (profile.fxStrength * 0.3)}) translateX(${Math.round(profile.slideX * 0.75)}px)` }
        ], { duration, easing: 'ease-out' });

        if (trail) {
            playFallNodeAnimation(trail, [
                { offset: 0,    opacity: 0, transform: `translateX(${-Math.max(4, (profile.braceX || 0) * 2)}px) scale(0.45, 0.62)`, filter: 'blur(0px)' },
                { offset: 0.28, opacity: Math.min(0.44 + (profile.fxStrength * 0.58), 0.94), transform: `translateX(${Math.round(profile.slideX * 0.2)}px) scale(1, 1)`, filter: 'blur(0.5px)' },
                { offset: 0.72, opacity: Math.max(0.18, profile.fxStrength * 0.46), transform: `translateX(${Math.round(profile.overshootX * 0.76)}px) scale(${1.12 + (profile.fxStrength * 0.26)}, ${1.02 + (profile.fxStrength * 0.16)})`, filter: 'blur(1px)' },
                { offset: 1,    opacity: 0, transform: `translateX(${Math.round(profile.slideX + (profile.fxStrength * 10))}px) scale(${1.34 + (profile.fxStrength * 0.3)}, ${1.08 + (profile.fxStrength * 0.18)})`, filter: 'blur(1.7px)' }
            ], { duration: duration + 40, easing: 'ease-out' });
        }
    } else {
        if (outgoingLayer) {
            playFallNodeAnimation(outgoingLayer, buildRecoverOutgoingKeyframes(profile), {
                duration,
                easing: 'cubic-bezier(0.22, 0.2, 0.34, 1)'
            });
        }
        playFallNodeAnimation(activeLayer, buildRecoverIncomingKeyframes(profile), {
            duration,
            easing: 'cubic-bezier(0.22, 0.78, 0.28, 1)'
        });
        playFallNodeAnimation(flash, [
            { offset: 0,    opacity: 0, transform: 'scale(0.56)' },
            { offset: 0.34, opacity: 0.32 + (profile.fxStrength * 0.24), transform: 'scale(0.96)' },
            { offset: 1,    opacity: 0, transform: 'scale(1.26)' }
        ], { duration, easing: 'ease-out' });
    }

    // 종료 시 정리
    clearTimeout(sprite._fallCleanupTimer);
    sprite._fallCleanupTimer = setTimeout(() => {
        clearFallTransitionNodes(sprite);
    }, duration + 60);
}
