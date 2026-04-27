// HTTP API 라우트
const path = require('path');
const fs = require('fs');
const { getPool } = require('../db/pool');
const { loadFrequentMenus, getMergedFrequentMenus, loadEmojiConfigBase, getMergedEmojiConfig } = require('../db/menus');
const { getVisitorStats, getGameStatsByType, getRecentPlaysList } = require('../db/stats');

function getServerId() {
    return process.env.SERVER_ID || 'default';
}

function setupRoutes(app) {
    // Server API 라우트 등록
    const serverRouter = require('./server');
    app.use('/api', serverRouter);

    // 정적 파일 제공 (캐시 방지 설정)
    app.use(require('express').static(path.join(__dirname, '..'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        }
    }));

    app.get('/', (req, res) => {
        res.redirect('/game');
    });

    app.get('/game', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(__dirname, '..', 'dice-game-multiplayer.html'));
    });

    app.get('/roulette', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(__dirname, '..', 'roulette-game-multiplayer.html'));
    });

    // 인형뽑기 게임 (비공개 처리)
    // app.get('/crane-game', (req, res) => {
    //     res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    //     res.setHeader('Pragma', 'no-cache');
    //     res.setHeader('Expires', '0');
    //     res.sendFile(path.join(__dirname, '..', 'crane-game-multiplayer.html'));
    // });

    // 경마 (레거시 HTML)
    const legacyHorseHtml = path.join(__dirname, '..', 'horse-race-multiplayer.html');
    const bridgeCrossHtml = path.join(__dirname, '..', 'bridge-cross-multiplayer.html');

    app.get('/horse-race', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(legacyHorseHtml);
    });

    app.get('/bridge-cross', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return res.sendFile(bridgeCrossHtml);
    });

    // 기존 .html URL 301 리디렉트 (SEO: 구 URL → 현재 URL)
    app.get('/dice-game-multiplayer.html', (req, res) => {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(301, `/game${query}`);
    });

    app.get('/roulette-game-multiplayer.html', (req, res) => {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(301, `/roulette${query}`);
    });

    app.get('/horse-race-multiplayer.html', (req, res) => {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(301, `/horse-race${query}`);
    });

    // SEO 페이지 구 URL 301 리디렉트 (루트 → /pages/)
    const seoPages = [
        'about-us', 'changelog', 'contact', 'crane-game-guide',
        'dice-history', 'dice-rules-guide', 'disclaimer', 'faq',
        'fairness-rng', 'game-guides', 'horse-race-guide',
        'privacy-policy', 'probability-analysis', 'probability-education',
        'roulette-guide', 'server-members', 'statistics', 'terms-of-service'
    ];
    seoPages.forEach(page => {
        app.get(`/${page}.html`, (req, res) => {
            return res.redirect(301, `/pages/${page}.html`);
        });
    });

    app.get('/admin', (req, res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(path.join(__dirname, '..', 'admin.html'));
    });

    // 이모지 설정 API
    app.get('/api/emoji-config', async (req, res) => {
        try {
            const serverId = getServerId();
            const config = await getMergedEmojiConfig(serverId);
            res.json(config);
        } catch (e) {
            console.error('이모지 설정 API 오류:', e);
            res.status(500).json(loadEmojiConfigBase());
        }
    });

    app.post('/api/emoji-config', async (req, res) => {
        try {
            const { emoji_key: emojiKey, label } = req.body || {};
            if (!emojiKey || typeof emojiKey !== 'string' || emojiKey.trim().length === 0) {
                return res.status(400).json({ error: 'emoji_key가 필요합니다.' });
            }
            const pool = getPool();
            const serverId = getServerId();
            if (!pool) {
                return res.status(503).json({ error: 'DB가 연결되지 않아 서버별 이모지를 추가할 수 없습니다.' });
            }
            await pool.query(
                'INSERT INTO emoji_config (server_id, emoji_key, label) VALUES ($1, $2, $3) ON CONFLICT (server_id, emoji_key) DO UPDATE SET label = EXCLUDED.label',
                [serverId, emojiKey.trim(), (label && String(label).trim()) || emojiKey.trim()]
            );
            const config = await getMergedEmojiConfig(serverId);
            res.json(config);
        } catch (e) {
            console.error('이모지 추가 오류:', e);
            res.status(500).json({ error: '이모지 추가 중 오류가 발생했습니다.' });
        }
    });

    app.delete('/api/emoji-config', async (req, res) => {
        try {
            const { emoji_key: emojiKey } = req.body || {};
            if (!emojiKey || typeof emojiKey !== 'string' || emojiKey.trim().length === 0) {
                return res.status(400).json({ error: 'emoji_key가 필요합니다.' });
            }
            const pool = getPool();
            const serverId = getServerId();
            if (!pool) {
                return res.status(503).json({ error: 'DB가 연결되지 않아 이모지를 삭제할 수 없습니다.' });
            }
            const base = loadEmojiConfigBase();
            if (base[emojiKey.trim()]) {
                return res.status(400).json({ error: '기본 이모지는 삭제할 수 없습니다.' });
            }
            await pool.query(
                'DELETE FROM emoji_config WHERE server_id = $1 AND emoji_key = $2',
                [serverId, emojiKey.trim()]
            );
            const config = await getMergedEmojiConfig(serverId);
            res.json(config);
        } catch (e) {
            console.error('이모지 삭제 오류:', e);
            res.status(500).json({ error: '이모지 삭제 중 오류가 발생했습니다.' });
        }
    });

    // 통계 API
    app.get('/api/statistics', async (req, res) => {
        try {
            const pool = getPool();
            const visitorStats = getVisitorStats();
            const defaultGameStats = { dice: { count: 0, totalParticipants: 0 }, roulette: { count: 0, totalParticipants: 0 }, 'horse-race': { count: 0, totalParticipants: 0 }, 'crane-game': { count: 0, totalParticipants: 0 }, bridge: { count: 0, totalParticipants: 0 } };
            let gameStats = { ...defaultGameStats };
            let recentPlays = [];
            if (pool) {
                try {
                    const summary = await pool.query(`
                        SELECT game_type, COUNT(*) AS play_count, COALESCE(SUM(participant_count), 0)::bigint AS total_participants
                        FROM game_records
                        GROUP BY game_type
                    `);
                    summary.rows.forEach(row => {
                        const key = row.game_type || 'dice';
                        if (!gameStats[key]) gameStats[key] = { count: 0, totalParticipants: 0 };
                        gameStats[key].count = parseInt(row.play_count, 10) || 0;
                        gameStats[key].totalParticipants = parseInt(row.total_participants, 10) || 0;
                    });
                    try {
                        const recent = await pool.query(`
                            SELECT game_type, participant_count, played_at
                            FROM game_records
                            ORDER BY played_at DESC NULLS LAST
                            LIMIT 50
                        `);
                        recentPlays = (recent.rows || []).map(row => ({
                            gameType: row.game_type,
                            participantCount: row.participant_count,
                            playedAt: row.played_at ? new Date(row.played_at).toISOString() : null
                        }));
                    } catch (recentErr) {
                        const fallback = await pool.query(`
                            SELECT id, game_type, participant_count
                            FROM game_records
                            ORDER BY id DESC
                            LIMIT 50
                        `);
                        recentPlays = (fallback.rows || []).map(row => ({
                            gameType: row.game_type,
                            participantCount: row.participant_count,
                            playedAt: null
                        }));
                    }
                } catch (dbErr) {
                    console.warn('통계 DB 조회:', dbErr.message);
                    recentPlays = [];
                }
            } else {
                const gameStatsByType = getGameStatsByType();
                Object.keys(defaultGameStats).forEach(k => {
                    if (gameStatsByType[k]) gameStats[k] = { count: gameStatsByType[k].count, totalParticipants: gameStatsByType[k].totalParticipants };
                });
                recentPlays = getRecentPlaysList().map(p => ({ gameType: p.gameType, participantCount: p.participantCount, playedAt: p.playedAt || null }));
            }

            const serverId = getServerId();
            const frequentMenusBase = loadFrequentMenus();
            const mergedMenus = await getMergedFrequentMenus(serverId);
            let frequentMenusServerCount = 0;
            if (pool) {
                try {
                    const r = await pool.query('SELECT COUNT(*) AS cnt FROM frequent_menus WHERE server_id = $1', [serverId]);
                    frequentMenusServerCount = parseInt(r.rows[0]?.cnt, 10) || 0;
                } catch (_) {}
            }
            const emojiBase = loadEmojiConfigBase();
            const mergedEmoji = await getMergedEmojiConfig(serverId);
            let emojiServerCount = 0;
            if (pool) {
                try {
                    const r = await pool.query('SELECT COUNT(*) AS cnt FROM emoji_config WHERE server_id = $1', [serverId]);
                    emojiServerCount = parseInt(r.rows[0]?.cnt, 10) || 0;
                } catch (_) {}
            }

            res.json({
                todayVisitors: visitorStats.todayVisitors,
                todayPlays: visitorStats.todayPlays,
                totalPlays: visitorStats.totalPlays,
                gameStats,
                recentPlays,
                frequentMenus: { total: mergedMenus.length, baseCount: frequentMenusBase.length, serverCount: frequentMenusServerCount },
                emoji: { total: Object.keys(mergedEmoji).length, baseCount: Object.keys(emojiBase).length, serverCount: emojiServerCount }
            });
        } catch (e) {
            console.error('통계 API 오류:', e);
            res.status(500).json({ error: '통계를 불러올 수 없습니다.' });
        }
    });

    // GPT API를 통한 커스텀 룰 당첨자 판단
    app.post('/api/calculate-custom-winner', async (req, res) => {
        try {
            const { gameRules, gameHistory } = req.body;

            if (!gameRules || !gameHistory || !Array.isArray(gameHistory) || gameHistory.length === 0) {
                return res.status(400).json({ error: '게임 룰과 기록이 필요합니다.' });
            }

            const openaiApiKey = process.env.OPENAI_API_KEY;
            if (!openaiApiKey) {
                return res.status(500).json({ error: 'OpenAI API 키가 설정되지 않았습니다.' });
            }

            const historyText = gameHistory.map(r => `${r.user}:${r.result}`).join(',');
            const prompt = `룰:"${gameRules}" 결과:${historyText} 적용 JSON:{"winners":[],"reason":""}`;

            const requestStartTime = Date.now();
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('🤖 GPT API 요청 시작');
            console.log(`📋 게임 룰: "${gameRules}"`);
            console.log(`🎲 주사위 결과: ${gameHistory.map(r => `${r.user}(${r.result})`).join(', ')}`);
            console.log(`👥 참여자 수: ${gameHistory.length}명`);
            console.log(`📝 프롬프트 길이: ${prompt.length}자`);
            console.log(`📄 입력 프롬프트:`);
            console.log(prompt);

            const models = ['gpt-5-nano', 'gpt-4o-mini'];
            let lastError = null;

            for (const model of models) {
                try {
                    console.log(`\n🔄 ${model} 모델 시도 중...`);

                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${openaiApiKey}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: [{ role: 'user', content: prompt }],
                            temperature: 0,
                            max_tokens: 50,
                            response_format: { type: "json_object" }
                        })
                    });

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        lastError = errorData;
                        const responseTime = Date.now() - requestStartTime;

                        if (errorData.error?.code === 'model_not_found' ||
                            errorData.error?.message?.includes('model') ||
                            errorData.error?.message?.includes('not found')) {
                            console.log(`❌ ${model} 모델을 찾을 수 없습니다. (${responseTime}ms)`);
                            console.log(`   → 다음 모델로 시도합니다.`);
                            continue;
                        }

                        console.error(`❌ OpenAI API 오류 (${model}):`, errorData.error?.message || errorData.error?.code);
                        console.error(`   응답 시간: ${responseTime}ms`);
                        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                        return res.status(500).json({
                            error: 'GPT API 호출에 실패했습니다.',
                            details: errorData.error?.message,
                            model: model
                        });
                    }

                    const data = await response.json();
                    const gptResponse = data.choices[0]?.message?.content || '';
                    const responseTime = Date.now() - requestStartTime;
                    const usage = data.usage || {};

                    const pricing = {
                        'gpt-5-nano': { input: 0.05, output: 0.40 },
                        'gpt-4o-mini': { input: 0.15, output: 0.60 },
                        'gpt-4o': { input: 2.50, output: 10.00 }
                    };

                    const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
                    const inputTokens = usage.prompt_tokens || 0;
                    const outputTokens = usage.completion_tokens || 0;
                    const totalTokens = usage.total_tokens || 0;
                    const inputCost = (inputTokens / 1000000) * modelPricing.input;
                    const outputCost = (outputTokens / 1000000) * modelPricing.output;
                    const totalCost = inputCost + outputCost;

                    console.log(`✅ ${model} 모델 사용 성공`);
                    console.log(`⏱️  응답 시간: ${responseTime}ms`);
                    console.log(`💰 토큰 사용량:`);
                    console.log(`   - 입력: ${inputTokens.toLocaleString()} 토큰`);
                    console.log(`   - 출력: ${outputTokens.toLocaleString()} 토큰`);
                    console.log(`   - 총합: ${totalTokens.toLocaleString()} 토큰`);
                    console.log(`💵 예상 비용:`);
                    console.log(`   - 입력: $${inputCost.toFixed(6)}`);
                    console.log(`   - 출력: $${outputCost.toFixed(6)}`);
                    console.log(`   - 총합: $${totalCost.toFixed(6)} (약 ${(totalCost * 1000).toFixed(3)}원)`);

                    let result;
                    try {
                        result = JSON.parse(gptResponse);
                    } catch (error) {
                        const winnerMatch = gptResponse.match(/당첨자[:\s]+(.+?)(?:\n|이유|$)/i);
                        const reasonMatch = gptResponse.match(/이유[:\s]+(.+?)(?:\n|$)/i);
                        const winners = winnerMatch ? winnerMatch[1].trim().split(',').map(w => w.trim()) : [];
                        const reason = reasonMatch ? reasonMatch[1].trim() : 'GPT가 판단한 결과';
                        result = { winners, reason };
                    }

                    let winners = [];
                    if (Array.isArray(result.winners)) {
                        winners = result.winners.map(w => {
                            if (typeof w === 'string') {
                                const match = w.match(/^([^:]+)/);
                                return match ? match[1].trim() : w.trim();
                            }
                            return w.name || w;
                        });
                    } else if (result.winner) {
                        if (typeof result.winner === 'string') {
                            const match = result.winner.match(/^([^:]+)/);
                            winners = [match ? match[1].trim() : result.winner.trim()];
                        } else {
                            winners = [result.winner.name || result.winner];
                        }
                    }

                    const reason = result.reason || result.이유 || 'GPT가 판단한 결과';

                    console.log(`🏆 당첨자: ${winners.length > 0 ? winners.join(', ') : '없음'}`);
                    console.log(`💡 이유: ${reason.substring(0, 100)}${reason.length > 100 ? '...' : ''}`);
                    console.log(`📊 응답 길이: ${gptResponse.length}자`);
                    console.log(`📄 응답 내용:`);
                    console.log(gptResponse);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

                    return res.json({
                        success: true,
                        winners: winners,
                        reason: reason,
                        rawResponse: gptResponse,
                        model: model
                    });
                } catch (error) {
                    const responseTime = Date.now() - requestStartTime;
                    console.error(`❌ ${model} 모델 호출 중 예외 발생:`, error.message);
                    console.error(`   응답 시간: ${responseTime}ms`);
                    lastError = error;
                    continue;
                }
            }

            const totalTime = Date.now() - requestStartTime;
            console.error(`❌ 모든 GPT 모델 호출 실패`);
            console.error(`   총 시도 시간: ${totalTime}ms`);
            console.error(`   마지막 오류: ${lastError?.error?.message || lastError?.message || '알 수 없는 오류'}`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            return res.status(500).json({
                error: '모든 GPT 모델 호출에 실패했습니다.',
                details: lastError?.error?.message || lastError?.message
            });

        } catch (error) {
            console.error('GPT API 호출 오류:', error);
            res.status(500).json({ error: '서버 오류가 발생했습니다.' });
        }
    });

    // ─── 태그라인 API ───
    app.get('/api/taglines', async (req, res) => {
        const pool = getPool();
        const type = req.query.type || 'tagline';
        if (!pool) return res.json(type === 'free_sub' ? ['회원가입 없이 바로 시작'] : ['오늘 커피는 누가 쏠까?']);
        try {
            const { rows } = await pool.query('SELECT text FROM taglines WHERE is_active = true AND type = $1 ORDER BY RANDOM()', [type]);
            res.json(rows.map(r => r.text));
        } catch {
            res.json(type === 'free_sub' ? ['회원가입 없이 바로 시작'] : ['오늘 커피는 누가 쏠까?']);
        }
    });
}

module.exports = { setupRoutes, getServerId };
