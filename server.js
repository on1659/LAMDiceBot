const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const geminiService = require('./gemini-utils');

// PostgreSQL 모듈 선택적 로드 (설치되어 있으면 사용)
let Pool = null;
try {
    const pg = require('pg');
    Pool = pg.Pool;
} catch (error) {
    console.log('ℹ️  pg 모듈이 설치되지 않았습니다. 파일 시스템을 사용합니다.');
    console.log('   Postgres를 사용하려면: npm install pg');
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    // WebSocket 연결 제한
    maxHttpBufferSize: 1e6, // 1MB
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// Rate Limiting 설정 - HTTP 요청 제한
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1분
    max: 100, // 1분에 최대 100 요청
    message: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.',
    standardHeaders: true,
    legacyHeaders: false,
});

// 모든 요청에 rate limiting 적용
app.use(limiter);

// JSON 파싱 미들웨어
app.use(express.json());

// 메뉴 파일 경로
const MENUS_FILE = path.join(__dirname, 'frequentMenus.json');

// 게시판 파일 경로 (Postgres 사용 시 백업용)
const BOARD_FILE = path.join(__dirname, 'suggestions.json');

// PostgreSQL 연결 설정 (DATABASE_URL이 있고 Pool이 있을 때만)
let pool = null;
if (process.env.DATABASE_URL && Pool) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
    } catch (error) {
        console.error('Postgres 연결 오류:', error);
        pool = null;
    }
}

// 데이터베이스 연결 테스트 및 테이블 생성
async function initDatabase() {
    if (!pool) {
        console.log('ℹ️  DATABASE_URL이 설정되지 않았습니다. 파일 시스템을 사용합니다.');
        return;
    }
    
    try {
        // 테이블이 없으면 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS suggestions (
                id SERIAL PRIMARY KEY,
                user_name VARCHAR(50) NOT NULL,
                title VARCHAR(100) NOT NULL,
                content TEXT NOT NULL,
                password VARCHAR(100) NOT NULL,
                date VARCHAR(10) NOT NULL,
                time VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // 인덱스 생성 (조회 성능 향상)
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_suggestions_created_at 
            ON suggestions(created_at DESC)
        `);
        
        console.log('✅ 데이터베이스 테이블 초기화 완료');
    } catch (error) {
        console.error('❌ 데이터베이스 초기화 오류:', error);
        // Postgres가 없으면 파일 시스템으로 폴백
        console.log('⚠️  Postgres 연결 실패, 파일 시스템 사용');
    }
}

// 게시판 데이터 로드 (Postgres 우선, 실패 시 파일 시스템)
async function loadSuggestions() {
    try {
        // Postgres에서 조회 시도
        if (pool) {
            const result = await pool.query(
                'SELECT id::text, user_name, title, content, date, time, created_at FROM suggestions ORDER BY created_at DESC LIMIT 100'
            );
            return result.rows.map(row => ({
                id: row.id,
                userName: row.user_name,
                title: row.title,
                content: row.content,
                date: row.date,
                time: row.time,
                createdAt: row.created_at.toISOString()
            }));
        }
    } catch (error) {
        console.error('Postgres 조회 오류, 파일 시스템으로 폴백:', error);
    }
    
    // 파일 시스템 폴백
    try {
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
            // 비밀번호는 보안상 전송하지 않음 (조회용)
            return suggestions.map(s => {
                const { password, ...rest } = s;
                return rest;
            });
        }
    } catch (error) {
        console.error('게시판 파일 읽기 오류:', error);
    }
    return [];
}

// 게시글 삭제용 조회 (비밀번호 포함)
async function loadSuggestionsWithPassword() {
    try {
        // Postgres에서 조회 시도
        if (pool) {
            const result = await pool.query(
                'SELECT id::text, password FROM suggestions WHERE id = $1',
                [arguments[0]] // 첫 번째 인자가 id
            );
            if (result.rows.length > 0) {
                return result.rows[0].password;
            }
            return null;
        }
    } catch (error) {
        console.error('Postgres 비밀번호 조회 오류, 파일 시스템으로 폴백:', error);
    }
    
    // 파일 시스템 폴백
    try {
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
            const suggestion = suggestions.find(s => s.id === arguments[0]);
            return suggestion ? suggestion.password : null;
        }
    } catch (error) {
        console.error('게시판 파일 읽기 오류:', error);
    }
    return null;
}

// 게시판 데이터 저장 (Postgres 우선, 실패 시 파일 시스템)
async function saveSuggestion(suggestion) {
    try {
        // Postgres에 저장 시도
        if (pool) {
            const result = await pool.query(
                'INSERT INTO suggestions (user_name, title, content, password, date, time) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text',
                [suggestion.userName, suggestion.title, suggestion.content, suggestion.password, suggestion.date, suggestion.time]
            );
            suggestion.id = result.rows[0].id;
            return true;
        }
    } catch (error) {
        console.error('Postgres 저장 오류, 파일 시스템으로 폴백:', error);
    }
    
    // 파일 시스템 폴백
    try {
        const suggestions = await loadSuggestions();
        suggestions.unshift(suggestion);
        if (suggestions.length > 100) {
            suggestions.splice(100);
        }
        fs.writeFileSync(BOARD_FILE, JSON.stringify(suggestions, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('게시판 파일 쓰기 오류:', error);
        return false;
    }
}

// 게시글 삭제 (Postgres 우선, 실패 시 파일 시스템)
async function deleteSuggestion(id, password) {
    try {
        // Postgres에서 삭제 시도
        if (pool) {
            // 게시글 조회
            const checkResult = await pool.query(
                'SELECT password FROM suggestions WHERE id = $1',
                [id]
            );
            
            if (checkResult.rows.length === 0) {
                return { success: false, error: '게시글을 찾을 수 없습니다.' };
            }
            
            const suggestionPassword = checkResult.rows[0].password;
            const adminPassword = process.env.ADMIN_PASSWORD || '0000';
            
            // 게시글 삭제코드 또는 관리자 비밀번호 확인
            if (password !== suggestionPassword && password !== adminPassword) {
                return { success: false, error: '삭제코드가 일치하지 않습니다.' };
            }
            
            await pool.query('DELETE FROM suggestions WHERE id = $1', [id]);
            return { success: true };
        }
    } catch (error) {
        console.error('Postgres 삭제 오류, 파일 시스템으로 폴백:', error);
    }
    
    // 파일 시스템 폴백
    try {
        // 파일에서 전체 데이터 읽기 (비밀번호 포함)
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
            const index = suggestions.findIndex(s => s.id === id);
            
            if (index === -1) {
                return { success: false, error: '게시글을 찾을 수 없습니다.' };
            }
            
            const suggestionPassword = suggestions[index].password;
            const adminPassword = process.env.ADMIN_PASSWORD || '0000';
            
            // 게시글 삭제코드 또는 관리자 비밀번호 확인
            if (password !== suggestionPassword && password !== adminPassword) {
                return { success: false, error: '삭제코드가 일치하지 않습니다.' };
            }
            
            suggestions.splice(index, 1);
            fs.writeFileSync(BOARD_FILE, JSON.stringify(suggestions, null, 2), 'utf8');
            return { success: true };
        } else {
            return { success: false, error: '게시글을 찾을 수 없습니다.' };
        }
    } catch (error) {
        console.error('게시판 파일 삭제 오류:', error);
        return { success: false, error: '게시글 삭제 중 오류가 발생했습니다.' };
    }
}

// 자주 쓰는 메뉴 목록 로드
function loadFrequentMenus() {
    try {
        if (fs.existsSync(MENUS_FILE)) {
            const data = fs.readFileSync(MENUS_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('메뉴 파일 읽기 오류:', error);
    }
    // 기본 메뉴 목록
    return ['오초', '오고', '하늘보리', '트레비', '핫식스', '500', '콘', '오쿠', '헛개', '제콜', '펩제', '제사', '비타병', '아제'];
}

// 자주 쓰는 메뉴 목록 저장
function saveFrequentMenus(menus) {
    try {
        fs.writeFileSync(MENUS_FILE, JSON.stringify(menus, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('메뉴 파일 쓰기 오류:', error);
        return false;
    }
}

// 방 관리 시스템
const rooms = {}; // { roomId: { hostId, hostName, roomName, gameState, ... } }

// 오늘의 주사위 기록 저장소 (방이 삭제되어도 유지)
const todayDiceRecords = []; // { user, result, date, isGameActive, time, range, ... }

// 방 ID 생성
function generateRoomId() {
    return crypto.randomBytes(4).toString('hex');
}

// 방의 기본 게임 상태 생성
function createRoomGameState() {
    return {
        users: [],
        isGameActive: false,
        isOrderActive: false, // 주문받기 활성화 여부
        diceMax: 100,
        history: [],
        rolledUsers: [], // 이번 게임에서 주사위를 굴린 사용자 목록
        gamePlayers: [], // 게임 시작 시 참여자 목록 (게임 중 입장한 사람 제외)
        everPlayedUsers: [], // 방에 입장한 후 한번이라도 게임에 참여한 사람 목록 (누적)
        readyUsers: [], // 준비한 사용자 목록 (게임 시작 전 준비한 사람들)
        userDiceSettings: {}, // 사용자별 주사위 설정 {userName: {max}} (최소값은 항상 1)
        userOrders: {}, // 사용자별 주문 내역 {userName: "주문 내용"}
        gameRules: '', // 게임 룰 (호스트만 설정, 게임 시작 후 수정 불가)
        frequentMenus: loadFrequentMenus(), // 자주 쓰는 메뉴 목록
        allPlayersRolledMessageSent: false, // 모든 참여자가 주사위를 굴렸다는 메시지 전송 여부
        chatHistory: [], // 채팅 기록 (최대 100개)
        // 룰렛 게임 관련
        rouletteHistory: [], // 룰렛 게임 기록
        isRouletteSpinning: false, // 룰렛 회전 중 여부
        userColors: {} // 사용자별 선택한 색상 {userName: colorIndex}
    };
}

// 게임 상태 (하위 호환성을 위해 유지, 실제로는 각 방의 gameState 사용)
let gameState = createRoomGameState();

// 정적 파일 제공 (캐시 방지 설정)
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        // HTML 파일은 캐시하지 않음
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

app.get('/', (req, res) => {
    // 캐시 방지 헤더 설정
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'dice-game-multiplayer.html'));
});

// 룰렛 게임 페이지 라우트
app.get('/roulette', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'roulette-game-multiplayer.html'));
});

// GPT API를 통한 커스텀 룰 당첨자 판단
app.post('/api/calculate-custom-winner', async (req, res) => {
    try {
        const { gameRules, gameHistory } = req.body;
        
        if (!gameRules || !gameHistory || !Array.isArray(gameHistory) || gameHistory.length === 0) {
            return res.status(400).json({ error: '게임 룰과 기록이 필요합니다.' });
        }
        
        // OpenAI API 키 확인
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (!openaiApiKey) {
            return res.status(500).json({ error: 'OpenAI API 키가 설정되지 않았습니다.' });
        }
        
        // 게임 기록을 최소 형식으로 변환 (토큰 절약)
        const historyText = gameHistory.map(r => `${r.user}:${r.result}`).join(',');
        
        // GPT 프롬프트 작성 (극한 최적화 - 최소 토큰)
        const prompt = `룰:"${gameRules}" 결과:${historyText} 적용 JSON:{"winners":[],"reason":""}`;

        // 로그: 요청 시작
        const requestStartTime = Date.now();
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🤖 GPT API 요청 시작');
        console.log(`📋 게임 룰: "${gameRules}"`);
        console.log(`🎲 주사위 결과: ${gameHistory.map(r => `${r.user}(${r.result})`).join(', ')}`);
        console.log(`👥 참여자 수: ${gameHistory.length}명`);
        console.log(`📝 프롬프트 길이: ${prompt.length}자`);
        console.log(`📄 입력 프롬프트:`);
        console.log(prompt);

        // 모델 우선순위: gpt-5-nano 시도, 실패 시 gpt-4o-mini로 폴백
        // 참고: gpt-5-nano가 정확한 모델명 (gpt-5.1-nano는 존재하지 않음)
        const models = ['gpt-5-nano', 'gpt-4o-mini'];
        let lastError = null;
        
        for (const model of models) {
            try {
                console.log(`\n🔄 ${model} 모델 시도 중...`);
                
                // OpenAI API 호출
                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${openaiApiKey}`
                    },
                    body: JSON.stringify({
                        model: model,
                        messages: [
                            {
                                role: 'user',
                                content: prompt
                            }
                        ],
                        temperature: 0,
                        max_tokens: 50,
                        response_format: { type: "json_object" }
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    lastError = errorData;
                    const responseTime = Date.now() - requestStartTime;
                    
                    // 모델을 찾을 수 없는 경우 다음 모델로 시도
                    if (errorData.error?.code === 'model_not_found' || 
                        errorData.error?.message?.includes('model') ||
                        errorData.error?.message?.includes('not found')) {
                        console.log(`❌ ${model} 모델을 찾을 수 없습니다. (${responseTime}ms)`);
                        console.log(`   → 다음 모델로 시도합니다.`);
                        continue; // 다음 모델로 시도
                    }
                    
                    // 다른 오류인 경우 즉시 반환
                    console.error(`❌ OpenAI API 오류 (${model}):`, errorData.error?.message || errorData.error?.code);
                    console.error(`   응답 시간: ${responseTime}ms`);
                    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                    
                    return res.status(500).json({ 
                        error: 'GPT API 호출에 실패했습니다.', 
                        details: errorData.error?.message,
                        model: model
                    });
                }
                
                // 성공한 경우
                const data = await response.json();
                const gptResponse = data.choices[0]?.message?.content || '';
                const responseTime = Date.now() - requestStartTime;
                const usage = data.usage || {};
                
                // 모델별 가격 (1M 토큰당)
                const pricing = {
                    'gpt-5-nano': { input: 0.05, output: 0.40 },
                    'gpt-4o-mini': { input: 0.15, output: 0.60 },
                    'gpt-4o': { input: 2.50, output: 10.00 }
                };
                
                const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
                const inputTokens = usage.prompt_tokens || 0;
                const outputTokens = usage.completion_tokens || 0;
                const totalTokens = usage.total_tokens || 0;
                
                // 비용 계산 (달러)
                const inputCost = (inputTokens / 1000000) * modelPricing.input;
                const outputCost = (outputTokens / 1000000) * modelPricing.output;
                const totalCost = inputCost + outputCost;
                
                // 로그: 성공 정보
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
                
                // JSON 응답 파싱
                let result;
                try {
                    result = JSON.parse(gptResponse);
                } catch (error) {
                    // JSON 파싱 실패 시 텍스트 파싱 시도 (폴백)
                    const winnerMatch = gptResponse.match(/당첨자[:\s]+(.+?)(?:\n|이유|$)/i);
                    const reasonMatch = gptResponse.match(/이유[:\s]+(.+?)(?:\n|$)/i);
                    
                    const winners = winnerMatch ? winnerMatch[1].trim().split(',').map(w => w.trim()) : [];
                    const reason = reasonMatch ? reasonMatch[1].trim() : 'GPT가 판단한 결과';
                    
                    result = { winners, reason };
                }
                
                // winners 배열 정리 (이름만 추출)
                let winners = [];
                if (Array.isArray(result.winners)) {
                    // "이름:숫자" 형식인 경우 이름만 추출
                    winners = result.winners.map(w => {
                        if (typeof w === 'string') {
                            // "요더:42" 형식이면 "요더"만 추출
                            const match = w.match(/^([^:]+)/);
                            return match ? match[1].trim() : w.trim();
                        }
                        // 객체인 경우 name 필드 사용
                        return w.name || w;
                    });
                } else if (result.winner) {
                    // 단일 당첨자
                    if (typeof result.winner === 'string') {
                        const match = result.winner.match(/^([^:]+)/);
                        winners = [match ? match[1].trim() : result.winner.trim()];
                    } else {
                        winners = [result.winner.name || result.winner];
                    }
                }
                
                const reason = result.reason || result.이유 || 'GPT가 판단한 결과';
                
                // 로그: 결과 정보
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
                continue; // 다음 모델로 시도
            }
        }
        
        // 모든 모델 실패
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

// 시드 기반 랜덤 생성 함수
function seededRandom(seed, min, max) {
    // 시드를 해시화하여 난수 생성
    const hash = crypto.createHash('sha256').update(seed).digest();
    
    // 해시의 첫 8바이트를 숫자로 변환
    const num = hash.readBigUInt64BE(0);
    
    // 범위 내의 값으로 변환
    const range = BigInt(max - min + 1);
    const result = Number(num % range) + min;
    
    return result;
}

// WebSocket 연결
io.on('connection', (socket) => {
    console.log('새 사용자 연결:', socket.id);
    
    // IP 주소 추출 함수 (개선)
    const getClientIP = (socket) => {
        // 프록시/로드밸런서를 통한 경우
        const forwarded = socket.handshake.headers['x-forwarded-for'];
        if (forwarded) {
            const ip = forwarded.split(',')[0].trim();
            // IPv6를 IPv4로 변환하거나 그대로 반환
            if (ip && ip !== '') {
                return ip.replace(/^::ffff:/, ''); // IPv6-mapped IPv4 주소 처리
            }
        }
        // 직접 연결인 경우
        let address = socket.handshake.address || 
                     socket.request?.connection?.remoteAddress || 
                     socket.request?.socket?.remoteAddress ||
                     socket.conn?.remoteAddress ||
                     'unknown';
        
        // IPv6-mapped IPv4 주소 처리
        if (address && address.startsWith('::ffff:')) {
            address = address.replace('::ffff:', '');
        }
        
        // IPv6 주소를 IPv4로 변환 시도 (로컬 테스트 환경)
        if (address === '::1' || address === '::ffff:127.0.0.1') {
            address = '127.0.0.1';
        }
        
        return address || 'unknown';
    };
    
    // 소켓 연결 시 IP 주소 저장
    socket.clientIP = getClientIP(socket);
    console.log(`소켓 연결 IP: ${socket.clientIP} (socket.id: ${socket.id})`);
    
    // 소켓별 정보 저장
    socket.currentRoomId = null; // 현재 방 ID
    socket.userName = null; // 사용자 이름
    socket.isHost = false; // 호스트 여부
    socket.deviceId = null; // 기기 식별 ID

    // 각 소켓별 요청 횟수 제한
    let requestCount = 0;
    let requestResetTime = Date.now();
    
    const checkRateLimit = () => {
        const now = Date.now();
        // 10초마다 리셋
        if (now - requestResetTime > 10000) {
            requestCount = 0;
            requestResetTime = now;
        }
        
        requestCount++;
        
        // 10초에 50번 이상 요청하면 차단
        if (requestCount > 50) {
            socket.emit('rateLimitError', '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.');
            return false;
        }
        return true;
    };
    
    // 현재 방의 게임 상태 가져오기
    const getCurrentRoomGameState = () => {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return null;
        }
        return rooms[socket.currentRoomId].gameState;
    };
    
    // 현재 방 가져오기
    const getCurrentRoom = () => {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return null;
        }
        return rooms[socket.currentRoomId];
    };

    // 주사위 결과를 1~100 범위로 정규화하는 함수
    const normalizeTo100 = (result, rangeStr) => {
        if (!rangeStr || typeof rangeStr !== 'string') {
            // range 정보가 없으면 그대로 반환 (하위 호환성)
            return result;
        }
        
        // range 파싱 (예: "1~50", "10~20" 등)
        const rangeMatch = rangeStr.match(/(\d+)~(\d+)/);
        if (!rangeMatch) {
            return result;
        }
        
        const min = parseInt(rangeMatch[1]);
        const max = parseInt(rangeMatch[2]);
        
        if (isNaN(min) || isNaN(max) || min >= max) {
            return result;
        }
        
        // 1~100 범위로 정규화: ((result - min) / (max - min)) * 99 + 1
        const normalized = ((result - min) / (max - min)) * 99 + 1;
        return normalized;
    };

    // 오늘의 주사위 통계 계산 (공식전만 포함)
    const getTodayDiceStats = () => {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD 형식
        let totalCount = 0;
        let totalNormalizedSum = 0; // 정규화된 값의 합
        
        // 1. 전역 저장소의 기록 확인 (방이 삭제되어도 유지되는 기록)
        const globalRecords = todayDiceRecords.filter(record => {
            return record.date === today && record.isGameActive === true;
        });
        
        totalCount += globalRecords.length;
        globalRecords.forEach(record => {
            if (typeof record.result === 'number') {
                const normalized = normalizeTo100(record.result, record.range);
                totalNormalizedSum += normalized;
            }
        });
        
        // 2. 현재 존재하는 모든 방의 게임 기록을 순회
        Object.values(rooms).forEach(room => {
            const gameState = room.gameState;
            if (gameState && gameState.history) {
                // 오늘 날짜의 기록 중 공식전(게임 진행 중)만 필터링
                const todayRecords = gameState.history.filter(record => {
                    // date 필드가 있고, 게임 진행 중일 때 굴린 주사위만 포함
                    return record.date === today && record.isGameActive === true;
                });
                
                totalCount += todayRecords.length;
                todayRecords.forEach(record => {
                    if (typeof record.result === 'number') {
                        const normalized = normalizeTo100(record.result, record.range);
                        totalNormalizedSum += normalized;
                    }
                });
            }
        });
        
        const average = totalCount > 0 ? (totalNormalizedSum / totalCount).toFixed(2) : 0;
        
        return {
            count: totalCount,
            average: parseFloat(average)
        };
    };
///////////////
    // 방 목록 조회
    socket.on('getRooms', () => {
        if (!checkRateLimit()) return;
        
        const roomsList = Object.entries(rooms).map(([roomId, room]) => ({
            roomId,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.gameState.users.length,
            isGameActive: room.gameState.isGameActive,
            isOrderActive: room.gameState.isOrderActive,
            isPrivate: room.isPrivate || false,
            gameType: room.gameType || 'dice', // 게임 타입 추가 (기본값: dice)
            createdAt: room.createdAt, // 방 생성 시간 추가
            expiryHours: room.expiryHours || 1 // 방 유지 시간 추가 (기본값: 1시간)
            // 비밀번호는 보안상 목록에 포함하지 않음
        }));
        
        socket.emit('roomsList', roomsList);
    });

    // 오늘의 주사위 통계 조회
    socket.on('getTodayDiceStats', () => {
        if (!checkRateLimit()) return;
        
        const stats = getTodayDiceStats();
        socket.emit('todayDiceStats', stats);
    });

    // 현재 방 정보 조회 (리다이렉트 후 방 정보 복구용)
    socket.on('getCurrentRoom', async (data) => {
        if (!checkRateLimit()) return;
        
        const { roomId, userName, deviceId } = data || {};
        
        if (!roomId || !userName) {
            socket.emit('currentRoomInfo', null);
            return;
        }
        
        if (!rooms[roomId]) {
            socket.emit('currentRoomInfo', null);
            return;
        }
        
        const room = rooms[roomId];
        const gameState = room.gameState;
        
        // 같은 이름의 사용자 찾기 (리다이렉트로 인한 재연결인 경우)
        const user = gameState.users.find(u => u.name === userName);
        
        if (!user) {
            socket.emit('currentRoomInfo', null);
            return;
        }
        
        // IP 차단 옵션이 활성화된 경우, 같은 IP에서 이미 다른 사용자로 입장한 경우가 있는지 확인
        if (room.blockIPPerUser) {
            socket.deviceId = deviceId || null;
            
            // 모든 소켓을 확인하여 같은 IP/deviceId를 가진 다른 사용자 찾기
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외
                if (s.userName === userName) return false; // 같은 이름은 재연결로 간주
                
                // IP가 같은 경우
                if (s.clientIP === socket.clientIP) {
                    // deviceId가 있으면 deviceId도 확인
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    // deviceId가 없으면 IP만 확인
                    return true;
                }
                return false;
            });
            
            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';
                
                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('currentRoomInfo', null);
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            socket.deviceId = deviceId || null;
        }
        
        // 기존 사용자의 socket.id를 새 소켓으로 업데이트
        user.id = socket.id;
        socket.currentRoomId = roomId;
        socket.userName = userName;
        socket.isHost = user.isHost;
        
        // 호스트 ID도 업데이트
        if (user.isHost) {
            room.hostId = socket.id;
        }
        
        socket.join(roomId);
        
        const hasRolled = gameState.rolledUsers.includes(user.name);
        const myResult = gameState.history.find(r => r.user === user.name);
        
        socket.emit('currentRoomInfo', {
            roomId: room.roomId,
            roomName: room.roomName,
            userName: user.name,
            isHost: user.isHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(user.name),
            readyUsers: gameState.readyUsers,
            isReady: gameState.readyUsers.includes(user.name),
            isPrivate: room.isPrivate,
            password: room.isPrivate ? room.password : '',
            gameType: room.gameType || 'dice',
            diceSettings: gameState.userDiceSettings[user.name],
            myOrder: gameState.userOrders[user.name] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus,
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            gameState: {
                ...gameState,
                hasRolled: () => gameState.rolledUsers.includes(user.name),
                myResult: myResult,
                frequentMenus: gameState.frequentMenus
            }
        });
        
        // 사용자 목록 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
    });

    // 방 생성
    socket.on('createRoom', async (data) => {
        if (!checkRateLimit()) return;
        
        const { userName, roomName, isPrivate, password, gameType, expiryHours, blockIPPerUser } = data;
        
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('roomError', '올바른 호스트 이름을 입력해주세요!');
            return;
        }
        
        if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
            socket.emit('roomError', '올바른 방 제목을 입력해주세요!');
            return;
        }
        
        // 비공개 방 설정 확인
        const isPrivateRoom = isPrivate === true;
        let roomPassword = '';
        
        if (isPrivateRoom) {
            if (!password || typeof password !== 'string' || password.trim().length === 0) {
                socket.emit('roomError', '비공개 방은 비밀번호를 입력해주세요!');
                return;
            }
            
            if (password.trim().length < 4 || password.trim().length > 20) {
                socket.emit('roomError', '비밀번호는 4자 이상 20자 이하여야 합니다!');
                return;
            }
            
            roomPassword = password.trim();
        }
        
        // 게임 타입 검증 (dice, roulette, team 허용, 기본값은 'dice')
        const validGameType = ['dice', 'roulette', 'team'].includes(gameType) ? gameType : 'dice';
        
        // 방 유지 시간 검증 (1, 3, 6시간만 허용, 기본값: 1시간)
        const validExpiryHours = [1, 3, 6].includes(expiryHours) ? expiryHours : 1;
        
        // IP 차단 옵션 검증 (기본값: false)
        const validBlockIPPerUser = blockIPPerUser === true;
        
        // IP 차단 옵션이 활성화된 경우, 같은 IP에서 이미 다른 방에 입장한 사용자가 있는지 확인
        if (validBlockIPPerUser) {
            const { deviceId } = data;
            socket.deviceId = deviceId || null;
            
            // 모든 방을 순회하며 같은 IP/deviceId를 가진 사용자 찾기
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외
                
                // IP가 같은 경우
                if (s.clientIP === socket.clientIP) {
                    // deviceId가 있으면 deviceId도 확인
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    // deviceId가 없으면 IP만 확인
                    return true;
                }
                return false;
            });
            
            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';
                
                console.log(`[IP 체크] 방 생성 차단: IP=${socket.clientIP}, deviceId=${deviceId || '없음'}, 기존 사용자=${existingUserName}, 기존 방=${existingRoomId}`);
                
                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            // IP 차단 옵션이 비활성화되어 있어도 deviceId는 저장
            const { deviceId } = data;
            socket.deviceId = deviceId || null;
        }
        
        // 이미 방에 있으면 나가기
        if (socket.currentRoomId) {
            await leaveRoom(socket);
        }
        
        const roomId = generateRoomId();
        const finalRoomName = roomName.trim();
        
        rooms[roomId] = {
            roomId,
            hostId: socket.id,
            hostName: userName.trim(),
            roomName: finalRoomName,
            isPrivate: isPrivateRoom,
            password: roomPassword,
            gameType: validGameType, // 게임 타입 추가
            expiryHours: validExpiryHours, // 방 유지 시간 추가 (시간 단위)
            blockIPPerUser: validBlockIPPerUser, // IP당 하나의 아이디만 입장 허용 옵션
            gameState: createRoomGameState(),
            createdAt: new Date()
        };
        
        // 방 입장
        socket.currentRoomId = roomId;
        socket.userName = userName.trim();
        socket.isHost = true;
        
        const room = rooms[roomId];
        const gameState = room.gameState;
        
        const user = {
            id: socket.id,
            name: userName.trim(),
            isHost: true,
            joinTime: new Date()
        };
        
        gameState.users.push(user);
        
        // 기본 주사위 설정 (방 생성 후 설정 가능)
        gameState.userDiceSettings[userName.trim()] = { max: 100 };
        
        // 게임 룰은 빈 상태로 시작 (방 생성 후 설정 가능)
        gameState.gameRules = '';
        
        gameState.userOrders[userName.trim()] = '';
        
        // 방 생성 시 호스트도 자동으로 준비 상태 추가
        const trimmedUserName = userName.trim();
        // readyUsers 배열이 없으면 초기화
        if (!gameState.readyUsers) {
            gameState.readyUsers = [];
        }
        if (!gameState.isGameActive && !gameState.readyUsers.includes(trimmedUserName)) {
            gameState.readyUsers.push(trimmedUserName);
            console.log(`방 생성: 호스트 ${trimmedUserName}을(를) 준비 상태로 추가. 현재 준비 인원:`, gameState.readyUsers);
        }
        
        // 디버깅: readyUsers 확인
        console.log(`방 생성 완료 - readyUsers:`, gameState.readyUsers, `호스트: ${trimmedUserName}`);
        
        socket.join(roomId);
        
        // 방 생성 성공 알림
        socket.emit('roomCreated', {
            roomId,
            roomName: finalRoomName,
            userName: trimmedUserName, // 호스트 이름 추가
            readyUsers: gameState.readyUsers || [], // 준비 목록 전송
            isReady: gameState.readyUsers.includes(trimmedUserName), // 호스트가 준비 목록에 있는지 확인
            isPrivate: isPrivateRoom,
            password: isPrivateRoom ? roomPassword : '', // 비공개 방일 때만 비밀번호 전달
            gameType: validGameType, // 게임 타입 전달
            createdAt: room.createdAt, // 방 생성 시간 추가
            expiryHours: validExpiryHours, // 방 유지 시간 추가
            blockIPPerUser: validBlockIPPerUser, // IP 차단 옵션 추가
            gameRules: gameState.gameRules, // 게임 룰 추가
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            userColors: gameState.userColors || {}, // 사용자 색상 정보
            gameState: {
                ...gameState,
                hasRolled: () => false,
                myResult: null,
                frequentMenus: gameState.frequentMenus
            }
        });
        
        console.log(`방 생성: ${finalRoomName} (${roomId}) by ${userName.trim()}`);
        
        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        // 모든 클라이언트에게 방 목록 업데이트
        updateRoomsList();
    });

    // 방 입장
    socket.on('joinRoom', async (data) => {
        if (!checkRateLimit()) return;
        
        const { roomId, userName, isHost, password, deviceId } = data;
        
        if (!roomId || !userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('roomError', '올바른 정보를 입력해주세요!');
            return;
        }
        
        if (!rooms[roomId]) {
            socket.emit('roomError', '존재하지 않는 방입니다!');
            return;
        }
        
        const room = rooms[roomId];
        const gameState = room.gameState;
        
        // 비공개 방 비밀번호 확인
        if (room.isPrivate) {
            const providedPassword = password || '';
            if (providedPassword !== room.password) {
                socket.emit('roomError', '비밀번호가 일치하지 않습니다!');
                return;
            }
        }
        
        // 최대 접속자 수 제한
        const MAX_USERS = 50;
        if (gameState.users.length >= MAX_USERS) {
            socket.emit('roomError', '방이 가득 찼습니다!');
            return;
        }
        
        // 호스트 중복 체크 및 빈 방 처리
        const requestIsHost = isHost || false;
        
        // 방에 사용자가 없으면 첫 입장자를 자동으로 방장으로 설정
        const isEmptyRoom = gameState.users.length === 0;
        const finalIsHost = isEmptyRoom ? true : requestIsHost;
        
        if (finalIsHost && gameState.users.some(user => user.isHost === true)) {
            socket.emit('roomError', '이미 호스트가 있습니다! 일반 사용자로 입장해주세요.');
            return;
        }
        
        // 기존 방에서 나가기
        if (socket.currentRoomId) {
            await leaveRoom(socket);
        }
        
        // 같은 이름의 사용자가 이미 있는지 확인
        const existingUser = gameState.users.find(u => u.name === userName.trim());
        
        // 중복 이름 체크 (재연결이 아닌 경우)
        if (existingUser) {
            // 방의 모든 socket 확인
            const socketsInRoom = await io.in(roomId).fetchSockets();
            
            // 같은 이름을 가진 사용자가 이미 연결되어 있는지 확인
            // socket.userName 또는 socket.id로 확인
            const connectedUserWithSameName = socketsInRoom.find(s => 
                (s.userName === userName.trim() || s.id === existingUser.id) && s.connected
            );
            
            // 기존 사용자의 소켓이 아직 연결되어 있으면 중복 이름으로 거부
            if (connectedUserWithSameName) {
                socket.emit('roomError', '이미 사용 중인 이름입니다!');
                return;
            }
            
            // 기존 사용자의 소켓이 연결되지 않았으면 재연결로 간주
            existingUser.id = socket.id;
            const user = existingUser;
            console.log(`사용자 ${userName.trim()}이(가) 방 ${roomId}에 재연결했습니다.`);
            
            // 새 방 입장
            socket.currentRoomId = roomId;
            socket.userName = userName.trim();
            socket.isHost = user.isHost;
            
            // 호스트 ID도 업데이트
            if (user.isHost) {
                room.hostId = socket.id;
            }
            
            socket.join(roomId);
            
            // 재접속 시 이미 굴렸는지 확인
            const hasRolled = gameState.rolledUsers.includes(userName.trim());
            const myResult = gameState.history.find(r => r.user === userName.trim());
            
            // 입장 성공 응답
            socket.emit('roomJoined', {
                roomId,
                roomName: room.roomName,
                userName: userName.trim(),
                isHost: user.isHost,
                hasRolled: hasRolled,
                myResult: myResult,
                isGameActive: gameState.isGameActive,
                isOrderActive: gameState.isOrderActive,
                isGamePlayer: gameState.gamePlayers.includes(userName.trim()),
                readyUsers: gameState.readyUsers,
                isReady: gameState.readyUsers.includes(userName.trim()),
                isPrivate: room.isPrivate,
                password: room.isPrivate ? room.password : '',
                gameType: room.gameType || 'dice',
                createdAt: room.createdAt, // 방 생성 시간 추가
                expiryHours: room.expiryHours || 1, // 방 유지 시간 추가
                blockIPPerUser: room.blockIPPerUser || false, // IP 차단 옵션 추가
                diceSettings: gameState.userDiceSettings[userName.trim()],
                myOrder: gameState.userOrders[userName.trim()] || '',
                gameRules: gameState.gameRules,
                frequentMenus: gameState.frequentMenus,
                chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
                everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
                userColors: gameState.userColors || {}, // 사용자 색상 정보
                gameState: {
                    ...gameState,
                    hasRolled: () => gameState.rolledUsers.includes(userName.trim()),
                    myResult: myResult,
                    frequentMenus: gameState.frequentMenus
                }
            });
            
            // 같은 방의 다른 사용자들에게 업데이트
            io.to(roomId).emit('updateUsers', gameState.users);
            io.to(roomId).emit('updateOrders', gameState.userOrders);
            io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
            
            console.log(`${userName.trim()}이(가) 방 ${room.roomName} (${roomId})에 재연결`);
            return;
        }
        
        // 새 사용자 추가 전 중복 이름 체크 (실제 연결된 socket 확인)
        const socketsInRoom = await io.in(roomId).fetchSockets();
        const alreadyConnectedWithSameName = socketsInRoom.find(s => 
            s.userName === userName.trim() && s.connected
        );
        
        if (alreadyConnectedWithSameName) {
            socket.emit('roomError', '이미 사용 중인 이름입니다!');
            return;
        }
        
        // IP 차단 옵션이 활성화된 경우에만 같은 IP에서 이미 입장한 사용자가 있는지 확인
        if (room.blockIPPerUser) {
            // deviceId 저장
            socket.deviceId = deviceId || null;
            
            // 모든 소켓을 확인하여 같은 IP/deviceId를 가진 사용자 찾기 (같은 방뿐만 아니라 모든 방)
            const allSockets = await io.fetchSockets();
            const sameIPOrDeviceSockets = allSockets.filter(s => {
                if (s.id === socket.id) return false; // 자기 자신 제외
                if (!s.connected) return false; // 연결되지 않은 소켓 제외
                
                // IP가 같은 경우
                if (s.clientIP === socket.clientIP) {
                    // deviceId가 있으면 deviceId도 확인
                    if (deviceId && s.deviceId) {
                        return s.deviceId === deviceId;
                    }
                    // deviceId가 없으면 IP만 확인
                    return true;
                }
                return false;
            });
            
            if (sameIPOrDeviceSockets.length > 0) {
                const existingSocket = sameIPOrDeviceSockets[0];
                const existingRoomId = existingSocket.currentRoomId;
                const existingUserName = existingSocket.userName || '알 수 없음';
                
                console.log(`[IP 체크] 방 입장 차단: IP=${socket.clientIP}, deviceId=${deviceId || '없음'}, 기존 사용자=${existingUserName}, 기존 방=${existingRoomId}, 입장하려는 방=${roomId}`);
                
                // 같은 방에 있는 경우
                if (existingRoomId === roomId) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 지금 당신은 "${existingUserName}" 아이디로 로그인되어 있습니다.`);
                    return;
                }
                
                // 다른 방에 있는 경우
                if (existingRoomId && rooms[existingRoomId]) {
                    socket.emit('roomError', `IP당 하나의 아이디만 입장 허용됩니다. 현재 "${existingUserName}" 아이디로 "${rooms[existingRoomId].roomName}" 방에 입장되어 있습니다.`);
                    return;
                }
            }
        } else {
            // IP 차단 옵션이 비활성화되어 있어도 deviceId는 저장
            socket.deviceId = deviceId || null;
        }
        
        // 새 사용자 추가
        const user = {
            id: socket.id,
            name: userName.trim(),
            isHost: finalIsHost,
            joinTime: new Date()
        };
        gameState.users.push(user);
        
        // 새 방 입장
        socket.currentRoomId = roomId;
        socket.userName = userName.trim();
        socket.isHost = user.isHost;
        
        // 호스트 ID와 이름 업데이트
        if (user.isHost) {
            room.hostId = socket.id;
            room.hostName = userName.trim();
        }
        
        if (!gameState.userDiceSettings[userName.trim()]) {
            gameState.userDiceSettings[userName.trim()] = { max: 100 };
        }
        
        if (!gameState.userOrders[userName.trim()]) {
            gameState.userOrders[userName.trim()] = '';
        }
        
        // 방 입장 시 자동으로 준비 상태 추가 (게임 진행 중이 아닐 때만)
        if (!gameState.isGameActive && !gameState.readyUsers.includes(userName.trim())) {
            gameState.readyUsers.push(userName.trim());
        }
        
        socket.join(roomId);
        
        // 재접속 시 이미 굴렸는지 확인
        const hasRolled = gameState.rolledUsers.includes(userName.trim());
        const myResult = gameState.history.find(r => r.user === userName.trim());
        
        // 입장 성공 응답
            socket.emit('roomJoined', {
                roomId,
                roomName: room.roomName,
                userName: userName.trim(),
                isHost: finalIsHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(userName.trim()),
            readyUsers: gameState.readyUsers,
            isReady: true, // 방 입장 시 자동으로 준비 상태
            isPrivate: room.isPrivate,
            password: room.isPrivate ? room.password : '', // 비공개 방일 때만 비밀번호 전달
            gameType: room.gameType || 'dice', // 게임 타입 전달
            createdAt: room.createdAt, // 방 생성 시간 추가
            expiryHours: room.expiryHours || 3, // 방 유지 시간 추가
            blockIPPerUser: room.blockIPPerUser || false, // IP 차단 옵션 추가
            diceSettings: gameState.userDiceSettings[userName.trim()],
            myOrder: gameState.userOrders[userName.trim()] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus,
            chatHistory: gameState.chatHistory || [], // 채팅 기록 전송
            everPlayedUsers: gameState.everPlayedUsers || [], // 누적 참여자 목록
            userColors: gameState.userColors || {}, // 사용자 색상 정보
            gameState: {
                ...gameState,
                hasRolled: () => gameState.rolledUsers.includes(userName.trim()),
                myResult: myResult,
                frequentMenus: gameState.frequentMenus
            }
        });
        
        // 같은 방의 다른 사용자들에게 업데이트
        io.to(roomId).emit('updateUsers', gameState.users);
        io.to(roomId).emit('updateOrders', gameState.userOrders);
        io.to(roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        console.log(`${userName}이(가) 방 ${room.roomName} (${roomId})에 입장 (자동 준비)`);
    });

    // 방 나가기
    async function leaveRoom(socket) {
        if (!socket.currentRoomId || !rooms[socket.currentRoomId]) {
            return;
        }
        
        const roomId = socket.currentRoomId;
        const room = rooms[roomId];
        const gameState = room.gameState;
        
        // 사용자 목록에서 제거
        gameState.users = gameState.users.filter(u => u.id !== socket.id);
        
        // 추가 리스트 정리 (준비 중인 사용자, 게임 참여 중인 사용자)
        if (socket.userName) {
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== socket.userName);
            gameState.gamePlayers = gameState.gamePlayers.filter(name => name !== socket.userName);
        }

        // 호스트가 나가는 경우
        if (socket.isHost) {
            // 남은 사용자가 있으면 새 호스트 지정
            if (gameState.users.length > 0) {
                // 첫 번째 사용자를 새 호스트로 지정
                const newHost = gameState.users[0];
                newHost.isHost = true;
                
                // 새 호스트의 소켓 찾기 및 설정
                const socketsInRoom = await io.in(roomId).fetchSockets();
                const newHostSocket = socketsInRoom.find(s => s.id === newHost.id);
                if (newHostSocket) {
                    newHostSocket.isHost = true;
                    room.hostId = newHost.id;
                    room.hostName = newHost.name;
                    
                    // 새 호스트에게 호스트 권한 알림
                    newHostSocket.emit('hostTransferred', { 
                        message: '호스트 권한이 전달되었습니다.',
                        roomName: room.roomName
                    });
                }
                
                // 모든 사용자에게 업데이트 전송
                io.to(roomId).emit('updateUsers', gameState.users);
                io.to(roomId).emit('hostChanged', {
                    newHostId: newHost.id,
                    newHostName: newHost.name,
                    message: `${socket.userName} 호스트가 나갔습니다. ${newHost.name}님이 새 호스트가 되었습니다.`
                });
                
                // 방 목록 업데이트
                updateRoomsList();
                
                console.log(`호스트 변경: ${room.roomName} (${roomId}) - 새 호스트: ${newHost.name} (${newHost.id})`);
            } else {
                // 남은 사용자가 없으면 방 삭제
                // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                const today = new Date().toISOString().split('T')[0];
                if (gameState && gameState.history) {
                    const todayGameRecords = gameState.history.filter(record => {
                        return record.date === today && record.isGameActive === true;
                    });
                    todayGameRecords.forEach(record => {
                        // 중복 체크 (이미 저장된 기록인지 확인)
                        const alreadyExists = todayDiceRecords.some(r => 
                            r.user === record.user && 
                            r.result === record.result && 
                            r.time === record.time &&
                            r.date === record.date
                        );
                        if (!alreadyExists) {
                            todayDiceRecords.push(record);
                        }
                    });
                }
                
                io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
                
                // 모든 사용자 연결 해제
                const socketsInRoom = await io.in(roomId).fetchSockets();
                socketsInRoom.forEach(s => {
                    s.currentRoomId = null;
                    s.userName = null;
                    s.isHost = false;
                });
                
                // 방 삭제
                delete rooms[roomId];
                
                // 방 목록 업데이트
                updateRoomsList();
                
                console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
            }
        } else {
            // 일반 사용자는 목록에서만 제거
            // 같은 방의 다른 사용자들에게 업데이트
            io.to(roomId).emit('updateUsers', gameState.users);
            
            console.log(`${socket.userName}이(가) 방 ${room.roomName} (${roomId})에서 나감`);
            
            // 남은 사용자가 없으면 방 삭제
            if (gameState.users.length === 0) {
                // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                const today = new Date().toISOString().split('T')[0];
                if (gameState && gameState.history) {
                    const todayGameRecords = gameState.history.filter(record => {
                        return record.date === today && record.isGameActive === true;
                    });
                    todayGameRecords.forEach(record => {
                        // 중복 체크 (이미 저장된 기록인지 확인)
                        const alreadyExists = todayDiceRecords.some(r => 
                            r.user === record.user && 
                            r.result === record.result && 
                            r.time === record.time &&
                            r.date === record.date
                        );
                        if (!alreadyExists) {
                            todayDiceRecords.push(record);
                        }
                    });
                }
                
                // 호스트 소켓 찾기
                const socketsInRoom = await io.in(roomId).fetchSockets();
                socketsInRoom.forEach(s => {
                    s.currentRoomId = null;
                    s.userName = null;
                    s.isHost = false;
                });
                
                // 방 삭제
                delete rooms[roomId];
                
                // 방 목록 업데이트
                updateRoomsList();
                
                console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
            }
        }
        
        // 게임 진행 중인 경우 종료 조건 체크
        if (rooms[roomId] && gameState.isGameActive) {
            checkAndEndGame(gameState, room);
        }

        socket.leave(roomId);
        socket.currentRoomId = null;
        socket.userName = null;
        socket.isHost = false;
    }

    // 방 나가기 요청
    socket.on('leaveRoom', async () => {
        if (!checkRateLimit()) return;
        await leaveRoom(socket);
        socket.emit('roomLeft');
    });

    // 강퇴 기능 (호스트 전용)
    socket.on('kickPlayer', async (targetName) => {
        if (!checkRateLimit()) return;

        const room = getCurrentRoom();
        const gameState = getCurrentRoomGameState();
        if (!room || !gameState) return;

        // 호스트 권한 확인
        const currentUser = gameState.users.find(u => u.id === socket.id);
        if (!currentUser || !currentUser.isHost) {
            socket.emit('permissionError', '호스트만 강퇴 기능을 사용할 수 있습니다.');
            return;
        }

        const targetUser = gameState.users.find(u => u.name === targetName);
        if (!targetUser) {
            socket.emit('gameError', '해당 사용자를 찾을 수 없습니다.');
            return;
        }

        if (targetUser.isHost) {
            socket.emit('gameError', '호스트는 강퇴할 수 없습니다.');
            return;
        }

        // 게임 진행 중인 경우, 이미 굴린 사람은 강퇴 불가 (사용자 요청: 굴리지 않은 사람만)
        if (gameState.isGameActive) {
            if (gameState.rolledUsers.includes(targetName)) {
                socket.emit('gameError', '이미 주사위를 굴린 사용자는 게임 도중 제외할 수 없습니다.');
                return;
            }
        }

        const targetSocketId = targetUser.id;
        const socketsInRoom = await io.in(room.roomId).fetchSockets();
        const targetSocket = socketsInRoom.find(s => s.id === targetSocketId);

        // 시스템 메시지 알림
        const kickMessage = {
            userName: '시스템',
            message: `${targetName}님이 호스트에 의해 게임에서 제외되었습니다.`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true
        };
        gameState.chatHistory.push(kickMessage);
        io.to(room.roomId).emit('newMessage', kickMessage);

        // 추가 리스트 정리 (준비 중인 사용자, 게임 참여 중인 사용자)
        gameState.readyUsers = gameState.readyUsers.filter(name => name !== targetName);
        gameState.gamePlayers = gameState.gamePlayers.filter(name => name !== targetName);

        if (targetSocket) {
            targetSocket.emit('kicked', '호스트에 의해 방에서 제외되었습니다.');
            await leaveRoom(targetSocket);
        } else {
            // 소켓이 없는 경우 (비정상 상태) 직접 제거 로직 수행
            gameState.users = gameState.users.filter(u => u.name !== targetName);
            io.to(room.roomId).emit('updateUsers', gameState.users);
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            updateRoomsList();
        }

        // 게임 제외 후 종료 조건 체크
        if (gameState.isGameActive) {
            checkAndEndGame(gameState, room);
        }

        console.log(`방 ${room.roomName}에서 ${targetName} 강퇴됨`);
    });

    // 방 목록 업데이트 (모든 클라이언트에게)
    function updateRoomsList() {
        const roomsList = Object.entries(rooms).map(([roomId, room]) => ({
            roomId,
            roomName: room.roomName,
            hostName: room.hostName,
            playerCount: room.gameState.users.length,
            isGameActive: room.gameState.isGameActive,
            isOrderActive: room.gameState.isOrderActive,
            isPrivate: room.isPrivate || false,
            gameType: room.gameType || 'dice' // 게임 타입 추가
            // 비밀번호는 보안상 목록에 포함하지 않음
        }));
        
        io.emit('roomsListUpdated', roomsList);
    }

    // 방 제목 변경
    socket.on('updateRoomName', (data) => {
        if (!checkRateLimit()) return;
        
        const { roomName } = data;
        const room = getCurrentRoom();
        
        if (!room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        if (!socket.isHost || socket.id !== room.hostId) {
            socket.emit('permissionError', 'Host만 방 제목을 변경할 수 있습니다!');
            return;
        }
        
        // 입력값 검증
        if (!roomName || typeof roomName !== 'string' || roomName.trim().length === 0) {
            socket.emit('roomError', '올바른 방 제목을 입력해주세요!');
            return;
        }
        
        // 방 제목 길이 제한
        if (roomName.trim().length > 30) {
            socket.emit('roomError', '방 제목은 30자 이하로 입력해주세요!');
            return;
        }
        
        // 방 제목 변경
        room.roomName = roomName.trim();
        
        // 같은 방의 모든 사용자에게 업데이트
        io.to(room.roomId).emit('roomNameUpdated', roomName.trim());
        
        // 방 목록 업데이트
        updateRoomsList();
        
        console.log(`방 제목 변경: ${room.roomId} -> ${roomName.trim()}`);
    });

    // 모든 참여자가 주사위를 굴렸는지 확인하고 게임 종료 처리
    function checkAndEndGame(gameState, room) {
        if (!gameState.isGameActive || gameState.gamePlayers.length === 0) return;

        // 모두 굴렸는지 확인
        if (gameState.rolledUsers.length === gameState.gamePlayers.length && !gameState.allPlayersRolledMessageSent) {
            gameState.allPlayersRolledMessageSent = true; // 플래그 설정하여 중복 전송 방지
            
            io.to(room.roomId).emit('allPlayersRolled', {
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                totalPlayers: gameState.gamePlayers.length
            });
            
            // 채팅에 시스템 메시지 전송
            const allRolledMessage = {
                userName: '시스템',
                message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                isHost: false,
                isSystemMessage: true
            };
            
            gameState.chatHistory.push(allRolledMessage);
            if (gameState.chatHistory.length > 100) {
                gameState.chatHistory.shift();
            }
            
            io.to(room.roomId).emit('newMessage', allRolledMessage);
            
            console.log(`방 ${room.roomName}: 모든 참여자가 주사위를 굴렸습니다!`);
            
            // 모든 참여자가 주사위를 굴렸으면 자동으로 게임 종료
            gameState.isGameActive = false;
            
            // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
            const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
            console.log(`[서버] 방 ${room.roomName} 게임 종료 시작 - gamePlayers:`, currentGamePlayers, 'history 길이:', gameState.history.length);
            
            const currentGameHistory = gameState.history.filter(record => {
                return record.isGameActive === true && currentGamePlayers.includes(record.user);
            });
            
            console.log(`[서버] 방 ${room.roomName} currentGameHistory 필터링 결과:`, currentGameHistory.length, '개');
            console.log(`[서버] 방 ${room.roomName} currentGameHistory 상세:`, currentGameHistory.map(r => ({ user: r.user, result: r.result, time: r.time })));
            
            gameState.gamePlayers = []; // 참여자 목록 초기화
            gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
            gameState.readyUsers = []; // 준비 상태 초기화
            gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
            
            console.log(`[서버] 방 ${room.roomName} gameEnded 이벤트 전송 - currentGameHistory:`, currentGameHistory.length, '개');
            io.to(room.roomId).emit('gameEnded', currentGameHistory);
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            
            // 방 목록 업데이트 (게임 상태 변경)
            updateRoomsList();
            
            console.log(`[서버] 방 ${room.roomName} 게임 자동 종료 완료, 총`, currentGameHistory.length, '번 굴림');
        } else if (gameState.isGameActive) {
            // 아직 모두 굴리지 않은 경우 진행 상황 업데이트
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );
            
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
        }
    }

    // 사용자 로그인 (하위 호환성 유지, 하지만 이제는 사용하지 않음)
    socket.on('login', (data) => {
        if (!checkRateLimit()) return;
        
        const { name, isHost } = data;
        
        // 입력값 검증
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            socket.emit('loginError', '올바른 이름을 입력해주세요!');
            return;
        }
        
        // 이름 길이 제한
        if (name.trim().length > 20) {
            socket.emit('loginError', '이름은 20자 이하로 입력해주세요!');
            return;
        }
        
        // 중복 이름 체크
        if (gameState.users.some(user => user.name === name)) {
            socket.emit('loginError', '이미 사용 중인 이름입니다!');
            return;
        }

        // 호스트 중복 체크
        if (isHost && gameState.users.some(user => user.isHost === true)) {
            socket.emit('loginError', '이미 호스트가 있습니다! 일반 사용자로 입장해주세요.');
            return;
        }   m

        const user = {
            id: socket.id,
            name: name.trim(),
            isHost: isHost,
            joinTime: new Date()
        };

        gameState.users.push(user);
        
        // 사용자별 주사위 설정 초기화 (없으면 기본값, 최소값은 항상 1 고정)
        if (!gameState.userDiceSettings[name.trim()]) {
            gameState.userDiceSettings[name.trim()] = {
                max: 100
            };
        }
        
        // 사용자별 주문 초기화
        if (!gameState.userOrders[name.trim()]) {
            gameState.userOrders[name.trim()] = '';
        }
        
        console.log(`${name} 입장 (${isHost ? 'HOST' : '일반'})`);

        // 재접속 시 이미 굴렸는지 확인
        const hasRolled = gameState.rolledUsers.includes(name.trim());
        const myResult = gameState.history.find(r => r.user === name.trim());
        
        // 로그인 성공 응답과 함께 재접속 정보 전송
        socket.emit('loginSuccess', {
            userName: name.trim(),
            isHost: isHost,
            hasRolled: hasRolled,
            myResult: myResult,
            isGameActive: gameState.isGameActive,
            isOrderActive: gameState.isOrderActive,
            isGamePlayer: gameState.gamePlayers.includes(name.trim()),
            diceSettings: gameState.userDiceSettings[name.trim()],
            myOrder: gameState.userOrders[name.trim()] || '',
            gameRules: gameState.gameRules,
            frequentMenus: gameState.frequentMenus
        });

        // 모든 클라이언트에게 업데이트된 사용자 목록 전송
        io.emit('updateUsers', gameState.users);
        
        // 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.emit('updateOrders', gameState.userOrders);
    });

    // 주문받기 시작
    socket.on('startOrder', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 시작할 수 있습니다!');
            return;
        }
        
        gameState.isOrderActive = true;
        // 주문받기 시작 시 기존 주문 초기화
        gameState.userOrders = {};
        gameState.users.forEach(u => {
            gameState.userOrders[u.name] = '';
        });
        
        io.to(room.roomId).emit('orderStarted');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        console.log(`방 ${room.roomName}에서 주문받기 시작`);
    });

    // 주문받기 종료
    socket.on('endOrder', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 주문받기를 종료할 수 있습니다!');
            return;
        }
        
        gameState.isOrderActive = false;
        io.to(room.roomId).emit('orderEnded');
        console.log(`방 ${room.roomName}에서 주문받기 종료`);
    });

    // 주문 업데이트
    socket.on('updateOrder', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { userName, order } = data;
        
        // 주문받기 활성화 확인
        if (!gameState.isOrderActive) {
            socket.emit('orderError', '주문받기가 시작되지 않았습니다!');
            return;
        }
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            console.log(`주문 실패: 사용자를 찾을 수 없음. socket.id: ${socket.id}, userName: ${userName}`);
            socket.emit('orderError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        const trimmedUserName = userName ? userName.trim() : '';
        if (user.name !== trimmedUserName) {
            console.log(`주문 실패: 사용자 이름 불일치. user.name: ${user.name}, userName: ${trimmedUserName}`);
            socket.emit('orderError', `잘못된 사용자입니다! (${user.name} vs ${trimmedUserName})`);
            return;
        }
        
        // 입력값 검증
        if (typeof order !== 'string') {
            socket.emit('orderError', '올바른 주문을 입력해주세요!');
            return;
        }
        
        // 주문 길이 제한
        if (order.length > 100) {
            socket.emit('orderError', '주문은 100자 이하로 입력해주세요!');
            return;
        }
        
        // userOrders가 없으면 초기화
        if (!gameState.userOrders) {
            gameState.userOrders = {};
        }
        
        // 주문 저장 (userName은 이미 trimmedUserName으로 검증됨)
        gameState.userOrders[trimmedUserName] = order.trim();
        
        // 같은 방의 모든 클라이언트에게 업데이트된 주문 목록 전송
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        
        socket.emit('orderUpdated', { order: order.trim() });
        console.log(`방 ${room.roomName}: ${trimmedUserName}의 주문 저장 성공: ${order.trim() || '(삭제됨)'}`);
    });


    // 개인 주사위 설정 업데이트 (최소값은 항상 1)
    socket.on('updateUserDiceSettings', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { userName, max } = data;
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== userName) {
            socket.emit('settingsError', '잘못된 사용자입니다!');
            return;
        }
        
        // 입력값 검증
        if (typeof max !== 'number' || max < 2 || max > 100000) {
            socket.emit('settingsError', '올바른 범위를 입력해주세요! (2~100000)');
            return;
        }
        
        // 설정 저장 (최소값은 항상 1)
        gameState.userDiceSettings[userName] = {
            max: Math.floor(max)
        };
        
        socket.emit('settingsUpdated', gameState.userDiceSettings[userName]);
        console.log(`${userName}의 주사위 설정 변경: 1 ~ ${max}`);
    });

    // 주사위 범위 업데이트 (전역 - 하위 호환성)
    socket.on('updateRange', (range) => {
        if (!checkRateLimit()) return;
        
        // 입력값 검증
        if (typeof range !== 'number' || range < 2 || range > 10000) {
            socket.emit('rangeError', '주사위 범위는 2 이상 10000 이하로 설정해주세요!');
            return;
        }
        
        gameState.diceMax = Math.floor(range);
        io.emit('rangeUpdated', gameState.diceMax);
        console.log('주사위 범위 변경:', gameState.diceMax);
    });

    // 게임 룰 업데이트 (호스트만, 게임 시작 전만 가능)
    socket.on('updateGameRules', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 룰을 수정할 수 있습니다!');
            return;
        }
        
        // 게임 시작 후 수정 불가
        if (gameState.isGameActive) {
            socket.emit('rulesError', '게임이 진행 중이면 룰을 수정할 수 없습니다!');
            return;
        }
        
        const { rules } = data;
        
        // 입력값 검증
        if (typeof rules !== 'string') {
            socket.emit('rulesError', '올바른 룰을 입력해주세요!');
            return;
        }
        
        // 룰 길이 제한
        if (rules.length > 500) {
            socket.emit('rulesError', '룰은 500자 이하로 입력해주세요!');
            return;
        }
        
        // 룰 저장
        gameState.gameRules = rules.trim();
        
        // 같은 방의 모든 클라이언트에게 업데이트된 룰 전송
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        // 호스트에게 저장 성공 메시지 전송
        const rulesText = gameState.gameRules || '(룰 없음)';
        socket.emit('rulesSaved', `${rulesText} 룰이 적용되었습니다.`);
        
    });

    // 준비 상태 토글
    socket.on('toggleReady', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 게임 진행 중이면 준비 상태 변경 불가
        if (gameState.isGameActive) {
            socket.emit('readyError', '게임이 진행 중일 때는 준비 상태를 변경할 수 없습니다!');
            return;
        }
        
        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('readyError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        const userName = user.name;
        const isReady = gameState.readyUsers.includes(userName);
        
        if (isReady) {
            // 준비 취소
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== userName);
            socket.emit('readyStateChanged', { isReady: false });
        } else {
            // 준비
            gameState.readyUsers.push(userName);
            socket.emit('readyStateChanged', { isReady: true });
        }
        
        // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        console.log(`방 ${room.roomName}: ${userName} ${isReady ? '준비 취소' : '준비 완료'} (준비 인원: ${gameState.readyUsers.length}명)`);
    });

    // 호스트가 다른 사용자를 준비 상태로 설정
    socket.on('setUserReady', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 다른 사용자의 준비 상태를 변경할 수 있습니다!');
            return;
        }
        
        // 게임 진행 중이면 준비 상태 변경 불가
        if (gameState.isGameActive) {
            socket.emit('readyError', '게임이 진행 중일 때는 준비 상태를 변경할 수 없습니다!');
            return;
        }
        
        const { userName, isReady } = data;
        
        // 입력값 검증
        if (!userName || typeof userName !== 'string' || userName.trim().length === 0) {
            socket.emit('readyError', '올바른 사용자 이름을 입력해주세요!');
            return;
        }
        
        const trimmedUserName = userName.trim();
        const currentlyReady = gameState.readyUsers.includes(trimmedUserName);
        
        if (isReady && !currentlyReady) {
            // 준비 상태로 설정 - 방에 있는지 확인 필요
            const targetUser = gameState.users.find(u => u.name === trimmedUserName);
            if (!targetUser) {
                socket.emit('readyError', '해당 사용자를 찾을 수 없습니다!');
                return;
            }
            gameState.readyUsers.push(trimmedUserName);
            
            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            
            // 대상 사용자에게도 준비 상태 변경 알림
            const targetSocket = io.sockets.sockets.get(targetUser.id);
            if (targetSocket) {
                targetSocket.emit('readyStateChanged', { isReady: isReady });
            }
        } else if (!isReady && currentlyReady) {
            // 준비 취소 - 방에 없어도 제거 가능
            gameState.readyUsers = gameState.readyUsers.filter(name => name !== trimmedUserName);
            
            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
            
            // 대상 사용자가 방에 있으면 알림 전송
            const targetUser = gameState.users.find(u => u.name === trimmedUserName);
            if (targetUser) {
                const targetSocket = io.sockets.sockets.get(targetUser.id);
                if (targetSocket) {
                    targetSocket.emit('readyStateChanged', { isReady: isReady });
                }
            }
        } else {
            // 상태 변경이 없는 경우 (이미 준비 상태이거나 이미 준비 취소 상태)
            // 같은 방의 모든 클라이언트에게 준비 목록 업데이트 (동기화를 위해)
            io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        }
        
        console.log(`방 ${room.roomName}: 호스트가 ${trimmedUserName}을(를) ${isReady ? '준비 상태로' : '준비 취소로'} 설정 (준비 인원: ${gameState.readyUsers.length}명)`);
    });

    // 자주 쓰는 메뉴 목록 가져오기
    socket.on('getFrequentMenus', () => {
        if (!checkRateLimit()) return;
        const gameState = getCurrentRoomGameState();
        if (!gameState) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        socket.emit('frequentMenusUpdated', gameState.frequentMenus);
    });

    // 자주 쓰는 메뉴 추가
    socket.on('addFrequentMenu', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { menu } = data;
        
        // 입력값 검증
        if (!menu || typeof menu !== 'string' || menu.trim().length === 0) {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }
        
        const menuTrimmed = menu.trim();
        
        // 중복 체크
        if (gameState.frequentMenus.includes(menuTrimmed)) {
            socket.emit('menuError', '이미 등록된 메뉴입니다!');
            return;
        }
        
        // 메뉴 추가
        gameState.frequentMenus.push(menuTrimmed);
        
        // 파일에 저장
        if (saveFrequentMenus(gameState.frequentMenus)) {
            // 같은 방의 모든 클라이언트에게 업데이트된 메뉴 목록 전송
            io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
            console.log(`방 ${room.roomName} 메뉴 추가:`, menuTrimmed);
        } else {
            socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
            // 추가한 메뉴 롤백
            gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menuTrimmed);
        }
    });

    // 자주 쓰는 메뉴 삭제
    socket.on('deleteFrequentMenu', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { menu } = data;
        
        // 입력값 검증
        if (!menu || typeof menu !== 'string') {
            socket.emit('menuError', '올바른 메뉴명을 입력해주세요!');
            return;
        }
        
        // 메뉴 삭제
        const beforeLength = gameState.frequentMenus.length;
        gameState.frequentMenus = gameState.frequentMenus.filter(m => m !== menu);
        
        if (gameState.frequentMenus.length === beforeLength) {
            socket.emit('menuError', '존재하지 않는 메뉴입니다!');
            return;
        }
        
        // 파일에 저장
        if (saveFrequentMenus(gameState.frequentMenus)) {
            // 같은 방의 모든 클라이언트에게 업데이트된 메뉴 목록 전송
            io.to(room.roomId).emit('frequentMenusUpdated', gameState.frequentMenus);
            console.log(`방 ${room.roomName} 메뉴 삭제:`, menu);
        } else {
            socket.emit('menuError', '메뉴 저장 중 오류가 발생했습니다!');
            // 삭제한 메뉴 롤백 (파일 읽기로 복구)
            gameState.frequentMenus = loadFrequentMenus();
        }
    });

    // 게임 시작
    socket.on('startGame', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 시작할 수 있습니다!');
            return;
        }
        
        // 게임 시작 시 현재 룰 텍스트 영역의 값을 자동 저장 (저장 버튼을 누르지 않았어도)
        // 클라이언트에서 최신 룰을 받아와서 저장하는 것이 아니므로,
        // 서버의 현재 gameRules 값을 그대로 유지하고 모든 클라이언트에 동기화
        
        // 게임 시작 시 준비한 사용자들을 참여자 목록으로 설정
        gameState.gamePlayers = [...gameState.readyUsers];
        
        // 참여자가 0명이면 게임 시작 불가
        if (gameState.gamePlayers.length === 0) {
            socket.emit('gameError', '참여자가 없습니다. 최소 1명 이상 준비해야 게임을 시작할 수 있습니다.');
            return;
        }
        
        // 게임 참여자들을 누적 참여자 목록에 추가 (중복 제거)
        gameState.gamePlayers.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });
        
        gameState.isGameActive = true;
        // history는 초기화하지 않음 (통계를 위해 누적 기록 유지)
        // 현재 게임의 기록만 표시하려면 gamePlayers로 필터링
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
        
        // 게임 시작 시 같은 방의 모든 클라이언트에게 현재 룰을 동기화 (게임 시작 = 룰 확정)
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        
        io.to(room.roomId).emit('gameStarted', {
            players: gameState.gamePlayers,
            totalPlayers: gameState.gamePlayers.length
        });
        
        // 게임 시작 시 채팅에 게임 시작 메시지와 룰 전송
        const gameStartMessage = {
            userName: '시스템',
            message: `---------------------------------------\n------------- 게임시작 --------------\n${gameState.gameRules || '게임 룰이 설정되지 않았습니다.'}\n---------------------------------------`,
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: false,
            isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
        };
        
        // 채팅 기록에 저장
        gameState.chatHistory.push(gameStartMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory.shift();
        }
        
        io.to(room.roomId).emit('newMessage', gameStartMessage);
        
        // 게임 시작 시 초기 진행 상황 전송 (아직 굴리지 않은 사람 목록 포함)
        if (gameState.gamePlayers.length > 0) {
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );
            
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
        }
        
        // 방 목록 업데이트 (게임 상태 변경)
        updateRoomsList();
        
        console.log(`방 ${room.roomName} 게임 시작 - 참여자:`, gameState.gamePlayers.join(', '));
    });

    // 게임 종료
    socket.on('endGame', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임을 종료할 수 있습니다!');
            return;
        }
        
        gameState.isGameActive = false;
        
        // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
        const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
        console.log(`[서버] 방 ${room.roomName} endGame 이벤트 - gamePlayers:`, currentGamePlayers, 'history 길이:', gameState.history.length);
        
        const currentGameHistory = gameState.history.filter(record => {
            // 게임 진행 중일 때 굴린 주사위이고, 현재 게임 참여자인 경우만 포함
            return record.isGameActive === true && currentGamePlayers.includes(record.user);
        });
        
        console.log(`[서버] 방 ${room.roomName} currentGameHistory 필터링 결과:`, currentGameHistory.length, '개');
        console.log(`[서버] 방 ${room.roomName} currentGameHistory 상세:`, currentGameHistory.map(r => ({ user: r.user, result: r.result, time: r.time })));
        
        gameState.gamePlayers = []; // 참여자 목록 초기화
        gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
        gameState.readyUsers = []; // 준비 상태 초기화
        gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
        
        console.log(`[서버] 방 ${room.roomName} gameEnded 이벤트 전송 - currentGameHistory:`, currentGameHistory.length, '개');
        io.to(room.roomId).emit('gameEnded', currentGameHistory);
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        // 방 목록 업데이트 (게임 상태 변경)
        updateRoomsList();
        
        console.log(`[서버] 방 ${room.roomName} 게임 종료 완료, 총`, currentGameHistory.length, '번 굴림');
    });

    // ========== 룰렛 게임 이벤트 핸들러 ==========
    
    // 룰렛 게임 시작 (방장만 가능)
    socket.on('startRoulette', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 룰렛 게임 방인지 확인
        if (room.gameType !== 'roulette') {
            socket.emit('rouletteError', '룰렛 게임 방이 아닙니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('rouletteError', '방장만 룰렛을 시작할 수 있습니다!');
            return;
        }
        
        // 이미 회전 중인지 확인
        if (gameState.isRouletteSpinning) {
            socket.emit('rouletteError', '이미 룰렛이 회전 중입니다!');
            return;
        }
        
        // 준비한 사람이 2명 이상인지 확인
        if (!gameState.readyUsers || gameState.readyUsers.length < 2) {
            socket.emit('rouletteError', '최소 2명 이상이 준비해야 시작할 수 있습니다!');
            return;
        }
        
        // 룰렛 회전 시작
        gameState.isRouletteSpinning = true;
        gameState.isGameActive = true;
        
        // 참여자 목록 저장
        const participants = [...gameState.readyUsers];
        gameState.gamePlayers = participants;
        
        // 게임 참여자들을 누적 참여자 목록에 추가 (중복 제거)
        participants.forEach(player => {
            if (!gameState.everPlayedUsers.includes(player)) {
                gameState.everPlayedUsers.push(player);
            }
        });
        
        // 당첨자 랜덤 선택 (서버에서 결정)
        const winnerIndex = Math.floor(Math.random() * participants.length);
        const winner = participants[winnerIndex];
        
        // 애니메이션 파라미터 생성 (모든 클라이언트가 동일한 애니메이션을 재생하도록)
        const spinDuration = 5000 + Math.random() * 2000; // 5~7초 회전
        const totalRotation = 1800 + Math.random() * 1080; // 5~8바퀴 회전 (1800 = 5바퀴, 2880 = 8바퀴)
        
        // 클라이언트가 직접 각도 계산하도록 winnerIndex와 totalRotation만 전달
        // 서버는 당첨자와 회전량만 결정
        const segmentAngle = 360 / participants.length;
        
        // 클라이언트에서 계산할 값들을 서버에서도 계산해서 로그 출력
        const winnerCenterAngle = (winnerIndex + 0.5) * segmentAngle;
        const neededRotation = 360 - winnerCenterAngle;
        const fullRotations = Math.floor(totalRotation / 360);
        const finalAngle = fullRotations * 360 + neededRotation;
        
        console.log(`\n========== 룰렛 시작 ==========`);
        console.log(`참가자 (${participants.length}명): ${participants.join(', ')}`);
        console.log(`당첨자: ${winner} (index: ${winnerIndex})`);
        console.log(`segmentAngle: ${segmentAngle.toFixed(2)}°`);
        console.log(`winnerCenterAngle: ${winnerCenterAngle.toFixed(2)}° (당첨자 중앙)`);
        console.log(`neededRotation: ${neededRotation.toFixed(2)}° (= 360 - ${winnerCenterAngle.toFixed(2)})`);
        console.log(`fullRotations: ${fullRotations}바퀴`);
        console.log(`finalAngle: ${finalAngle.toFixed(2)}° (= ${fullRotations} * 360 + ${neededRotation.toFixed(2)})`);
        console.log(`검증 - 화살표 위치: ${(360 - (finalAngle % 360)).toFixed(2)}° → 당첨자 중앙(${winnerCenterAngle.toFixed(2)}°)과 일치해야 함`);
        console.log(`================================\n`);
        
        // 게임 기록 생성 (한국 시간 기준)
        const now = new Date();
        // 한국 시간으로 변환 (UTC+9)
        const koreaOffset = 9 * 60; // 한국은 UTC+9 (분 단위)
        const koreaTime = new Date(now.getTime() + (koreaOffset - now.getTimezoneOffset()) * 60000);
        const record = {
            round: gameState.rouletteHistory.length + 1,
            participants: participants,
            winner: winner,
            timestamp: koreaTime.toISOString(),
            date: koreaTime.toISOString().split('T')[0],
            time: now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
        };
        
        // 기록 저장
        gameState.rouletteHistory.push(record);
        
        // 모든 클라이언트에게 룰렛 시작 이벤트 전송
        // finalAngle은 클라이언트가 직접 계산
        io.to(room.roomId).emit('rouletteStarted', {
            participants: participants,
            spinDuration: spinDuration,
            totalRotation: totalRotation,
            winnerIndex: winnerIndex,
            winner: winner,
            record: record,
            everPlayedUsers: gameState.everPlayedUsers // 누적 참여자 목록 전송
        });
        
        // 채팅에 시스템 메시지 추가 (한국 시간 - 위에서 선언한 now와 koreaTime 재사용)
        const startMessage = {
            userName: '시스템',
            message: `🎰 룰렛 게임 시작! 참가자: ${participants.join(', ')}`,
            timestamp: koreaTime.toISOString(),
            isSystem: true
        };
        gameState.chatHistory.push(startMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', startMessage);
        
        // 방 목록 업데이트
        updateRoomsList();
        
        console.log(`방 ${room.roomName} 룰렛 시작 - 참가자: ${participants.join(', ')}, 당첨자: ${winner}`);
    });
    
    // 룰렛 결과 처리 (애니메이션 완료 후 호출)
    socket.on('rouletteResult', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) return;
        
        // Host만 결과 처리 가능 (중복 방지)
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) return;
        
        if (!gameState.isRouletteSpinning) return;
        
        gameState.isRouletteSpinning = false;
        
        const { winner } = data;
        
        // 채팅에 결과 메시지 추가 (한국 시간)
        const nowResult = new Date();
        const koreaOffsetResult = 9 * 60; // 한국은 UTC+9 (분 단위)
        const koreaTimeResult = new Date(nowResult.getTime() + (koreaOffsetResult - nowResult.getTimezoneOffset()) * 60000);
        const resultMessage = {
            userName: '시스템',
            message: `🎊🎉 축하합니다! ${winner}님이 당첨되었습니다! 🎉🎊`,
            timestamp: koreaTimeResult.toISOString(),
            isSystem: true,
            isRouletteWinner: true
        };
        gameState.chatHistory.push(resultMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory = gameState.chatHistory.slice(-100);
        }
        io.to(room.roomId).emit('newMessage', resultMessage);
        
        // 룰렛 결과 이벤트 전송
        io.to(room.roomId).emit('rouletteEnded', {
            winner: winner
        });
        
        console.log(`방 ${room.roomName} 룰렛 결과 - 당첨자: ${winner}`);
    });
    
    // 룰렛 게임 종료 (초기화면으로 돌아가기)
    socket.on('endRoulette', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('rouletteError', '방장만 게임을 종료할 수 있습니다!');
            return;
        }
        
        // 게임 상태 초기화
        gameState.isGameActive = false;
        gameState.isRouletteSpinning = false;
        gameState.gamePlayers = [];
        gameState.readyUsers = [];
        
        // 모든 클라이언트에게 게임 종료 이벤트 전송
        io.to(room.roomId).emit('rouletteGameEnded', {
            rouletteHistory: gameState.rouletteHistory
        });
        io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
        
        // 방 목록 업데이트
        updateRoomsList();
        
        console.log(`방 ${room.roomName} 룰렛 게임 종료`);
    });
    
    // 룰렛 색상 선택
    socket.on('selectRouletteColor', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 룰렛 게임 방인지 확인
        if (room.gameType !== 'roulette') {
            socket.emit('colorSelectError', '룰렛 게임 방이 아닙니다!');
            return;
        }
        
        const { colorIndex } = data;
        const userName = socket.userName;
        
        if (!userName) {
            socket.emit('colorSelectError', '사용자 정보를 찾을 수 없습니다!');
            return;
        }
        
        // 색상 인덱스 유효성 검사 (0~15)
        if (typeof colorIndex !== 'number' || colorIndex < 0 || colorIndex > 15) {
            socket.emit('colorSelectError', '유효하지 않은 색상입니다!');
            return;
        }
        
        // 다른 사용자가 이미 사용 중인 색상인지 확인
        const usedColors = Object.entries(gameState.userColors);
        for (const [user, color] of usedColors) {
            if (user !== userName && color === colorIndex) {
                socket.emit('colorSelectError', `이 색상은 ${user}님이 사용 중입니다!`);
                return;
            }
        }
        
        // 색상 저장
        gameState.userColors[userName] = colorIndex;
        
        // 모든 클라이언트에게 색상 업데이트 전송
        io.to(room.roomId).emit('userColorsUpdated', gameState.userColors);
        
        console.log(`방 ${room.roomName}: ${userName}이(가) 색상 ${colorIndex} 선택`);
    });
    
    // 사용자 색상 정보 요청
    socket.on('getUserColors', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        if (!gameState) return;
        
        socket.emit('userColorsUpdated', gameState.userColors || {});
    });

    // ========== 룰렛 게임 이벤트 핸들러 끝 ==========

    // 이전 게임 데이터 삭제
    socket.on('clearGameData', () => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // Host 권한 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || !user.isHost) {
            socket.emit('permissionError', 'Host만 게임 데이터를 삭제할 수 있습니다!');
            return;
        }
        
        // 게임 진행 중이면 삭제 불가
        if (gameState.isGameActive) {
            socket.emit('clearDataError', '게임이 진행 중일 때는 데이터를 삭제할 수 없습니다!');
            return;
        }
        
        // 게임 데이터 초기화
        gameState.history = [];
        gameState.rolledUsers = [];
        gameState.gamePlayers = [];
        gameState.userOrders = {};
        gameState.gameRules = '';
        
        // 같은 방의 모든 클라이언트에게 업데이트 전송
        io.to(room.roomId).emit('gameDataCleared');
        io.to(room.roomId).emit('updateOrders', gameState.userOrders);
        io.to(room.roomId).emit('gameRulesUpdated', gameState.gameRules);
        
        console.log(`방 ${room.roomName} 이전 게임 데이터가 삭제되었습니다.`);
    });

    // 주사위 굴리기 요청 (클라이언트 시드 기반)
    socket.on('requestRoll', async (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        const { userName: inputUserName, clientSeed, min, max } = data;
        
        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }
        
        // 사용자 검증
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user || user.name !== inputUserName.trim()) {
            socket.emit('rollError', '잘못된 사용자입니다!');
            return;
        }
        
        // userName을 서버에 저장된 정규화된 값으로 통일 (공백 제거 등)
        const userName = user.name;
        
        // 게임 진행 중일 때 준비하지 않은 사람인지 확인
        let isNotReady = false;
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            if (!gameState.gamePlayers.includes(userName)) {
                // 준비하지 않은 사람은 처리하되 플래그 설정
                isNotReady = true;
            }
        }
        
        // 주사위는 게임 진행 전/후 모두 자유롭게 굴릴 수 있음

        // 클라이언트 시드 검증
        if (!clientSeed || typeof clientSeed !== 'string') {
            socket.emit('rollError', '올바른 시드가 필요합니다!');
            return;
        }

        // 주사위 범위 설정 (명령어에서 오는 경우 그 값 사용, 아니면 사용자 설정 사용)
        let diceMin, diceMax;
        if (min !== undefined && max !== undefined) {
            // 명령어에서 지정한 범위 사용
            diceMin = parseInt(min);
            diceMax = parseInt(max);
            
            // 범위 검증
            if (isNaN(diceMin) || isNaN(diceMax) || diceMin < 1 || diceMax < diceMin || diceMax > 100000) {
                socket.emit('rollError', '올바른 주사위 범위를 입력해주세요! (1 이상, 최대값 100000 이하)');
                return;
            }
        } else {
            // 사용자별 주사위 설정 가져오기 (최소값은 항상 1)
            const userSettings = gameState.userDiceSettings[userName] || { max: 100 };
            diceMin = 1;
            diceMax = userSettings.max;
        }
        
        // 시드 기반으로 서버에서 난수 생성
        const result = seededRandom(clientSeed, diceMin, diceMax);

        // 마지막 굴리는 사람인지 확인 (게임 진행 중이고, 이번 굴림으로 모든 사람이 굴렸을 때)
        const isLastRoller = gameState.isGameActive && gameState.gamePlayers.length > 0 && 
                             !gameState.rolledUsers.includes(userName) && !isNotReady &&
                             (gameState.rolledUsers.length === gameState.gamePlayers.length - 1);
        
        // 하이 게임 애니메이션 조건 확인
        let isHighGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에 "하이"가 포함되어 있는지 확인
            const isHighGame = gameState.gameRules && gameState.gameRules.toLowerCase().includes('하이');
            
            if (isHighGame && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                // 지금까지 나온 주사위 중 최저값 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);
                
                if (currentRolls.length > 0) {
                    const minRoll = Math.min(...currentRolls);
                    // 기존 조건: 현재 결과가 최저값보다 작으면 애니메이션 (지금까지 결과 중 제일 작은 게 나왔을 때)
                    if (result < minRoll) {
                        isHighGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 큰 값 또는 세번째로 큰 값일 때 확률적으로 애니메이션
                        const sortedRolls = [...currentRolls].sort((a, b) => b - a); // 내림차순 정렬
                        const uniqueSortedRolls = [...new Set(sortedRolls)]; // 중복 제거
                        
                        if (uniqueSortedRolls.length >= 2) {
                            const secondLargest = uniqueSortedRolls[1]; // 두번째로 큰 값
                            const thirdLargest = uniqueSortedRolls.length >= 3 ? uniqueSortedRolls[2] : null; // 세번째로 큰 값
                            
                            if (result === secondLargest) {
                                // 두번째로 큰 값일 때 10% 확률
                                isHighGameAnimation = Math.random() < 0.1;
                            } else if (thirdLargest !== null && result === thirdLargest) {
                                // 세번째로 큰 값일 때 5% 확률
                                isHighGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                }
            }
        }
        
        // 로우 게임 애니메이션 조건 확인
        let isLowGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에 "로우"가 포함되어 있는지 확인
            const isLowGame = gameState.gameRules && gameState.gameRules.toLowerCase().includes('로우');
            
            if (isLowGame && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                // 지금까지 나온 주사위 중 최고값 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);
                
                if (currentRolls.length > 0) {
                    const maxRoll = Math.max(...currentRolls);
                    // 기존 조건: 현재 결과가 최고값보다 크면 애니메이션 (지금까지 결과 중 제일 큰 게 나왔을 때)
                    if (result > maxRoll) {
                        isLowGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 큰 값 또는 세번째로 큰 값일 때 확률적으로 애니메이션
                        const sortedRolls = [...currentRolls].sort((a, b) => b - a); // 내림차순 정렬
                        const uniqueSortedRolls = [...new Set(sortedRolls)]; // 중복 제거
                        
                        if (uniqueSortedRolls.length >= 2) {
                            const secondLargest = uniqueSortedRolls[1]; // 두번째로 큰 값
                            const thirdLargest = uniqueSortedRolls.length >= 3 ? uniqueSortedRolls[2] : null; // 세번째로 큰 값
                            
                            if (result === secondLargest) {
                                // 두번째로 큰 값일 때 10% 확률
                                isLowGameAnimation = Math.random() < 0.1;
                            } else if (thirdLargest !== null && result === thirdLargest) {
                                // 세번째로 큰 값일 때 5% 확률
                                isLowGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                }
            }
        }
        
        // 니어 게임 애니메이션 조건 확인
        let isNearGameAnimation = false;
        if (gameState.isGameActive && gameState.gamePlayers.length >= 4 && !isNotReady) {
            // 게임 룰에서 "니어(숫자)" 또는 "니어 (숫자)" 패턴 찾기
            const rulesLower = gameState.gameRules ? gameState.gameRules.toLowerCase() : '';
            const nearMatch = rulesLower.match(/니어\s*\(?\s*(\d+)\s*\)?/);
            
            if (nearMatch && gameState.rolledUsers.length >= 3) {
                // 4번째 이후 굴림 (rolledUsers.length가 3 이상이면 다음 굴림이 4번째 이상)
                const targetNumber = parseInt(nearMatch[1]);
                
                // 지금까지 나온 주사위 중 타겟 숫자와의 거리 확인
                const currentRolls = gameState.history
                    .filter(h => gameState.gamePlayers.includes(h.user))
                    .map(h => h.result);
                
                if (currentRolls.length > 0) {
                    // 현재 결과와 타겟 숫자와의 거리
                    const currentDistance = Math.abs(result - targetNumber);
                    
                    // 지금까지 나온 주사위 중 타겟 숫자와의 거리들을 계산
                    const distances = currentRolls.map(r => Math.abs(r - targetNumber));
                    const minDistance = Math.min(...distances);
                    
                    // 기존 조건: 현재 결과가 가장 가까우면 애니메이션
                    if (currentDistance < minDistance) {
                        isNearGameAnimation = true;
                    } else {
                        // 추가 조건: 두번째로 가까운 값 또는 세번째로 가까운 값일 때 확률적으로 애니메이션
                        const uniqueDistances = [...new Set(distances)].sort((a, b) => a - b); // 오름차순 정렬, 중복 제거
                        
                        if (uniqueDistances.length >= 2) {
                            const secondClosestDistance = uniqueDistances[1]; // 두번째로 가까운 거리
                            const thirdClosestDistance = uniqueDistances.length >= 3 ? uniqueDistances[2] : null; // 세번째로 가까운 거리
                            
                            if (currentDistance === secondClosestDistance) {
                                // 두번째로 가까운 값일 때 10% 확률
                                isNearGameAnimation = Math.random() < 0.1;
                            } else if (thirdClosestDistance !== null && currentDistance === thirdClosestDistance) {
                                // 세번째로 가까운 값일 때 5% 확률
                                isNearGameAnimation = Math.random() < 0.05;
                            }
                        }
                    }
                } else {
                    // 첫 번째 굴림인 경우 현재 결과가 타겟과 가까우면 애니메이션
                    const currentDistance = Math.abs(result - targetNumber);
                    // 첫 굴림이므로 항상 애니메이션 (하지만 6번째부터만 적용되므로 여기서는 false)
                    isNearGameAnimation = false;
                }
            }
        }
        
        const now = new Date();
        const record = {
            user: userName,
            result: result,
            time: now.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            date: now.toISOString().split('T')[0], // YYYY-MM-DD 형식으로 날짜 저장
            isGameActive: gameState.isGameActive, // 게임 진행 중일 때 굴린 주사위인지 플래그
            seed: clientSeed, // 검증을 위해 시드 저장
            range: `${diceMin}~${diceMax}`,
            isNotReady: isNotReady, // 준비하지 않은 사람인지 플래그
            deviceType: deviceType, // 디바이스 타입 (ios, android, pc)
            isLastRoller: isLastRoller, // 마지막 굴리는 사람인지 플래그
            isHighGameAnimation: isHighGameAnimation, // 하이 게임 애니메이션 플래그
            isLowGameAnimation: isLowGameAnimation, // 로우 게임 애니메이션 플래그
            isNearGameAnimation: isNearGameAnimation // 니어 게임 애니메이션 플래그
        };

        // 게임 진행 중이면 최초 1회만 기록에 저장 (준비하지 않은 사람은 제외)
        const isFirstRollInGame = gameState.isGameActive && gameState.gamePlayers.length > 0 && !gameState.rolledUsers.includes(userName) && !isNotReady;
        const isNotGameActive = !gameState.isGameActive;
        
        // 게임이 진행 중이 아니거나, 게임 진행 중이지만 최초 굴리기인 경우에만 기록에 저장 (준비하지 않은 사람 제외)
        if ((isNotGameActive || isFirstRollInGame) && !isNotReady) {
            gameState.history.push(record);
            
            // 오늘의 주사위 통계 업데이트 (모든 클라이언트에게 전송)
            // 전역 저장소는 방 삭제 시에만 저장하므로 여기서는 방의 기록만 집계
            const stats = getTodayDiceStats();
            io.emit('todayDiceStats', stats)
        }
            
        // rolledUsers 배열에 사용자 추가 (중복 체크, 준비하지 않은 사람은 제외)
        if (!gameState.rolledUsers.includes(userName) && !isNotReady) {
            gameState.rolledUsers.push(userName);
        }
        
        // 같은 방의 모든 클라이언트에게 주사위 결과 전송
        io.to(room.roomId).emit('diceRolled', record);
        
        // 주사위 결과를 채팅 기록에 연결 (채팅 기록에서 /주사위 명령어 메시지를 찾아 결과 추가)
        // 가장 최근 채팅 메시지 중 해당 사용자의 /주사위 메시지를 찾아서 결과 추가
        for (let i = gameState.chatHistory.length - 1; i >= 0; i--) {
            const msg = gameState.chatHistory[i];
            if (msg.userName === userName && 
                (msg.message.startsWith('/주사위') || msg.message.startsWith('/테스트')) &&
                !msg.diceResult) {
                // 주사위 결과 정보 추가
                msg.diceResult = {
                    result: result,
                    range: record.range,
                    isNotReady: isNotReady,
                    deviceType: deviceType,
                    isLastRoller: isLastRoller,
                    isHighGameAnimation: isHighGameAnimation,
                    isLowGameAnimation: isLowGameAnimation,
                    isNearGameAnimation: isNearGameAnimation
                };
                break;
            }
        }
        
        // 게임 진행 중이면 아직 굴리지 않은 사람 목록 계산 및 전송
        if (gameState.isGameActive && gameState.gamePlayers.length > 0) {
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax}) - (${gameState.rolledUsers.length}/${gameState.gamePlayers.length}명 완료)`);
            
            // 아직 굴리지 않은 사람 목록 계산
            const notRolledYet = gameState.gamePlayers.filter(
                player => !gameState.rolledUsers.includes(player)
            );
            
            // 진행 상황 업데이트 전송
            io.to(room.roomId).emit('rollProgress', {
                rolled: gameState.rolledUsers.length,
                total: gameState.gamePlayers.length,
                notRolledYet: notRolledYet
            });
            
            // 모두 굴렸는지 확인 (메시지가 아직 전송되지 않았을 때만)
            if (gameState.rolledUsers.length === gameState.gamePlayers.length && !gameState.allPlayersRolledMessageSent) {
                gameState.allPlayersRolledMessageSent = true; // 플래그 설정하여 중복 전송 방지
                
                io.to(room.roomId).emit('allPlayersRolled', {
                    message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                    totalPlayers: gameState.gamePlayers.length
                });
                
                // 채팅에 시스템 메시지 전송
                const allRolledMessage = {
                    userName: '시스템',
                    message: '🎉 모든 참여자가 주사위를 굴렸습니다!',
                    time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    isHost: false,
                    isSystemMessage: true // 시스템 메시지 표시를 위한 플래그
                };
                
                // 채팅 기록에 저장
                gameState.chatHistory.push(allRolledMessage);
                if (gameState.chatHistory.length > 100) {
                    gameState.chatHistory.shift();
                }
                
                io.to(room.roomId).emit('newMessage', allRolledMessage);
                
                console.log(`방 ${room.roomName}: 모든 참여자가 주사위를 굴렸습니다!`);
                
                // 모든 참여자가 주사위를 굴렸으면 자동으로 게임 종료
                gameState.isGameActive = false;
                
                // 게임 종료 시 현재 게임의 기록만 필터링해서 전송 (게임 참여자가 굴린 기록만)
                const currentGamePlayers = [...gameState.gamePlayers]; // 참여자 목록 백업
                const currentGameHistory = gameState.history.filter(record => {
                    // 게임 진행 중일 때 굴린 주사위이고, 현재 게임 참여자인 경우만 포함
                    return record.isGameActive === true && currentGamePlayers.includes(record.user);
                });
                
                gameState.gamePlayers = []; // 참여자 목록 초기화
                gameState.rolledUsers = []; // 굴린 사용자 목록 초기화
                gameState.readyUsers = []; // 준비 상태 초기화
                gameState.allPlayersRolledMessageSent = false; // 메시지 전송 플래그 초기화
                io.to(room.roomId).emit('gameEnded', currentGameHistory);
                io.to(room.roomId).emit('readyUsersUpdated', gameState.readyUsers);
                
                // 방 목록 업데이트 (게임 상태 변경)
                updateRoomsList();
                
                console.log(`방 ${room.roomName} 게임 자동 종료, 총`, currentGameHistory.length, '번 굴림');
            }
        } else {
            console.log(`방 ${room.roomName}: ${userName}이(가) ${result} 굴림 (시드: ${clientSeed.substring(0, 8)}..., 범위: ${diceMin}~${diceMax})`);
        }
    });

    // 채팅 메시지 전송
    socket.on('sendMessage', async (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { message } = data;
        
        // 입력값 검증
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            socket.emit('chatError', '메시지를 입력해주세요!');
            return;
        }
        
        // 메시지 길이 제한
        if (message.trim().length > 200) {
            socket.emit('chatError', '메시지는 200자 이하로 입력해주세요!');
            return;
        }
        
        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        // User Agent로 디바이스 타입 확인
        const userAgent = socket.handshake.headers['user-agent'] || '';
        let deviceType = 'pc'; // 기본값은 PC
        if (/iPhone|iPad|iPod/i.test(userAgent)) {
            deviceType = 'ios';
        } else if (/Android/i.test(userAgent)) {
            deviceType = 'android';
        }
        
        const chatMessage = {
            userName: user.name,
            message: message.trim(),
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            isHost: user.isHost,
            deviceType: deviceType, // 디바이스 타입 추가
            reactions: {} // 이모티콘 반응 {emoji: [userName1, userName2, ...]}
        };
        
        // 채팅 기록에 저장 (최대 100개)
        gameState.chatHistory.push(chatMessage);
        if (gameState.chatHistory.length > 100) {
            gameState.chatHistory.shift(); // 가장 오래된 메시지 제거
        }
        
        // 같은 방의 모든 클라이언트에게 채팅 메시지 전송
        console.log(`[채팅 전송] 방 ${room.roomName} (ID: ${room.roomId}) - ${user.name}: ${message.trim()}`);
        console.log(`[채팅 전송] 방 ${room.roomId}에 연결된 소켓 수: ${io.sockets.adapter.rooms.get(room.roomId)?.size || 0}`);
        io.to(room.roomId).emit('newMessage', chatMessage);
        
        console.log(`방 ${room.roomName} 채팅: ${user.name}: ${message.trim()}`);

        // Gemini AI 명령어 처리 (/gemini 질문)
        const trimmedMsg = message.trim();
        if (trimmedMsg.startsWith('/gemini ')) {
            const prompt = trimmedMsg.substring(8).trim();
            if (prompt) {
                try {
                    // AI가 생각 중임을 알림 (선택 사항)
                    // io.to(room.roomId).emit('newMessage', {
                    //     userName: 'Gemini AI',
                    //     message: '... 입력 중 ...',
                    //     time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                    //     isAI: true
                    // });

                    const response = await geminiService.generateResponse(prompt);
                    
                    const geminiChatMessage = {
                        userName: 'Gemini AI',
                        message: response,
                        time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
                        isHost: false,
                        isAI: true // AI 메시지임을 표시
                    };
                    
                    // 채팅 기록에 저장
                    gameState.chatHistory.push(geminiChatMessage);
                    if (gameState.chatHistory.length > 100) {
                        gameState.chatHistory.shift();
                    }
                    
                    // 모든 클라이언트에게 AI 응답 전송
                    io.to(room.roomId).emit('newMessage', geminiChatMessage);
                } catch (error) {
                    console.error('Gemini API 채팅 처리 오류:', error);
                }
            }
        }
    });

    // 채팅 이모티콘 추가/제거
    socket.on('toggleReaction', (data) => {
        if (!checkRateLimit()) return;
        
        const gameState = getCurrentRoomGameState();
        const room = getCurrentRoom();
        if (!gameState || !room) {
            socket.emit('roomError', '방에 입장하지 않았습니다!');
            return;
        }
        
        const { messageIndex, emoji } = data;
        
        // 입력값 검증
        if (typeof messageIndex !== 'number' || !emoji || typeof emoji !== 'string') {
            socket.emit('chatError', '올바른 이모티콘 정보를 입력해주세요!');
            return;
        }
        
        // 사용자 확인
        const user = gameState.users.find(u => u.id === socket.id);
        if (!user) {
            socket.emit('chatError', '사용자를 찾을 수 없습니다!');
            return;
        }
        
        // 채팅 기록에서 메시지 찾기 (인덱스로 직접 접근)
        if (messageIndex < 0 || messageIndex >= gameState.chatHistory.length) {
            socket.emit('chatError', '메시지를 찾을 수 없습니다!');
            return;
        }
        
        const chatMessage = gameState.chatHistory[messageIndex];
        
        // reactions 필드 초기화 (없으면)
        if (!chatMessage.reactions) {
            chatMessage.reactions = {};
        }
        
        // reactions 필드 초기화 (없으면)
        if (!chatMessage.reactions) {
            chatMessage.reactions = {};
        }
        
        // 이모티콘 반응 배열 초기화 (없으면)
        if (!chatMessage.reactions[emoji]) {
            chatMessage.reactions[emoji] = [];
        }
        
        // 사용자가 이미 이 이모티콘을 눌렀는지 확인
        const userIndex = chatMessage.reactions[emoji].indexOf(user.name);
        
        if (userIndex === -1) {
            // 이모티콘 추가
            chatMessage.reactions[emoji].push(user.name);
        } else {
            // 이모티콘 제거
            chatMessage.reactions[emoji].splice(userIndex, 1);
            
            // 반응이 없으면 이모티콘 키 제거
            if (chatMessage.reactions[emoji].length === 0) {
                delete chatMessage.reactions[emoji];
            }
        }
        
        // 모든 클라이언트에게 업데이트된 메시지 전송
        io.to(room.roomId).emit('messageReactionUpdated', {
            messageIndex: messageIndex,
            message: chatMessage
        });
        
        console.log(`방 ${room.roomName} 이모티콘 반응: ${user.name}이(가) ${emoji} ${userIndex === -1 ? '추가' : '제거'}`);
    });

    // 연결 해제
    socket.on('disconnect', async (reason) => {
        console.log(`사용자 연결 해제: ${socket.id}, 이유: ${reason}, 방: ${socket.currentRoomId}, 사용자: ${socket.userName}`);
        
        // 'transport close'는 페이지 리다이렉트나 새로고침으로 인한 경우
        // 이 경우 재연결을 기다려야 함
        const isRedirect = reason === 'transport close' || reason === 'client namespace disconnect';
        
        // 리다이렉트나 페이지 새로고침의 경우 잠시 대기 후 방 삭제
        if (socket.currentRoomId && rooms[socket.currentRoomId] && socket.userName) {
            const roomId = socket.currentRoomId;
            const userName = socket.userName;
            const wasHost = socket.isHost;
            
            // 리다이렉트인 경우 더 오래 대기 (5초)
            const waitTime = isRedirect ? 5000 : 3000;
            
            // 잠시 대기 후 사용자가 재연결하지 않았는지 확인
            setTimeout(async () => {
                if (!rooms[roomId]) return; // 이미 방이 삭제되었으면 종료
                
                const room = rooms[roomId];
                const gameState = room.gameState;
                
                // 재연결 여부 확인: 같은 방에 같은 이름의 사용자가 있는지 확인
                const socketsInRoom = await io.in(roomId).fetchSockets();
                const reconnected = socketsInRoom.some(s => 
                    s.currentRoomId === roomId && s.userName === userName
                );
                
                if (!reconnected) {
                    // 재연결하지 않았으면 방에서 제거
                    // 사용자 목록에서 제거 (socket.id로 찾기)
                    const userIndex = gameState.users.findIndex(u => u.id === socket.id);
                    if (userIndex !== -1) {
                        gameState.users.splice(userIndex, 1);
                    } else {
                        // socket.id로 찾지 못하면 이름으로 찾기 (리다이렉트로 인한 재연결 시)
                        const userByName = gameState.users.find(u => u.name === userName);
                        if (userByName) {
                            // 같은 이름의 사용자가 있지만 다른 socket.id인 경우
                            // 이는 재연결 중일 수 있으므로 제거하지 않음
                            console.log(`사용자 ${userName}이(가) 재연결 중일 수 있습니다. 제거하지 않습니다.`);
                            return;
                        }
                    }
                    
                    // 호스트가 나간 경우
                    if (wasHost) {
                        if (gameState.users.length > 0) {
                            // 새 호스트 지정
                            const newHost = gameState.users[0];
                            newHost.isHost = true;
                            
                            const newHostSocket = socketsInRoom.find(s => s.id === newHost.id);
                            if (newHostSocket) {
                                newHostSocket.isHost = true;
                                room.hostId = newHost.id;
                                room.hostName = newHost.name;
                                newHostSocket.emit('hostTransferred', { 
                                    message: '호스트 권한이 전달되었습니다.',
                                    roomName: room.roomName
                                });
                            }
                            
                            io.to(roomId).emit('updateUsers', gameState.users);
                            io.to(roomId).emit('hostChanged', {
                                newHostId: newHost.id,
                                newHostName: newHost.name,
                                message: `${userName} 호스트가 나갔습니다. ${newHost.name}님이 새 호스트가 되었습니다.`
                            });
                            updateRoomsList();
                        } else {
                            // 모든 사용자가 나감 - 방 삭제
                            // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                            const today = new Date().toISOString().split('T')[0];
                            if (gameState && gameState.history) {
                                const todayGameRecords = gameState.history.filter(record => {
                                    return record.date === today && record.isGameActive === true;
                                });
                                todayGameRecords.forEach(record => {
                                    // 중복 체크 (이미 저장된 기록인지 확인)
                                    const alreadyExists = todayDiceRecords.some(r => 
                                        r.user === record.user && 
                                        r.result === record.result && 
                                        r.time === record.time &&
                                        r.date === record.date
                                    );
                                    if (!alreadyExists) {
                                        todayDiceRecords.push(record);
                                    }
                                });
                            }
                            
                            io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
                            delete rooms[roomId];
                            updateRoomsList();
                            console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
                        }
                    } else {
                        // 일반 사용자 나감
                        io.to(roomId).emit('updateUsers', gameState.users);
                        
                        if (gameState.users.length === 0) {
                            // 모든 사용자가 나감 - 방 삭제
                            // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                            const today = new Date().toISOString().split('T')[0];
                            if (gameState && gameState.history) {
                                const todayGameRecords = gameState.history.filter(record => {
                                    return record.date === today && record.isGameActive === true;
                                });
                                todayGameRecords.forEach(record => {
                                    // 중복 체크 (이미 저장된 기록인지 확인)
                                    const alreadyExists = todayDiceRecords.some(r => 
                                        r.user === record.user && 
                                        r.result === record.result && 
                                        r.time === record.time &&
                                        r.date === record.date
                                    );
                                    if (!alreadyExists) {
                                        todayDiceRecords.push(record);
                                    }
                                });
                            }
                            
                            io.to(roomId).emit('roomDeleted', { message: '모든 사용자가 방을 떠났습니다.' });
                            delete rooms[roomId];
                            updateRoomsList();
                            console.log(`방 삭제: ${room.roomName} (${roomId}) - 모든 사용자 나감`);
                        }
                    }
                } else {
                    console.log(`사용자 ${userName}이(가) 방 ${roomId}에 재연결했습니다.`);
                }
            }, waitTime);
        }
    });

    // 게시판 조회
    socket.on('getSuggestions', async () => {
        try {
            const suggestions = await loadSuggestions();
            console.log(`게시판 조회: ${suggestions.length}개 게시글 로드됨`);
            socket.emit('suggestionsList', suggestions);
        } catch (error) {
            console.error('게시판 조회 오류:', error);
            socket.emit('suggestionsList', []);
        }
    });

    // 게시글 작성
    socket.on('createSuggestion', async (data) => {
        if (!checkRateLimit()) return;
        
        const { userName, title, password, content } = data;
        
        if (!userName || !title || !password || !content) {
            socket.emit('suggestionError', '모든 필드를 입력해주세요.');
            return;
        }

        if (title.trim().length === 0 || content.trim().length === 0 || password.trim().length === 0) {
            socket.emit('suggestionError', '제목, 비밀번호, 내용을 모두 입력해주세요.');
            return;
        }

        if (title.length > 100) {
            socket.emit('suggestionError', '제목은 100자 이하로 입력해주세요.');
            return;
        }

        if (content.length > 2000) {
            socket.emit('suggestionError', '내용은 2000자 이하로 입력해주세요.');
            return;
        }

        if (password.length > 50) {
            socket.emit('suggestionError', '삭제코드는 50자 이하로 입력해주세요.');
            return;
        }

        const newSuggestion = {
            id: Date.now().toString(), // 파일 시스템 폴백용
            userName: userName.trim(),
            title: title.trim(),
            password: password.trim(), // 삭제코드 저장
            content: content.trim(),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            createdAt: new Date().toISOString()
        };

        try {
            const saved = await saveSuggestion(newSuggestion);
            if (saved) {
                // 모든 클라이언트에게 업데이트된 게시판 목록 전송
                const suggestions = await loadSuggestions();
                io.emit('suggestionsList', suggestions);
                const dbType = process.env.DATABASE_URL ? 'Postgres' : '파일 시스템';
                console.log(`게시글 작성 및 저장 완료: ${userName} - ${title} (${dbType})`);
            } else {
                socket.emit('suggestionError', '게시글 저장 중 오류가 발생했습니다!');
                console.error('게시글 저장 실패:', userName, title);
            }
        } catch (error) {
            socket.emit('suggestionError', '게시글 저장 중 오류가 발생했습니다!');
            console.error('게시글 저장 오류:', error);
        }
    });

    // 게시글 삭제
    socket.on('deleteSuggestion', async (data) => {
        if (!checkRateLimit()) return;
        
        const { id, password } = data;
        
        if (!id) {
            socket.emit('suggestionError', '게시글 ID가 필요합니다.');
            return;
        }

        if (!password) {
            socket.emit('suggestionError', '삭제코드를 입력해주세요.');
            return;
        }

        try {
            const result = await deleteSuggestion(id, password);
            
            if (result.success) {
                // 모든 클라이언트에게 업데이트된 게시판 목록 전송
                const suggestions = await loadSuggestions();
                io.emit('suggestionsList', suggestions);
                const dbType = process.env.DATABASE_URL ? 'Postgres' : '파일 시스템';
                console.log(`게시글 삭제 및 저장 완료: ${id} (${dbType})`);
            } else {
                socket.emit('suggestionError', result.error || '게시글 삭제 중 오류가 발생했습니다!');
            }
        } catch (error) {
            socket.emit('suggestionError', '게시글 삭제 중 오류가 발생했습니다!');
            console.error('게시글 삭제 오류:', error);
        }
    });

    // Gemini AI 채팅
    socket.on('geminiChat', async (data) => {
        const { prompt } = data;
        if (!prompt || prompt.trim().length === 0) {
            socket.emit('geminiResponse', { error: '메시지를 입력해주세요.' });
            return;
        }

        try {
            const response = await geminiService.generateResponse(prompt);
            socket.emit('geminiResponse', { text: response });
        } catch (error) {
            console.error('Gemini API 오류:', error);
            socket.emit('geminiResponse', { error: 'AI 응답을 가져오는 중 오류가 발생했습니다.' });
        }
    });
});

// 서버 시작
async function startServer() {
    // 데이터베이스 초기화
    await initDatabase();
    
    server.listen(PORT, '0.0.0.0', async () => {
        console.log('=================================');
        console.log(`🎲 주사위 게임 서버 시작!`);
        console.log(`포트: ${PORT}`);
        console.log('=================================');
        
        // 서버 시작 시 게시판 데이터 로드 확인
        try {
            const suggestions = await loadSuggestions();
            const dbType = process.env.DATABASE_URL ? 'Postgres' : '파일 시스템';
            console.log(`📋 게시판 데이터 로드 완료: ${suggestions.length}개 게시글 (${dbType})`);
        } catch (error) {
            console.error('게시판 데이터 로드 오류:', error);
        }
    
    // 방 유지 시간에 따른 자동 방 삭제 체크 (1분마다 확인)
    setInterval(() => {
        const now = new Date();
        const today = now.toISOString().split('T')[0]; // YYYY-MM-DD 형식
        
        Object.keys(rooms).forEach(roomId => {
            const room = rooms[roomId];
            if (room && room.createdAt && room.expiryHours) {
                const createdAt = new Date(room.createdAt);
                const elapsed = now - createdAt;
                const expiryHoursInMs = room.expiryHours * 60 * 60 * 1000; // 저장된 유지 시간을 밀리초로 변환
                
                if (elapsed >= expiryHoursInMs) {
                    const hasUsers = room.gameState.users.length > 0;
                    console.log(`방 ${roomId} (${room.roomName})이 ${room.expiryHours}시간 경과로 자동 삭제됩니다. (사용자 수: ${room.gameState.users.length})`);
                    
                    // 방 삭제 전에 오늘 날짜의 공식전 기록을 전역 저장소에 저장
                    const gameState = room.gameState;
                    if (gameState && gameState.history) {
                        const todayGameRecords = gameState.history.filter(record => {
                            return record.date === today && record.isGameActive === true;
                        });
                        todayGameRecords.forEach(record => {
                            // 중복 체크 (이미 저장된 기록인지 확인)
                            const alreadyExists = todayDiceRecords.some(r => 
                                r.user === record.user && 
                                r.result === record.result && 
                                r.time === record.time &&
                                r.date === record.date
                            );
                            if (!alreadyExists) {
                                todayDiceRecords.push(record);
                            }
                        });
                    }
                    
                    // 방에 사용자가 있을 때만 삭제 알림 전송
                    if (hasUsers) {
                        io.to(roomId).emit('roomDeleted', {
                            reason: `방이 ${room.expiryHours}시간 경과로 자동 삭제되었습니다.`
                        });
                    }
                    
                    // 방 삭제
                    delete rooms[roomId];
                    
                    // 모든 클라이언트에게 방 목록 업데이트
                    const roomsList = Object.entries(rooms).map(([id, r]) => ({
                        roomId: id,
                        roomName: r.roomName,
                        hostName: r.hostName,
                        playerCount: r.gameState.users.length,
                        isGameActive: r.gameState.isGameActive,
                        isOrderActive: r.gameState.isOrderActive,
                        isPrivate: r.isPrivate || false,
                        gameType: r.gameType || 'dice',
                        createdAt: r.createdAt,
                        expiryHours: r.expiryHours || 1 // 기본값 1시간
                    }));
                    io.emit('roomsListUpdated', roomsList);
                }
            }
        });
    }, 60000); // 1분마다 체크
    });
}

// 서버 시작    
startServer().catch(error => {
    console.error('서버 시작 오류:', error);
    process.exit(1);
});
