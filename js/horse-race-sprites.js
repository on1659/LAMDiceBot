function getVehicleSVG(vehicleId) {
    const svgMap = {
        'car': { // 자동차 - 바퀴 회전
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#e74c3c"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#e74c3c"/>
                    <rect x="20" y="10" width="8" height="8" fill="#87CEEB"/>
                    <rect x="30" y="10" width="8" height="8" fill="#87CEEB"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#666"/>
                    <line x1="18" y1="29" x2="18" y2="35" stroke="#999" stroke-width="1"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#666"/>
                    <line x1="42" y1="29" x2="42" y2="35" stroke="#999" stroke-width="1"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#e74c3c"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#e74c3c"/>
                    <rect x="20" y="10" width="8" height="8" fill="#87CEEB"/>
                    <rect x="30" y="10" width="8" height="8" fill="#87CEEB"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#666"/>
                    <line x1="15" y1="32" x2="21" y2="32" stroke="#999" stroke-width="1"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#666"/>
                    <line x1="39" y1="32" x2="45" y2="32" stroke="#999" stroke-width="1"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#a93226"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#a93226"/>
                    <rect x="20" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <rect x="30" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#555"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#555"/>
                    <text x="24" y="8" font-size="8" fill="#fff">z</text>
                    <text x="28" y="5" font-size="6" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <rect x="10" y="15" width="40" height="15" rx="3" fill="#a93226"/>
                    <rect x="18" y="8" width="22" height="12" rx="2" fill="#a93226"/>
                    <rect x="20" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <rect x="30" y="10" width="8" height="8" fill="#5a8fa8"/>
                    <circle cx="18" cy="32" r="6" fill="#333"/><circle cx="18" cy="32" r="3" fill="#555"/>
                    <circle cx="42" cy="32" r="6" fill="#333"/><circle cx="42" cy="32" r="3" fill="#555"/>
                    <text x="26" y="6" font-size="8" fill="#fff">z</text>
                    <text x="30" y="3" font-size="6" fill="#fff">z</text>
                </svg>`
            }
        },
        'rocket': { // 로켓 - 불꽃 깜빡임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="22" rx="18" ry="10" fill="#3498db"/>
                    <polygon points="53,22 60,15 60,29" fill="#e74c3c"/>
                    <circle cx="50" cy="22" r="4" fill="#87CEEB"/>
                    <rect x="8" y="18" width="10" height="8" fill="#e74c3c"/>
                    <polygon points="8,22 2,18 2,26" fill="#f39c12"/>
                    <polygon points="2,22 -3,20 -3,24" fill="#e67e22"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="22" rx="18" ry="10" fill="#3498db"/>
                    <polygon points="53,22 60,15 60,29" fill="#e74c3c"/>
                    <circle cx="50" cy="22" r="4" fill="#87CEEB"/>
                    <rect x="8" y="18" width="10" height="8" fill="#e74c3c"/>
                    <polygon points="8,22 0,16 0,28" fill="#f1c40f"/>
                    <polygon points="0,22 -5,19 -5,25" fill="#f39c12"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="28" rx="18" ry="10" fill="#2980b9"/>
                    <polygon points="53,28 60,21 60,35" fill="#c0392b"/>
                    <circle cx="50" cy="28" r="4" fill="#5a8fa8"/>
                    <rect x="8" y="24" width="10" height="8" fill="#c0392b"/>
                    <rect x="20" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <rect x="38" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <text x="24" y="20" font-size="8" fill="#fff">z</text>
                    <text x="28" y="16" font-size="6" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="35" cy="28" rx="18" ry="10" fill="#2980b9"/>
                    <polygon points="53,28 60,21 60,35" fill="#c0392b"/>
                    <circle cx="50" cy="28" r="4" fill="#5a8fa8"/>
                    <rect x="8" y="24" width="10" height="8" fill="#c0392b"/>
                    <rect x="20" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <rect x="38" y="38" width="8" height="4" fill="#7f8c8d"/>
                    <text x="26" y="18" font-size="8" fill="#fff">z</text>
                    <text x="30" y="14" font-size="6" fill="#fff">z</text>
                </svg>`
            }
        },
        'bird': { // 새 - 날개 펄럭임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="15" ry="8" fill="#9b59b6"/>
                    <circle cx="48" cy="22" r="7" fill="#9b59b6"/>
                    <polygon points="55,22 62,20 62,24" fill="#f39c12"/>
                    <circle cx="52" cy="20" r="2" fill="black"/>
                    <path d="M25,25 Q15,10 30,18" fill="#8e44ad"/>
                    <path d="M35,25 Q25,8 40,16" fill="#8e44ad"/>
                    <polygon points="12,28 8,32 15,30" fill="#9b59b6"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="15" ry="8" fill="#9b59b6"/>
                    <circle cx="48" cy="22" r="7" fill="#9b59b6"/>
                    <polygon points="55,22 62,20 62,24" fill="#f39c12"/>
                    <circle cx="52" cy="20" r="2" fill="black"/>
                    <path d="M25,25 Q15,35 30,30" fill="#8e44ad"/>
                    <path d="M35,25 Q25,38 40,32" fill="#8e44ad"/>
                    <polygon points="12,28 8,32 15,30" fill="#9b59b6"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="15" ry="8" fill="#8e44ad"/>
                    <circle cx="48" cy="28" r="7" fill="#8e44ad"/>
                    <polygon points="55,28 62,26 62,30" fill="#d68910"/>
                    <ellipse cx="52" cy="26" rx="2" ry="1" fill="black"/>
                    <path d="M22,30 Q18,28 16,32" fill="#7d3c98"/>
                    <path d="M38,30 Q42,28 44,32" fill="#7d3c98"/>
                    <ellipse cx="20" cy="38" rx="4" ry="2" fill="#d68910"/>
                    <ellipse cx="40" cy="38" rx="4" ry="2" fill="#d68910"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="15" ry="8" fill="#8e44ad"/>
                    <circle cx="48" cy="29" r="7" fill="#8e44ad"/>
                    <polygon points="55,29 62,27 62,31" fill="#d68910"/>
                    <ellipse cx="52" cy="27" rx="2" ry="1" fill="black"/>
                    <path d="M22,31 Q18,29 16,33" fill="#7d3c98"/>
                    <path d="M38,31 Q42,29 44,33" fill="#7d3c98"/>
                    <ellipse cx="20" cy="39" rx="4" ry="2" fill="#d68910"/>
                    <ellipse cx="40" cy="39" rx="4" ry="2" fill="#d68910"/>
                </svg>`
            }
        },
        'boat': { // 보트 - 물결 효과
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,30 Q15,28 25,30 Q35,32 45,30 Q55,28 60,30" fill="none" stroke="#3498db" stroke-width="3"/>
                    <polygon points="10,28 50,28 45,20 15,20" fill="#e74c3c"/>
                    <rect x="28" y="10" width="4" height="12" fill="#8b4513"/>
                    <polygon points="32,8 32,18 50,14" fill="white"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,30 Q15,32 25,30 Q35,28 45,30 Q55,32 60,30" fill="none" stroke="#3498db" stroke-width="3"/>
                    <polygon points="10,28 50,28 45,20 15,20" fill="#e74c3c"/>
                    <rect x="28" y="10" width="4" height="12" fill="#8b4513"/>
                    <polygon points="32,8 32,18 50,14" fill="white"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,32 Q15,32 25,32 Q35,32 45,32 Q55,32 60,32" fill="none" stroke="#2980b9" stroke-width="3"/>
                    <polygon points="10,30 50,30 45,22 15,22" fill="#a93226"/>
                    <rect x="28" y="14" width="4" height="10" fill="#6d4c41"/>
                    <polygon points="32,14 32,20 38,18" fill="#bdc3c7"/>
                    <circle cx="48" cy="26" r="3" fill="#7f8c8d"/>
                    <text x="20" y="18" font-size="8" fill="#fff">z</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <path d="M5,32 Q15,32 25,32 Q35,32 45,32 Q55,32 60,32" fill="none" stroke="#2980b9" stroke-width="3"/>
                    <polygon points="10,30 50,30 45,22 15,22" fill="#a93226"/>
                    <rect x="28" y="14" width="4" height="10" fill="#6d4c41"/>
                    <polygon points="32,14 32,20 38,18" fill="#bdc3c7"/>
                    <circle cx="48" cy="26" r="3" fill="#7f8c8d"/>
                    <text x="22" y="16" font-size="8" fill="#fff">z</text>
                </svg>`
            }
        },
        'bicycle': { // 자전거 - 페달 회전
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <circle cx="48" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <line x1="12" y1="30" x2="30" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="48" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="35" y2="15" stroke="#666" stroke-width="2"/>
                    <circle cx="35" cy="13" r="4" fill="#f39c12"/>
                    <circle cx="30" cy="30" r="3" fill="#333"/>
                    <line x1="30" y1="30" x2="33" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="30" y1="30" x2="27" y2="25" stroke="#333" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <circle cx="48" cy="30" r="8" fill="none" stroke="#333" stroke-width="2"/>
                    <line x1="12" y1="30" x2="30" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="48" y2="30" stroke="#666" stroke-width="2"/>
                    <line x1="30" y1="30" x2="35" y2="15" stroke="#666" stroke-width="2"/>
                    <circle cx="35" cy="13" r="4" fill="#f39c12"/>
                    <circle cx="30" cy="30" r="3" fill="#333"/>
                    <line x1="30" y1="30" x2="27" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="30" y1="30" x2="33" y2="25" stroke="#333" stroke-width="2"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="35" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <circle cx="45" cy="32" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <line x1="15" y1="35" x2="30" y2="30" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="45" y2="32" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="38" y2="18" stroke="#555" stroke-width="2"/>
                    <rect x="36" y="15" width="8" height="4" rx="1" fill="#555"/>
                    <circle cx="30" cy="30" r="3" fill="#444"/>
                    <line x1="30" y1="30" x2="30" y2="36" stroke="#444" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="35" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <circle cx="45" cy="32" r="8" fill="none" stroke="#555" stroke-width="2"/>
                    <line x1="15" y1="35" x2="30" y2="30" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="45" y2="32" stroke="#555" stroke-width="2"/>
                    <line x1="30" y1="30" x2="38" y2="18" stroke="#555" stroke-width="2"/>
                    <rect x="36" y="15" width="8" height="4" rx="1" fill="#555"/>
                    <circle cx="30" cy="30" r="3" fill="#444"/>
                    <line x1="30" y1="30" x2="30" y2="36" stroke="#444" stroke-width="2"/>
                </svg>`
            }
        },
        'rabbit': { // 토끼 - 깡충깡충
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="14" ry="10" fill="#f5f5dc"/>
                    <circle cx="45" cy="22" r="8" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="8" rx="3" ry="10" fill="#f5f5dc"/>
                    <ellipse cx="48" cy="10" rx="3" ry="9" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="10" rx="2" ry="6" fill="#ffb6c1"/>
                    <ellipse cx="48" cy="12" rx="2" ry="5" fill="#ffb6c1"/>
                    <circle cx="50" cy="20" r="2" fill="black"/>
                    <circle cx="47" cy="26" r="2" fill="#ffb6c1"/>
                    <ellipse cx="18" cy="32" rx="5" ry="4" fill="#f5f5dc"/>
                    <ellipse cx="25" cy="35" rx="4" ry="3" fill="#f5f5dc"/>
                    <circle cx="14" cy="30" r="4" fill="#f5f5dc"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="24" rx="14" ry="10" fill="#f5f5dc"/>
                    <circle cx="45" cy="18" r="8" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="4" rx="3" ry="10" fill="#f5f5dc"/>
                    <ellipse cx="48" cy="6" rx="3" ry="9" fill="#f5f5dc"/>
                    <ellipse cx="40" cy="6" rx="2" ry="6" fill="#ffb6c1"/>
                    <ellipse cx="48" cy="8" rx="2" ry="5" fill="#ffb6c1"/>
                    <circle cx="50" cy="16" r="2" fill="black"/>
                    <circle cx="47" cy="22" r="2" fill="#ffb6c1"/>
                    <ellipse cx="20" cy="38" rx="5" ry="4" fill="#f5f5dc"/>
                    <ellipse cx="28" cy="40" rx="4" ry="3" fill="#f5f5dc"/>
                    <circle cx="14" cy="35" r="4" fill="#f5f5dc"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="16" ry="8" fill="#ddd8c4"/>
                    <circle cx="46" cy="28" r="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="18" rx="3" ry="8" fill="#ddd8c4"/>
                    <ellipse cx="48" cy="20" rx="3" ry="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="20" rx="2" ry="5" fill="#e8b4b8"/>
                    <ellipse cx="48" cy="22" rx="2" ry="4" fill="#e8b4b8"/>
                    <ellipse cx="50" cy="27" rx="2" ry="1" fill="black"/>
                    <circle cx="47" cy="32" r="2" fill="#e8b4b8"/>
                    <ellipse cx="18" cy="36" rx="5" ry="3" fill="#ddd8c4"/>
                    <ellipse cx="26" cy="38" rx="4" ry="2" fill="#ddd8c4"/>
                    <circle cx="12" cy="34" r="4" fill="#ddd8c4"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="16" ry="8" fill="#ddd8c4"/>
                    <circle cx="46" cy="29" r="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="19" rx="3" ry="8" fill="#ddd8c4"/>
                    <ellipse cx="48" cy="21" rx="3" ry="7" fill="#ddd8c4"/>
                    <ellipse cx="42" cy="21" rx="2" ry="5" fill="#e8b4b8"/>
                    <ellipse cx="48" cy="23" rx="2" ry="4" fill="#e8b4b8"/>
                    <ellipse cx="50" cy="28" rx="2" ry="1" fill="black"/>
                    <circle cx="47" cy="33" r="2" fill="#e8b4b8"/>
                    <ellipse cx="18" cy="37" rx="5" ry="3" fill="#ddd8c4"/>
                    <ellipse cx="26" cy="39" rx="4" ry="2" fill="#ddd8c4"/>
                    <circle cx="12" cy="35" r="4" fill="#ddd8c4"/>
                </svg>`
            }
        },
        'turtle': { // 거북이 - 느릿느릿
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="18" ry="12" fill="#228B22"/>
                    <path d="M15,20 Q30,10 45,20" fill="#006400"/>
                    <ellipse cx="50" cy="28" rx="6" ry="5" fill="#8FBC8F"/>
                    <circle cx="54" cy="26" r="2" fill="black"/>
                    <ellipse cx="18" cy="36" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="42" cy="36" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="20" cy="24" rx="3" ry="2" fill="#8FBC8F"/>
                    <ellipse cx="40" cy="24" rx="3" ry="2" fill="#8FBC8F"/>
                    <circle cx="10" cy="30" r="3" fill="#8FBC8F"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="28" rx="18" ry="12" fill="#228B22"/>
                    <path d="M15,20 Q30,10 45,20" fill="#006400"/>
                    <ellipse cx="52" cy="28" rx="6" ry="5" fill="#8FBC8F"/>
                    <circle cx="56" cy="26" r="2" fill="black"/>
                    <ellipse cx="16" cy="38" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="40" cy="38" rx="4" ry="3" fill="#8FBC8F"/>
                    <ellipse cx="22" cy="22" rx="3" ry="2" fill="#8FBC8F"/>
                    <ellipse cx="42" cy="22" rx="3" ry="2" fill="#8FBC8F"/>
                    <circle cx="8" cy="32" r="3" fill="#8FBC8F"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="30" rx="18" ry="12" fill="#1e7b1e"/>
                    <path d="M15,22 Q30,12 45,22" fill="#005500"/>
                    <ellipse cx="46" cy="32" rx="4" ry="3" fill="#7aa87a"/>
                    <circle cx="10" cy="32" r="2" fill="#7aa87a"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="31" rx="18" ry="12" fill="#1e7b1e"/>
                    <path d="M15,23 Q30,13 45,23" fill="#005500"/>
                    <ellipse cx="46" cy="33" rx="4" ry="3" fill="#7aa87a"/>
                    <circle cx="10" cy="33" r="2" fill="#7aa87a"/>
                </svg>`
            }
        },
        'eagle': { // 독수리 - 날개 펄럭임
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="12" ry="7" fill="#8B4513"/>
                    <circle cx="48" cy="22" r="7" fill="#8B4513"/>
                    <polygon points="55,22 63,20 63,24" fill="#FFD700"/>
                    <polygon points="55,22 63,22 58,25" fill="#DAA520"/>
                    <circle cx="52" cy="19" r="2" fill="black"/>
                    <path d="M22,25 Q5,8 28,18" fill="#654321"/>
                    <path d="M35,25 Q55,5 40,18" fill="#654321"/>
                    <polygon points="15,28 10,32 18,30" fill="#8B4513"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="25" rx="12" ry="7" fill="#8B4513"/>
                    <circle cx="48" cy="22" r="7" fill="#8B4513"/>
                    <polygon points="55,22 63,20 63,24" fill="#FFD700"/>
                    <polygon points="55,22 63,22 58,25" fill="#DAA520"/>
                    <circle cx="52" cy="19" r="2" fill="black"/>
                    <path d="M22,25 Q5,38 28,32" fill="#654321"/>
                    <path d="M35,25 Q55,40 40,32" fill="#654321"/>
                    <polygon points="15,28 10,32 18,30" fill="#8B4513"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="32" rx="12" ry="7" fill="#7a3d10"/>
                    <circle cx="46" cy="28" r="7" fill="#7a3d10"/>
                    <polygon points="53,28 60,26 60,30" fill="#d4a017"/>
                    <polygon points="53,28 60,28 56,31" fill="#b8860b"/>
                    <ellipse cx="50" cy="26" rx="2" ry="1" fill="black"/>
                    <path d="M22,30 Q18,28 16,32" fill="#5a3520"/>
                    <path d="M38,30 Q42,28 44,32" fill="#5a3520"/>
                    <ellipse cx="22" cy="38" rx="4" ry="2" fill="#d4a017"/>
                    <ellipse cx="38" cy="38" rx="4" ry="2" fill="#d4a017"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <ellipse cx="30" cy="33" rx="12" ry="7" fill="#7a3d10"/>
                    <circle cx="46" cy="29" r="7" fill="#7a3d10"/>
                    <polygon points="53,29 60,27 60,31" fill="#d4a017"/>
                    <polygon points="53,29 60,29 56,32" fill="#b8860b"/>
                    <ellipse cx="50" cy="27" rx="2" ry="1" fill="black"/>
                    <path d="M22,31 Q18,29 16,33" fill="#5a3520"/>
                    <path d="M38,31 Q42,29 44,33" fill="#5a3520"/>
                    <ellipse cx="22" cy="39" rx="4" ry="2" fill="#d4a017"/>
                    <ellipse cx="38" cy="39" rx="4" ry="2" fill="#d4a017"/>
                </svg>`
            }
        },
        'scooter': { // 킥보드 - 바퀴 회전 (오른쪽 방향)
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="35" r="6" fill="#333"/>
                    <circle cx="48" cy="35" r="6" fill="#333"/>
                    <line x1="48" y1="35" x2="48" y2="15" stroke="#666" stroke-width="3"/>
                    <line x1="12" y1="35" x2="48" y2="35" stroke="#333" stroke-width="2"/>
                    <rect x="42" y="12" width="10" height="4" rx="2" fill="#666"/>
                    <circle cx="25" cy="20" r="5" fill="#3498db"/>
                    <line x1="25" y1="25" x2="25" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="22" y2="42" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="28" y2="42" stroke="#333" stroke-width="2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="12" cy="35" r="6" fill="#333"/>
                    <circle cx="48" cy="35" r="6" fill="#333"/>
                    <line x1="48" y1="35" x2="48" y2="15" stroke="#666" stroke-width="3"/>
                    <line x1="12" y1="35" x2="48" y2="35" stroke="#333" stroke-width="2"/>
                    <rect x="42" y="12" width="10" height="4" rx="2" fill="#666"/>
                    <circle cx="25" cy="20" r="5" fill="#3498db"/>
                    <line x1="25" y1="25" x2="25" y2="35" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="28" y2="42" stroke="#333" stroke-width="2"/>
                    <line x1="25" y1="35" x2="22" y2="42" stroke="#333" stroke-width="2"/>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="38" r="6" fill="#444"/>
                    <circle cx="45" cy="38" r="6" fill="#444"/>
                    <line x1="45" y1="38" x2="40" y2="20" stroke="#555" stroke-width="3"/>
                    <line x1="15" y1="38" x2="45" y2="38" stroke="#444" stroke-width="2"/>
                    <rect x="35" y="17" width="8" height="4" rx="2" fill="#555"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <circle cx="15" cy="38" r="6" fill="#444"/>
                    <circle cx="45" cy="38" r="6" fill="#444"/>
                    <line x1="45" y1="38" x2="40" y2="20" stroke="#555" stroke-width="3"/>
                    <line x1="15" y1="38" x2="45" y2="38" stroke="#444" stroke-width="2"/>
                    <rect x="35" y="17" width="8" height="4" rx="2" fill="#555"/>
                </svg>`
            }
        },
        'helicopter': { // 헬리콥터 - 프로펠러 회전 (좌우반전)
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="25" rx="18" ry="10" fill="#e74c3c"/>
                        <rect x="45" y="22" width="15" height="4" fill="#c0392b"/>
                        <polygon points="58,20 62,24 58,28" fill="#c0392b"/>
                        <circle cx="40" cy="22" r="5" fill="#87CEEB"/>
                        <line x1="30" y1="15" x2="30" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="15" y1="10" x2="45" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="25" y1="35" x2="25" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="35" y1="35" x2="35" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="40" x2="40" y2="40" stroke="#333" stroke-width="2"/>
                    </g>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="25" rx="18" ry="10" fill="#e74c3c"/>
                        <rect x="45" y="22" width="15" height="4" fill="#c0392b"/>
                        <polygon points="58,20 62,24 58,28" fill="#c0392b"/>
                        <circle cx="40" cy="22" r="5" fill="#87CEEB"/>
                        <line x1="30" y1="15" x2="30" y2="10" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="8" x2="40" y2="12" stroke="#333" stroke-width="2"/>
                        <line x1="25" y1="35" x2="25" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="35" y1="35" x2="35" y2="40" stroke="#333" stroke-width="2"/>
                        <line x1="20" y1="40" x2="40" y2="40" stroke="#333" stroke-width="2"/>
                    </g>
                </svg>`
            },
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="28" rx="18" ry="10" fill="#a93226"/>
                        <rect x="45" y="25" width="15" height="4" fill="#922b21"/>
                        <polygon points="58,23 62,27 58,31" fill="#922b21"/>
                        <circle cx="40" cy="25" r="5" fill="#5a8fa8"/>
                        <line x1="30" y1="18" x2="30" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="22" y1="14" x2="38" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="25" y1="38" x2="25" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="35" y1="38" x2="35" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="20" y1="42" x2="40" y2="42" stroke="#444" stroke-width="2"/>
                    </g>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <g transform="translate(60, 0) scale(-1, 1)">
                        <ellipse cx="30" cy="28" rx="18" ry="10" fill="#a93226"/>
                        <rect x="45" y="25" width="15" height="4" fill="#922b21"/>
                        <polygon points="58,23 62,27 58,31" fill="#922b21"/>
                        <circle cx="40" cy="25" r="5" fill="#5a8fa8"/>
                        <line x1="30" y1="18" x2="30" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="22" y1="14" x2="38" y2="14" stroke="#444" stroke-width="2"/>
                        <line x1="25" y1="38" x2="25" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="35" y1="38" x2="35" y2="42" stroke="#444" stroke-width="2"/>
                        <line x1="20" y1="42" x2="40" y2="42" stroke="#444" stroke-width="2"/>
                    </g>
                </svg>`
            }
        },
        'horse': { // 말 - 상태별 애니메이션
            // === 대기 모션 (idle) - 제자리에서 발구르기, 머리 위아래 ===
            idle: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (모두 땅) -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (살짝 높이) -->
                    <path d="M16,26 Q20,17 24,19 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 - 살짝 들림, 발구르기) -->
                    <path d="M22,26 L21,36 L19,38 L23,38 Z" fill="#654321"/>
                    <ellipse cx="20" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 - 땅) -->
                    <path d="M18,26 L17,38 L15,40 L19,40 Z" fill="#654321"/>
                    <ellipse cx="16" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (높은 위치) -->
                    <ellipse cx="46" cy="16" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="14" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,10 Q42,4 44,8 Q42,6 40,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,10 Q45,4 47,8 Q45,6 43,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (정면 응시) -->
                    <circle cx="48" cy="15" r="1.8" fill="white"/>
                    <circle cx="49" cy="15" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="17" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="17" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,18 Q22,12 24,14 Q26,12 28,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,16 Q24,10 26,12 Q28,10 30,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,26 Q13,28 10,32 Q8,36 7,38" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,27 Q12,30 9,34 Q7,37 6,40" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (모두 땅) -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="27" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (살짝 낮게) -->
                    <path d="M16,27 Q20,19 24,21 Q26,23 28,27" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 - 땅으로 내림, 발구르기 쿵) -->
                    <path d="M22,27 L21,38 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 - 땅) -->
                    <path d="M18,27 L17,38 L15,40 L19,40 Z" fill="#654321"/>
                    <ellipse cx="16" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (낮은 위치 - 끄덕) -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="49" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (살짝 흔들림) -->
                    <path d="M16,27 Q13,29 11,33 Q9,37 8,40" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,28 Q14,30 12,34 Q10,38 10,42" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`
            },
            // === 쉬는 모션 (rest) - 앉아서 쉬기 ===
            rest: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (접힌 상태) -->
                    <ellipse cx="32" cy="36" rx="6" ry="4" fill="#654321"/>
                    <ellipse cx="26" cy="38" rx="5" ry="3" fill="#654321"/>
                    <!-- 몸통 (낮게) -->
                    <ellipse cx="28" cy="32" rx="14" ry="8" fill="#7a3d10"/>
                    <!-- 목 (낮게) -->
                    <path d="M16,32 Q22,26 28,28 Q32,30 34,32" fill="#7a3d10"/>
                    <!-- 앞다리 (접힌 상태) -->
                    <ellipse cx="20" cy="38" rx="5" ry="3" fill="#5a3520"/>
                    <ellipse cx="14" cy="36" rx="4" ry="3" fill="#5a3520"/>
                    <!-- 머리 (낮게, 눈 감은 상태) -->
                    <ellipse cx="42" cy="24" rx="8" ry="7" fill="#7a3d10"/>
                    <ellipse cx="44" cy="22" rx="5" ry="4" fill="#8b5a2b"/>
                    <!-- 귀 (늘어진) -->
                    <path d="M36,18 Q37,14 39,16" fill="#5a3520"/>
                    <path d="M39,18 Q40,14 42,16" fill="#5a3520"/>
                    <!-- 눈 (감은 상태) -->
                    <path d="M44,22 Q46,21 48,22" stroke="black" stroke-width="1.5" fill="none"/>
                    <!-- 코 -->
                    <ellipse cx="49" cy="25" rx="2.5" ry="2" fill="#5a3520"/>
                    <!-- 갈기 (늘어진) -->
                    <path d="M22,26 Q24,22 26,24" fill="#5a3520"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,32 Q12,34 10,38 Q8,40 8,42" fill="none" stroke="#5a3520" stroke-width="1.5"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (접힌 상태) -->
                    <ellipse cx="32" cy="37" rx="6" ry="4" fill="#654321"/>
                    <ellipse cx="26" cy="39" rx="5" ry="3" fill="#654321"/>
                    <!-- 몸통 (낮게, 호흡) -->
                    <ellipse cx="28" cy="33" rx="14" ry="7" fill="#7a3d10"/>
                    <!-- 목 (낮게) -->
                    <path d="M16,33 Q22,27 28,29 Q32,31 34,33" fill="#7a3d10"/>
                    <!-- 앞다리 (접힌 상태) -->
                    <ellipse cx="20" cy="39" rx="5" ry="3" fill="#5a3520"/>
                    <ellipse cx="14" cy="37" rx="4" ry="3" fill="#5a3520"/>
                    <!-- 머리 (낮게, 눈 감은 상태) -->
                    <ellipse cx="42" cy="25" rx="8" ry="7" fill="#7a3d10"/>
                    <ellipse cx="44" cy="23" rx="5" ry="4" fill="#8b5a2b"/>
                    <!-- 귀 (늘어진) -->
                    <path d="M36,19 Q37,15 39,17" fill="#5a3520"/>
                    <path d="M39,19 Q40,15 42,17" fill="#5a3520"/>
                    <!-- 눈 (감은 상태) -->
                    <path d="M44,23 Q46,22 48,23" stroke="black" stroke-width="1.5" fill="none"/>
                    <!-- 코 -->
                    <ellipse cx="49" cy="26" rx="2.5" ry="2" fill="#5a3520"/>
                    <!-- 갈기 (늘어진) -->
                    <path d="M22,27 Q24,23 26,25" fill="#5a3520"/>
                    <!-- 꼬리 (늘어진) -->
                    <path d="M16,33 Q12,35 10,39 Q8,41 8,43" fill="none" stroke="#5a3520" stroke-width="1.5"/>
                </svg>`
            },
            // === 달리기 모션 (run) - 기존 유지 ===
            run: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (오른쪽 뒤 - 들림) -->
                    <path d="M38,28 L40,32 L38,34 L36,34 Z" fill="#654321"/>
                    <ellipse cx="37" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 뒷다리 (왼쪽 뒤 - 땅) -->
                    <path d="M32,28 L34,38 L32,40 L30,40 Z" fill="#654321"/>
                    <ellipse cx="31" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,26 Q20,18 24,20 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 앞 - 땅) -->
                    <path d="M22,26 L20,38 L18,40 L22,40 Z" fill="#654321"/>
                    <ellipse cx="19" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 앞 - 들림) -->
                    <path d="M18,26 L16,32 L14,34 L18,34 Z" fill="#654321"/>
                    <ellipse cx="15" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (왼쪽) -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 귀 (오른쪽) -->
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="48" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (더 풍성하게) -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18 Q26,16 24,20" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16 Q28,14 26,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M24,16 Q26,10 28,12 Q30,10 32,14 Q30,12 28,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (더 자연스럽게) -->
                    <path d="M16,26 Q12,22 8,18 Q4,14 2,10" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                    <path d="M14,24 Q10,20 6,16 Q2,12 0,8" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (오른쪽 뒤 - 땅) -->
                    <path d="M38,28 L40,38 L38,40 L36,40 Z" fill="#654321"/>
                    <ellipse cx="37" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 뒷다리 (왼쪽 뒤 - 들림) -->
                    <path d="M32,28 L34,32 L32,34 L30,34 Z" fill="#654321"/>
                    <ellipse cx="31" cy="34" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="24" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,24 Q20,16 24,18 Q26,20 28,24" fill="#8B4513"/>
                    <!-- 앞다리 (오른쪽 앞 - 들림) -->
                    <path d="M22,24 L20,30 L18,32 L22,32 Z" fill="#654321"/>
                    <ellipse cx="19" cy="32" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 앞다리 (왼쪽 앞 - 땅) -->
                    <path d="M18,24 L16,38 L14,40 L18,40 Z" fill="#654321"/>
                    <ellipse cx="15" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="16" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="14" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (왼쪽) -->
                    <path d="M40,10 Q42,4 44,8 Q42,6 40,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 귀 (오른쪽) -->
                    <path d="M43,10 Q45,4 47,8 Q45,6 43,10" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="15" r="1.8" fill="white"/>
                    <circle cx="48" cy="15" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="17" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="17" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (더 풍성하게) -->
                    <path d="M20,18 Q22,12 24,14 Q26,12 28,16 Q26,14 24,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,16 Q24,10 26,12 Q28,10 30,14 Q28,12 26,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M24,14 Q26,8 28,10 Q30,8 32,12 Q30,10 28,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (더 자연스럽게) -->
                    <path d="M16,24 Q12,20 8,16 Q4,12 2,8" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                    <path d="M14,22 Q10,18 6,14 Q2,10 0,6" fill="#654321" stroke="#2C1810" stroke-width="0.5"/>
                </svg>`
            },
            // === 도착 모션 (finish) - 감속, 천천히 걷기 ===
            finish: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (살짝만 움직임) -->
                    <path d="M36,28 L37,37 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,38 L29,40 L27,40 Z" fill="#654321"/>
                    <ellipse cx="28" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="26" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 (약간 높이) -->
                    <path d="M16,26 Q20,18 24,20 Q26,22 28,26" fill="#8B4513"/>
                    <!-- 앞다리 (천천히 걷는 자세) -->
                    <path d="M22,26 L21,37 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M18,26 L16,36 L14,38 L18,38 Z" fill="#654321"/>
                    <ellipse cx="15" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 (정면 약간 위) -->
                    <ellipse cx="46" cy="17" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="15" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,11 Q42,5 44,9 Q42,7 40,11" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,11 Q45,5 47,9 Q45,7 43,11" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (편안한 표정) -->
                    <circle cx="48" cy="16" r="1.8" fill="white"/>
                    <circle cx="48.5" cy="16" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="18" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="18" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 (살짝 흔들림) -->
                    <path d="M20,19 Q22,13 24,15 Q26,13 28,17" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,17 Q24,11 26,13 Q28,11 30,15" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (자연스럽게 늘어짐) -->
                    <path d="M16,26 Q13,28 10,30 Q8,34 7,38" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,27 Q12,30 9,33 Q7,36 6,40" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 -->
                    <path d="M36,28 L37,38 L35,40 L33,40 Z" fill="#654321"/>
                    <ellipse cx="34" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,28 L31,36 L29,38 L27,38 Z" fill="#654321"/>
                    <ellipse cx="28" cy="38" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="28" cy="27" rx="12" ry="7" fill="#8B4513"/>
                    <!-- 목 -->
                    <path d="M16,27 Q20,19 24,21 Q26,23 28,27" fill="#8B4513"/>
                    <!-- 앞다리 -->
                    <path d="M22,27 L21,38 L19,40 L23,40 Z" fill="#654321"/>
                    <ellipse cx="20" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M18,27 L16,37 L14,40 L18,40 Z" fill="#654321"/>
                    <ellipse cx="15" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 머리 -->
                    <ellipse cx="46" cy="18" rx="8" ry="7" fill="#8B4513"/>
                    <ellipse cx="48" cy="16" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M40,12 Q42,6 44,10 Q42,8 40,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M43,12 Q45,6 47,10 Q45,8 43,12" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 -->
                    <circle cx="48" cy="17" r="1.8" fill="white"/>
                    <circle cx="48.5" cy="17" r="1.2" fill="black"/>
                    <!-- 코 -->
                    <ellipse cx="53" cy="19" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="54" cy="19" rx="1" ry="0.8" fill="#2C1810"/>
                    <!-- 갈기 -->
                    <path d="M20,20 Q22,14 24,16 Q26,14 28,18" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M22,18 Q24,12 26,14 Q28,12 30,16" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 -->
                    <path d="M16,27 Q13,29 10,32 Q8,36 7,40" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M16,28 Q12,31 9,35 Q7,38 6,42" fill="none" stroke="#654321" stroke-width="1.2"/>
                </svg>`
            },
            // === 승리 모션 (victory) - 앞발 들고 히힝! + 왕관 ===
            victory: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (땅에 버티기) -->
                    <path d="M36,30 L38,38 L36,40 L34,40 Z" fill="#654321"/>
                    <ellipse cx="35" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,30 L32,38 L30,40 L28,40 Z" fill="#654321"/>
                    <ellipse cx="29" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 (뒤로 기울어짐) -->
                    <ellipse cx="30" cy="26" rx="12" ry="7" fill="#8B4513" transform="rotate(-15,30,26)"/>
                    <!-- 목 (높이 들어올림) -->
                    <path d="M22,22 Q24,12 28,14 Q30,16 32,22" fill="#8B4513"/>
                    <!-- 앞다리 (들어올림! 히힝!) -->
                    <path d="M26,20 L22,14 L20,12 L24,14 Z" fill="#654321"/>
                    <ellipse cx="21" cy="12" rx="2" ry="2.5" fill="#2C1810"/>
                    <path d="M24,22 L18,16 L16,14 L20,16 Z" fill="#654321"/>
                    <ellipse cx="17" cy="14" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 (위로 들어올림) -->
                    <ellipse cx="44" cy="10" rx="8" ry="6" fill="#8B4513"/>
                    <ellipse cx="46" cy="8" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 (쫑긋) -->
                    <path d="M38,4 Q40,-2 42,2 Q40,0 38,4" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M41,4 Q43,-2 45,2 Q43,0 41,4" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (반짝) -->
                    <circle cx="46" cy="9" r="2" fill="white"/>
                    <circle cx="46.5" cy="9" r="1.3" fill="black"/>
                    <circle cx="47" cy="8" r="0.5" fill="white"/>
                    <!-- 코 (벌름) -->
                    <ellipse cx="51" cy="11" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="52" cy="11" rx="1.2" ry="1" fill="#2C1810"/>
                    <!-- 입 (히힝! 벌리기) -->
                    <path d="M50,13 Q52,15 54,13" fill="none" stroke="#2C1810" stroke-width="0.5"/>
                    <!-- 왕관 -->
                    <polygon points="40,2 42,-3 44,1 46,-3 48,2" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
                    <circle cx="42" cy="-2" r="0.8" fill="#FF6347"/>
                    <circle cx="46" cy="-2" r="0.8" fill="#4169E1"/>
                    <!-- 갈기 (날리는 중) -->
                    <path d="M24,14 Q26,8 28,10 Q30,8 32,12" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M26,12 Q28,6 30,8 Q32,6 34,10" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 (위로 치켜올림) -->
                    <path d="M18,26 Q14,22 10,18 Q6,14 4,10" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M18,24 Q14,20 10,16 Q6,12 2,8" fill="none" stroke="#654321" stroke-width="1.2"/>
                    <!-- 반짝이 이펙트 -->
                    <text x="8" y="8" font-size="5" fill="#FFD700">✦</text>
                    <text x="52" y="4" font-size="4" fill="#FFD700">✦</text>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 뒷다리 (땅에 버티기) -->
                    <path d="M36,30 L38,38 L36,40 L34,40 Z" fill="#654321"/>
                    <ellipse cx="35" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <path d="M30,30 L32,38 L30,40 L28,40 Z" fill="#654321"/>
                    <ellipse cx="29" cy="40" rx="2.5" ry="3" fill="#2C1810"/>
                    <!-- 몸통 -->
                    <ellipse cx="30" cy="27" rx="12" ry="7" fill="#8B4513" transform="rotate(-12,30,27)"/>
                    <!-- 목 -->
                    <path d="M22,23 Q24,14 28,16 Q30,18 32,23" fill="#8B4513"/>
                    <!-- 앞다리 (더 높이!) -->
                    <path d="M26,20 L21,12 L19,10 L23,12 Z" fill="#654321"/>
                    <ellipse cx="20" cy="10" rx="2" ry="2.5" fill="#2C1810"/>
                    <path d="M24,22 L17,14 L15,12 L19,14 Z" fill="#654321"/>
                    <ellipse cx="16" cy="12" rx="2" ry="2.5" fill="#2C1810"/>
                    <!-- 머리 (더 위로) -->
                    <ellipse cx="44" cy="8" rx="8" ry="6" fill="#8B4513"/>
                    <ellipse cx="46" cy="6" rx="5" ry="4" fill="#A0522D"/>
                    <!-- 귀 -->
                    <path d="M38,2 Q40,-4 42,0 Q40,-2 38,2" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <path d="M41,2 Q43,-4 45,0 Q43,-2 41,2" fill="#654321" stroke="#2C1810" stroke-width="0.3"/>
                    <!-- 눈 (윙크) -->
                    <circle cx="46" cy="7" r="2" fill="white"/>
                    <circle cx="46.5" cy="7" r="1.3" fill="black"/>
                    <circle cx="47" cy="6" r="0.5" fill="white"/>
                    <!-- 코 -->
                    <ellipse cx="51" cy="9" rx="2.5" ry="2" fill="#654321"/>
                    <ellipse cx="52" cy="9" rx="1.2" ry="1" fill="#2C1810"/>
                    <!-- 입 -->
                    <path d="M50,11 Q52,14 54,11" fill="none" stroke="#2C1810" stroke-width="0.5"/>
                    <!-- 왕관 (살짝 흔들림) -->
                    <polygon points="39,0 41,-5 43,-1 45,-5 47,0" fill="#FFD700" stroke="#DAA520" stroke-width="0.4"/>
                    <circle cx="41" cy="-4" r="0.8" fill="#FF6347"/>
                    <circle cx="45" cy="-4" r="0.8" fill="#4169E1"/>
                    <!-- 갈기 -->
                    <path d="M24,16 Q26,10 28,12 Q30,10 32,14" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <path d="M26,14 Q28,8 30,10 Q32,8 34,12" fill="#654321" stroke="#2C1810" stroke-width="0.4"/>
                    <!-- 꼬리 -->
                    <path d="M18,27 Q14,23 10,19 Q6,15 3,11" fill="none" stroke="#654321" stroke-width="1.5"/>
                    <path d="M18,25 Q14,21 10,17 Q6,13 1,9" fill="none" stroke="#654321" stroke-width="1.2"/>
                    <!-- 반짝이 이펙트 (위치 변경) -->
                    <text x="5" y="12" font-size="4" fill="#FFD700">✦</text>
                    <text x="54" y="2" font-size="5" fill="#FFD700">✦</text>
                    <text x="30" y="5" font-size="3" fill="#FFD700">✦</text>
                </svg>`
            },
            // === 꼴등 사망 모션 (dead) - 비석 + X눈 ===
            dead: {
                frame1: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 비석 -->
                    <rect x="20" y="10" width="24" height="28" rx="4" ry="4" fill="#808080" stroke="#666" stroke-width="0.5"/>
                    <rect x="20" y="34" width="28" height="6" rx="1" fill="#696969"/>
                    <!-- 비석 금 -->
                    <line x1="28" y1="14" x2="36" y2="32" stroke="#999" stroke-width="0.3"/>
                    <!-- R.I.P 텍스트 -->
                    <text x="32" y="22" text-anchor="middle" font-size="6" fill="#333" font-weight="bold">R.I.P</text>
                    <!-- 말 유령 (반투명) -->
                    <g opacity="0.4">
                        <ellipse cx="38" cy="6" rx="5" ry="4" fill="#8B4513"/>
                        <!-- X 눈 -->
                        <line x1="36" y1="4" x2="38" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="38" y1="4" x2="36" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="39" y1="4" x2="41" y2="6" stroke="#333" stroke-width="0.8"/>
                        <line x1="41" y1="4" x2="39" y2="6" stroke="#333" stroke-width="0.8"/>
                        <!-- 혀 -->
                        <path d="M42,7 Q43,9 42,10" fill="#FF69B4" stroke="none"/>
                    </g>
                    <!-- 풀 -->
                    <path d="M16,40 Q17,36 18,40" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M44,38 Q45,34 46,38" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M48,39 Q49,35 50,39" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                </svg>`,
                frame2: `<svg viewBox="0 0 60 45" width="60" height="45">
                    <!-- 비석 -->
                    <rect x="20" y="10" width="24" height="28" rx="4" ry="4" fill="#808080" stroke="#666" stroke-width="0.5"/>
                    <rect x="20" y="34" width="28" height="6" rx="1" fill="#696969"/>
                    <line x1="28" y1="14" x2="36" y2="32" stroke="#999" stroke-width="0.3"/>
                    <text x="32" y="22" text-anchor="middle" font-size="6" fill="#333" font-weight="bold">R.I.P</text>
                    <!-- 말 유령 (올라가는 중) -->
                    <g opacity="0.3">
                        <ellipse cx="38" cy="3" rx="5" ry="4" fill="#8B4513"/>
                        <line x1="36" y1="1" x2="38" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="38" y1="1" x2="36" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="39" y1="1" x2="41" y2="3" stroke="#333" stroke-width="0.8"/>
                        <line x1="41" y1="1" x2="39" y2="3" stroke="#333" stroke-width="0.8"/>
                        <path d="M42,4 Q43,6 42,7" fill="#FF69B4" stroke="none"/>
                    </g>
                    <!-- 풀 -->
                    <path d="M16,40 Q17,36 18,40" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M44,38 Q45,34 46,38" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                    <path d="M48,39 Q49,35 50,39" fill="none" stroke="#2d5a1e" stroke-width="0.8"/>
                </svg>`
            },
            // 하위호환: frame1/frame2 직접 접근 시 run 모션 사용
            get frame1() { return this.run.frame1; },
            get frame2() { return this.run.frame2; }
        }
    };
    
    return svgMap[vehicleId] || svgMap['car'];
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
