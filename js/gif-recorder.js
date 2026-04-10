/**
 * GIF Recorder Module v1.0
 *
 * 재사용 가능한 GIF 녹화 모듈
 * - 전체 녹화 / 하이라이트 녹화 지원
 * - 품질 선택 (저/중/고)
 * - html2canvas + gif.js 기반
 *
 * 사용법:
 * 1. GifRecorder.init({ targetElement: '#container', ... })
 * 2. 게임 루프에서 GifRecorder.captureFrame() 호출
 * 3. GifRecorder.showOptionsModal() 로 녹화 시작
 */

(function() {
    'use strict';

    // CDN 라이브러리 로드 상태
    let html2canvasLoaded = false;
    let gifJsLoaded = false;

    // 품질 프리셋 (성능 최적화: fps와 scale 낮춤)
    const QUALITY_PRESETS = {
        low: { fps: 5, scale: 0.25, quality: 15, label: '저화질 (~1MB)' },
        medium: { fps: 6, scale: 0.35, quality: 12, label: '중화질 (~2MB)' },
        high: { fps: 8, scale: 0.5, quality: 10, label: '고화질 (~4MB)' }
    };

    // 녹화 상태
    const state = {
        initialized: false,
        isRecording: false,
        mode: 'highlight', // 'full' | 'highlight'
        quality: 'medium',
        frames: [],
        frameBuffer: [], // 하이라이트용 롤링 버퍼
        bufferMaxSize: 30, // 3초 분량 (10fps 기준)
        highlightTriggered: false,
        captureInterval: null,
        targetElement: null,
        options: {}
    };

    // 모달 HTML 템플릿
    const MODAL_HTML = `
        <div id="gifRecorderModal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); justify-content: center; align-items: center; z-index: 10000; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <div style="background: white; padding: 25px 30px; border-radius: 16px; max-width: 360px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                <h3 style="margin: 0 0 20px 0; color: #333; font-size: 18px; text-align: center;">📹 GIF 저장 옵션</h3>

                <div style="margin-bottom: 20px;">
                    <div style="font-weight: 600; color: #555; margin-bottom: 10px; font-size: 14px;">📼 녹화 범위</div>
                    <label style="display: flex; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s;" id="gifModeFullLabel">
                        <input type="radio" name="gifMode" value="full" style="margin-right: 10px;">
                        <span>전체 경주</span>
                    </label>
                    <label style="display: flex; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; cursor: pointer; border: 2px solid #4CAF50; transition: all 0.2s;" id="gifModeHighlightLabel">
                        <input type="radio" name="gifMode" value="highlight" checked style="margin-right: 10px;">
                        <span>하이라이트 <span style="color: #4CAF50; font-size: 12px;">(권장)</span></span>
                    </label>
                </div>

                <div style="margin-bottom: 25px;">
                    <div style="font-weight: 600; color: #555; margin-bottom: 10px; font-size: 14px;">🎨 품질</div>
                    <label style="display: flex; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s;" id="gifQualityLowLabel">
                        <input type="radio" name="gifQuality" value="low" style="margin-right: 10px;">
                        <span>저화질 <span style="color: #888; font-size: 12px;">(~1MB, 빠름)</span></span>
                    </label>
                    <label style="display: flex; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 8px; cursor: pointer; border: 2px solid #4CAF50; transition: all 0.2s;" id="gifQualityMediumLabel">
                        <input type="radio" name="gifQuality" value="medium" checked style="margin-right: 10px;">
                        <span>중화질 <span style="color: #4CAF50; font-size: 12px;">(~2MB) 권장</span></span>
                    </label>
                    <label style="display: flex; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s;" id="gifQualityHighLabel">
                        <input type="radio" name="gifQuality" value="high" style="margin-right: 10px;">
                        <span>고화질 <span style="color: #888; font-size: 12px;">(~4MB)</span></span>
                    </label>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button id="gifCancelBtn" style="flex: 1; padding: 12px; background: #e0e0e0; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; color: #333; transition: background 0.2s;">취소</button>
                    <button id="gifStartBtn" style="flex: 1; padding: 12px; background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); border: none; border-radius: 8px; cursor: pointer; font-weight: 600; color: white; transition: transform 0.2s;">녹화 시작</button>
                </div>
            </div>
        </div>
    `;

    // 진행 표시 HTML
    const PROGRESS_HTML = `
        <div id="gifProgressOverlay" style="display: none; position: fixed; bottom: 20px; right: 20px; background: white; padding: 15px 20px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.2); z-index: 10001; min-width: 250px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <div style="display: flex; align-items: center; margin-bottom: 10px;">
                <span id="gifProgressIcon" style="font-size: 20px; margin-right: 10px;">⏺️</span>
                <span id="gifProgressStatus" style="font-weight: 600; color: #333;">녹화 준비 중...</span>
            </div>
            <div style="background: #e0e0e0; border-radius: 10px; overflow: hidden; height: 8px;">
                <div id="gifProgressBar" style="height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); width: 0%; transition: width 0.3s;"></div>
            </div>
            <div id="gifProgressText" style="margin-top: 8px; font-size: 12px; color: #666; text-align: center;">0%</div>
        </div>
    `;

    // 라이브러리 동적 로드
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function loadDependencies() {
        try {
            if (!html2canvasLoaded) {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
                html2canvasLoaded = true;
                console.log('[GifRecorder] html2canvas loaded');
            }
            if (!gifJsLoaded) {
                await loadScript('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');
                gifJsLoaded = true;
                console.log('[GifRecorder] gif.js loaded');
            }
        } catch (e) {
            console.error('[GifRecorder] Failed to load dependencies:', e);
            throw e;
        }
    }

    // UI 삽입
    function injectUI() {
        if (!document.getElementById('gifRecorderModal')) {
            document.body.insertAdjacentHTML('beforeend', MODAL_HTML);
            document.body.insertAdjacentHTML('beforeend', PROGRESS_HTML);
            setupModalEvents();
        }
    }

    // 모달 이벤트 설정
    function setupModalEvents() {
        const modal = document.getElementById('gifRecorderModal');
        const cancelBtn = document.getElementById('gifCancelBtn');
        const startBtn = document.getElementById('gifStartBtn');

        if (!modal || !cancelBtn || !startBtn) {
            console.error('[GifRecorder] Modal elements not found');
            return;
        }

        // 라디오 버튼 스타일 업데이트
        document.querySelectorAll('input[name="gifMode"]').forEach(radio => {
            radio.addEventListener('change', () => updateRadioStyles('gifMode'));
        });
        document.querySelectorAll('input[name="gifQuality"]').forEach(radio => {
            radio.addEventListener('change', () => updateRadioStyles('gifQuality'));
        });

        cancelBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        startBtn.addEventListener('click', () => {
            const mode = document.querySelector('input[name="gifMode"]:checked').value;
            const quality = document.querySelector('input[name="gifQuality"]:checked').value;
            modal.style.display = 'none';

            if (state.options.onStartRequested) {
                state.options.onStartRequested(mode, quality);
            }
        });

        // 모달 외부 클릭 시 닫기
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    }

    function updateRadioStyles(groupName) {
        const prefix = groupName === 'gifMode' ? 'gifMode' : 'gifQuality';
        const labels = {
            gifMode: ['gifModeFullLabel', 'gifModeHighlightLabel'],
            gifQuality: ['gifQualityLowLabel', 'gifQualityMediumLabel', 'gifQualityHighLabel']
        };

        labels[groupName].forEach(labelId => {
            const label = document.getElementById(labelId);
            const radio = label.querySelector('input[type="radio"]');
            if (radio.checked) {
                label.style.borderColor = '#4CAF50';
            } else {
                label.style.borderColor = 'transparent';
            }
        });
    }

    // 진행 표시 업데이트
    function updateProgress(percent, status, icon = '⏺️') {
        const overlay = document.getElementById('gifProgressOverlay');
        const bar = document.getElementById('gifProgressBar');
        const text = document.getElementById('gifProgressText');
        const statusEl = document.getElementById('gifProgressStatus');
        const iconEl = document.getElementById('gifProgressIcon');

        if (overlay) {
            overlay.style.display = 'block';
            bar.style.width = `${percent}%`;
            text.textContent = `${Math.round(percent)}%`;
            statusEl.textContent = status;
            iconEl.textContent = icon;
        }
    }

    function hideProgress() {
        const overlay = document.getElementById('gifProgressOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    // GIF Recorder 공개 API
    window.GifRecorder = {
        /**
         * 초기화
         * @param {Object} options
         * @param {string|HTMLElement} options.targetElement - 캡처할 DOM 요소
         * @param {Function} options.getHighlightCondition - 하이라이트 조건 체크 함수 () => boolean
         * @param {Function} options.onStartRequested - 녹화 시작 요청 시 콜백 (mode, quality) => void
         * @param {Function} options.onRecordingStart - 녹화 시작 시 콜백
         * @param {Function} options.onRecordingEnd - 녹화 종료 시 콜백 (blob) => void
         * @param {Function} options.onProgress - 진행률 콜백 (percent) => void
         * @param {string} options.filenamePrefix - 파일명 접두사 (기본: 'recording')
         */
        async init(options = {}) {
            console.log('[GifRecorder] Initializing...');
            await loadDependencies();
            injectUI();

            state.options = options;
            state.targetElement = typeof options.targetElement === 'string'
                ? document.querySelector(options.targetElement)
                : options.targetElement;

            if (!state.targetElement) {
                console.error('[GifRecorder] Target element not found:', options.targetElement);
            } else {
                console.log('[GifRecorder] Target element found:', state.targetElement);
            }

            state.initialized = true;
            console.log('[GifRecorder] Initialized successfully');
        },

        /**
         * 옵션 모달 표시
         */
        showOptionsModal() {
            if (!state.initialized) {
                console.warn('[GifRecorder] Not initialized');
                alert('GIF 녹화 모듈 초기화 중입니다. 잠시 후 다시 시도해주세요.');
                return;
            }
            const modal = document.getElementById('gifRecorderModal');
            if (modal) {
                modal.style.display = 'flex';
            } else {
                console.error('[GifRecorder] Modal not found');
                alert('GIF 녹화 모달을 찾을 수 없습니다.');
            }
        },

        /**
         * 녹화 시작
         * @param {string} mode - 'full' | 'highlight'
         * @param {string} quality - 'low' | 'medium' | 'high'
         */
        startRecording(mode = 'highlight', quality = 'medium') {
            console.log('[GifRecorder] startRecording called - initialized:', state.initialized, 'isRecording:', state.isRecording);
            if (!state.initialized) {
                console.error('[GifRecorder] Cannot start - not initialized');
                return false;
            }
            if (state.isRecording) {
                console.warn('[GifRecorder] Already recording');
                return false;
            }

            state.isRecording = true;
            state.mode = mode;
            state.quality = quality;
            state.frames = [];
            state.frameBuffer = [];
            state.highlightTriggered = false;

            const preset = QUALITY_PRESETS[quality];
            const frameDelay = Math.round(1000 / preset.fps);

            // 버퍼 크기 설정 (3초 분량)
            state.bufferMaxSize = preset.fps * 3;

            updateProgress(0, '녹화 중...', '⏺️');

            if (state.options.onRecordingStart) {
                state.options.onRecordingStart();
            }

            console.log(`[GifRecorder] Recording started - Mode: ${mode}, Quality: ${quality}, Target:`, state.targetElement);
            return true;
        },

        /**
         * 프레임 캡처 (게임 루프에서 호출)
         * @returns {Promise<boolean>} 캡처 성공 여부
         */
        async captureFrame() {
            if (!state.isRecording) {
                console.log('[GifRecorder] captureFrame skipped - not recording');
                return false;
            }
            if (!state.targetElement) {
                console.error('[GifRecorder] Target element not found');
                return false;
            }
            console.log('[GifRecorder] Capturing frame... mode:', state.mode, 'frames:', state.frames.length, 'buffer:', state.frameBuffer.length);

            const preset = QUALITY_PRESETS[state.quality];

            try {
                const canvas = await html2canvas(state.targetElement, {
                    scale: preset.scale,
                    useCORS: true,
                    allowTaint: true,
                    logging: false,
                    backgroundColor: '#f5f5f5',
                    imageTimeout: 0,
                    removeContainer: true,
                    ignoreElements: (el) => {
                        // 불필요한 요소 제외하여 성능 향상
                        if (!el.classList) return false;
                        return el.classList.contains('gif-ignore') ||
                            el.classList.contains('weather-overlay') ||
                            el.classList.contains('weather-toast') ||
                            el.id === 'gifProgressOverlay' ||
                            el.id === 'liveRankingPanel';
                    }
                });

                if (state.mode === 'full') {
                    // 전체 녹화: 바로 프레임 저장
                    state.frames.push(canvas);

                    // 최대 프레임 제한 (15초)
                    const maxFrames = preset.fps * 15;
                    if (state.frames.length >= maxFrames) {
                        this.stopRecording();
                    }
                } else {
                    // 하이라이트 녹화: 롤링 버퍼 + 트리거 후 저장
                    if (!state.highlightTriggered) {
                        // 버퍼에 추가 (최근 3초)
                        state.frameBuffer.push(canvas);
                        if (state.frameBuffer.length > state.bufferMaxSize) {
                            state.frameBuffer.shift();
                        }
                    } else {
                        // 트리거 후: 실제 프레임 저장
                        state.frames.push(canvas);

                        // 트리거 후 5초까지 녹화
                        const maxPostTriggerFrames = preset.fps * 5;
                        if (state.frames.length >= state.bufferMaxSize + maxPostTriggerFrames) {
                            this.stopRecording();
                        }
                    }
                }

                return true;
            } catch (e) {
                console.error('[GifRecorder] Frame capture failed:', e);
                return false;
            }
        },

        /**
         * 하이라이트 트리거 체크 (게임 루프에서 호출)
         * @param {any} gameState - 게임 상태 (getHighlightCondition에 전달)
         */
        checkHighlightTrigger(gameState) {
            if (!state.isRecording || state.mode !== 'highlight' || state.highlightTriggered) {
                return;
            }

            const conditionMet = state.options.getHighlightCondition ? state.options.getHighlightCondition(gameState) : false;
            // 5프레임마다 한번씩 로그 출력
            if (state.frameBuffer.length % 5 === 0) {
                console.log('[GifRecorder] checkHighlightTrigger - conditionMet:', conditionMet, 'gameState:', gameState ? 'exists' : 'null');
            }

            if (conditionMet) {
                console.log('[GifRecorder] Highlight triggered!');
                state.highlightTriggered = true;

                // 버퍼의 프레임들을 실제 프레임으로 이동
                state.frames = [...state.frameBuffer];
                state.frameBuffer = [];

                updateProgress(30, '하이라이트 캡처 중...', '🎬');
            }
        },

        /**
         * 녹화 중지 및 GIF 생성
         */
        async stopRecording() {
            console.log('[GifRecorder] stopRecording called - isRecording:', state.isRecording, 'frames:', state.frames.length, 'buffer:', state.frameBuffer.length);
            if (!state.isRecording) {
                console.warn('[GifRecorder] Not recording, nothing to stop');
                return;
            }

            state.isRecording = false;

            // 하이라이트 모드에서 트리거 안됐으면 버퍼 사용
            if (state.mode === 'highlight' && !state.highlightTriggered && state.frameBuffer.length > 0) {
                console.log('[GifRecorder] Using buffer frames (highlight not triggered)');
                state.frames = [...state.frameBuffer];
            }

            console.log('[GifRecorder] Final frame count:', state.frames.length);

            if (state.frames.length === 0) {
                console.error('[GifRecorder] No frames captured! Mode:', state.mode, 'Buffer:', state.frameBuffer.length, 'Triggered:', state.highlightTriggered);
                hideProgress();
                alert('프레임이 캡처되지 않았습니다. 다시 시도해주세요.');
                return;
            }

            console.log(`[GifRecorder] Generating GIF from ${state.frames.length} frames`);
            updateProgress(50, 'GIF 생성 중...', '⚙️');

            try {
                await this.generateGif();
                console.log('[GifRecorder] generateGif completed successfully');
            } catch (err) {
                console.error('[GifRecorder] generateGif failed:', err);
                alert('GIF 생성 실패: ' + (err.message || err));
            }
        },

        /**
         * GIF 생성 및 다운로드
         */
        async generateGif() {
            return new Promise((resolve, reject) => {
                const preset = QUALITY_PRESETS[state.quality];
                const frameDelay = Math.round(1000 / preset.fps);

                // 프레임 검증
                console.log('[GifRecorder] generateGif - frames:', state.frames.length, 'frameDelay:', frameDelay);
                if (state.frames.length > 0) {
                    console.log('[GifRecorder] First frame dimensions:', state.frames[0].width, 'x', state.frames[0].height);
                }

                if (!state.frames[0] || state.frames[0].width === 0 || state.frames[0].height === 0) {
                    console.error('[GifRecorder] Invalid frame dimensions!');
                    hideProgress();
                    alert('프레임 크기가 잘못되었습니다. 다시 시도해주세요.');
                    reject(new Error('Invalid frame dimensions'));
                    return;
                }

                console.log('[GifRecorder] Creating GIF object...');
                const gif = new GIF({
                    workers: 2,
                    quality: preset.quality,
                    width: state.frames[0].width,
                    height: state.frames[0].height,
                    workerScript: '/js/gif.worker.js'  // 로컬 파일 사용 (CORS 회피)
                });
                console.log('[GifRecorder] GIF object created, adding frames...');

                // 프레임 추가
                state.frames.forEach((canvas, index) => {
                    gif.addFrame(canvas, { delay: frameDelay });
                    if (index === 0 || index === state.frames.length - 1) {
                        console.log('[GifRecorder] Added frame', index, ':', canvas.width, 'x', canvas.height);
                    }
                });
                console.log('[GifRecorder] All frames added, starting render...');

                gif.on('progress', (p) => {
                    const totalProgress = 50 + (p * 50);
                    updateProgress(totalProgress, 'GIF 인코딩 중...', '⚙️');

                    if (state.options.onProgress) {
                        state.options.onProgress(totalProgress);
                    }
                });

                gif.on('finished', (blob) => {
                    // 다운로드
                    const prefix = state.options.filenamePrefix || 'recording';
                    const filename = `${prefix}-${Date.now()}.gif`;

                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    // 메모리 정리
                    state.frames.forEach(canvas => {
                        canvas.width = 0;
                        canvas.height = 0;
                    });
                    state.frames = [];
                    state.frameBuffer = [];

                    updateProgress(100, '다운로드 완료!', '✅');

                    setTimeout(() => {
                        hideProgress();
                    }, 2000);

                    if (state.options.onRecordingEnd) {
                        state.options.onRecordingEnd(blob);
                    }

                    console.log(`[GifRecorder] GIF saved: ${filename}, size: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
                    alert(`GIF 저장 완료! 파일: ${filename}\n크기: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
                    resolve(blob);
                });

                gif.on('error', (err) => {
                    console.error('[GifRecorder] GIF generation error:', err);
                    hideProgress();
                    alert('GIF 생성 오류: ' + err.message);
                    reject(err);
                });

                console.log('[GifRecorder] Calling gif.render()...');
                gif.render();
            });
        },

        /**
         * 녹화 중인지 확인
         */
        isRecording() {
            return state.isRecording;
        },

        /**
         * 하이라이트 트리거 수동 호출
         */
        triggerHighlight() {
            if (state.isRecording && state.mode === 'highlight' && !state.highlightTriggered) {
                state.highlightTriggered = true;
                state.frames = [...state.frameBuffer];
                state.frameBuffer = [];
                updateProgress(30, '하이라이트 캡처 중...', '🎬');
            }
        },

        /**
         * 상태 리셋
         */
        reset() {
            state.isRecording = false;
            state.frames = [];
            state.frameBuffer = [];
            state.highlightTriggered = false;
            hideProgress();
        }
    };

})();
