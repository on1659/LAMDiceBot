// 게시판 & Gemini AI 소켓 핸들러
const { loadSuggestions, saveSuggestion, deleteSuggestion } = require('../db/suggestions');
const geminiService = require('../gemini-utils');

module.exports = function registerBoardHandlers(socket, io, ctx) {
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
        if (!ctx.checkRateLimit()) return;

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
            id: Date.now().toString(),
            userName: userName.trim(),
            title: title.trim(),
            password: password.trim(),
            content: content.trim(),
            date: new Date().toISOString().split('T')[0],
            time: new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' }),
            createdAt: new Date().toISOString()
        };

        try {
            const saved = await saveSuggestion(newSuggestion);
            if (saved) {
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
        if (!ctx.checkRateLimit()) return;

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
};
