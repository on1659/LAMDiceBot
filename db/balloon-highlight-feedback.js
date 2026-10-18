// 둥둥라이더 Jev 하이라이트 반응(👍/👎·GIF 저장) — 데구리와 같은 틀(db/deguri-highlight-feedback.js create), 표만 balloon_highlight_feedback(db/init.js).
// 사실·가중치 항목은 socket/balloon-highlight.js 것 — 코드 점수(후보 고르기·Jev 가 없을 때 고르기)의 가중치 배율로 돌아간다.
const { create } = require('./deguri-highlight-feedback');
const { FEATURES, featuresOf } = require('../socket/balloon-highlight');

module.exports = create('balloon_highlight_feedback', FEATURES, featuresOf, '풍선');
