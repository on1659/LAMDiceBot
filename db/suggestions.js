// 게시판 CRUD
const fs = require('fs');
const path = require('path');
const { getPool } = require('./pool');

const BOARD_FILE = path.join(__dirname, '..', 'suggestions.json');

async function loadSuggestions() {
    const pool = getPool();
    try {
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

    try {
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
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

async function loadSuggestionsWithPassword(id) {
    const pool = getPool();
    try {
        if (pool) {
            const result = await pool.query(
                'SELECT id::text, password FROM suggestions WHERE id = $1',
                [id]
            );
            if (result.rows.length > 0) {
                return result.rows[0].password;
            }
            return null;
        }
    } catch (error) {
        console.error('Postgres 비밀번호 조회 오류, 파일 시스템으로 폴백:', error);
    }

    try {
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
            const suggestion = suggestions.find(s => s.id === id);
            return suggestion ? suggestion.password : null;
        }
    } catch (error) {
        console.error('게시판 파일 읽기 오류:', error);
    }
    return null;
}

async function saveSuggestion(suggestion) {
    const pool = getPool();
    try {
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

async function deleteSuggestion(id, password) {
    const pool = getPool();
    try {
        if (pool) {
            const checkResult = await pool.query(
                'SELECT password FROM suggestions WHERE id = $1',
                [id]
            );

            if (checkResult.rows.length === 0) {
                return { success: false, error: '게시글을 찾을 수 없습니다.' };
            }

            const suggestionPassword = checkResult.rows[0].password;
            const adminPassword = process.env.ADMIN_PASSWORD || '0000';

            if (password !== suggestionPassword && password !== adminPassword) {
                return { success: false, error: '삭제코드가 일치하지 않습니다.' };
            }

            await pool.query('DELETE FROM suggestions WHERE id = $1', [id]);
            return { success: true };
        }
    } catch (error) {
        console.error('Postgres 삭제 오류, 파일 시스템으로 폴백:', error);
    }

    try {
        if (fs.existsSync(BOARD_FILE)) {
            const data = fs.readFileSync(BOARD_FILE, 'utf8');
            const suggestions = JSON.parse(data);
            const index = suggestions.findIndex(s => s.id === id);

            if (index === -1) {
                return { success: false, error: '게시글을 찾을 수 없습니다.' };
            }

            const suggestionPassword = suggestions[index].password;
            const adminPassword = process.env.ADMIN_PASSWORD || '0000';

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

module.exports = { loadSuggestions, loadSuggestionsWithPassword, saveSuggestion, deleteSuggestion };
