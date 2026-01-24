# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LAMDiceBot is a real-time multiplayer gaming platform with three game modes: Dice, Roulette, and Team Assignment. Key characteristic: **server-side random number generation** for fair, manipulation-proof gaming.

**Tech Stack**: Node.js 20.19.0, Express, Socket.IO, React 19 (Vite), PostgreSQL (optional), Google Gemini AI

**Language**: Korean (UI, documentation, commit messages are in Korean)

## Common Commands

```bash
# Install dependencies
npm install

# Development (run both in separate terminals)
npm start          # Backend server on port 3000
npm run dev        # React frontend on port 5173 (Vite dev server)

# Production build
npm run build      # Build React app to dist/

# Preview production build
npm run preview

# Testing
npm run test-bot      # Run dice game automated test bot

# Note: postinstall hook auto-builds React app after npm install
```

## Architecture

### Hybrid Frontend Architecture
- **React App** (`src/`): Server management interface (create/join servers, manage members)
- **HTML5 Game Clients**: Standalone game screens with vanilla JavaScript
  - `dice-game-multiplayer.html` - Dice game
  - `roulette-game-multiplayer.html` - Roulette game
  - `team-game-multiplayer.html` - Team assignment game
  - `admin.html` - Admin panel for server management
  - `server-members.html` - Member approval interface (host-only)
  - Info pages: `dice-rules-guide.html`, `about-us.html`, `privacy-policy.html`, etc.

### Backend
- **`server.js`** (~4877 lines): Monolithic Express/Socket.IO server containing all game logic, 42+ Socket.IO event handlers, REST API endpoints, database operations, and AI integration
- **`gemini-utils.js`**: Google Gemini AI service wrapper for chat functionality

### Two-Tier Architecture
- **Legacy "Rooms"**: In-memory game sessions (stored in `rooms` object in server.js), temporary
- **New "Servers"**: Database-persistent servers with member approval workflow
  - Servers have unique host codes for management
  - Support both public (auto-approve) and private (host-approval) modes
  - Members can be pending/approved/rejected

### Data Flow
1. User logs in via React app → creates/joins server
2. Redirected to game HTML with `serverId` parameter
3. Game connects via Socket.IO to backend
4. All random outcomes generated server-side
5. Results broadcast to all connected players

### Database
- **PostgreSQL** (primary): Auto-creates tables on startup
- **File System** (fallback): JSON files when DB unavailable
  - `frequentMenus.json` - Menu autocomplete data
  - `suggestions.json` - Board/suggestion data

### Testing Infrastructure
- **AutoTest/** directory: Puppeteer-based automated testing
  - `dice/` - Dice game test bots with UI and synchronization tests
  - `roulette/` - Roulette game test bots verifying angle calculations and winner selection
  - Supports both local and production server testing

### Key Tables
- `servers` - Game server instances
- `server_members` - Users per server (with approval status)
- `server_game_records` - Individual game results
- `game_sessions` - Game session metadata

## REST API Endpoints

**Admin**
- `POST /api/admin/verify` - Admin password verification
- `GET /api/admin/servers?token=` - List all servers (requires admin token)
- `DELETE /api/admin/servers/:id?token=` - Delete server (requires admin token)

**Server Management**
- `GET /api/server/:serverId/info` - Server details
- `GET /api/server/:serverId/check-member` - Check member status
- `GET /api/server/:serverId/pending-count` - Count pending approval requests

**Member Management**
- `POST /api/server/:serverId/members` - Add member (requires hostCode)
- `POST /api/server/:serverId/members/:userName/approve` - Approve/reject member

**AI Features**
- `POST /api/calculate-custom-winner` - Gemini AI-powered winner calculation

## Socket.IO Events (42+ events)

**Server Management**: `createServer`, `getServers`, `joinServer`, `setServerId`

**Game Rooms**: `createRoom`, `joinRoom`, `leaveRoom`, `getRooms`, `getCurrentRoom`, `kickPlayer`

**Game Configuration**: `updateGameRules`, `updateRange`, `updateUserDiceSettings`, `updateTurboAnimation`, `updateOrder`, `startOrder`, `endOrder`

**Gameplay**: `startGame`, `endGame`, `requestRoll`, `toggleReady`, `setUserReady`, `clearGameData`

**Roulette-Specific**: `startRoulette`, `endRoulette`, `rouletteResult`, `selectRouletteColor`, `getUserColors`

**Social/Chat**: `sendMessage`, `geminiChat`, `toggleReaction`

**Data/Stats**: `getTodayDiceStats`, `getServerRecords`, `getFrequentMenus`, `addFrequentMenu`, `deleteFrequentMenu`

**Board/Suggestions**: `getSuggestions`, `createSuggestion`, `deleteSuggestion`

See `server.js` for complete event handler implementations.

## Environment Variables

```bash
# Server Configuration
PORT=3000                                                # Default: 3000
NODE_ENV=production                                      # Development/production mode

# Database (optional - falls back to file system)
DATABASE_URL=postgresql://user:pass@host:port/database

# AI Integration (optional)
GOOGLE_API_KEY=your_gemini_api_key                       # For Gemini AI chat features

# Admin Access
ADMIN_PASSWORD=your_admin_password                       # Admin panel authentication
```

## Development Notes

- Vite config proxies `/socket.io` and `/api` to port 3000 during development
- Host code stored in `sessionStorage` (not URL) for security
- Rate limiting: 100 requests/minute per IP (HTTP), per-socket limits for Socket.IO events
- Max connections: 50 simultaneous players (configurable in server.js)
- Admin token system: Temporary tokens for admin access (not cookie-based)
- Member approval workflow: Hosts must approve pending members in private servers
- Seeded RNG: Uses SHA-256 based seeded random for reproducible/auditable results
- IP-based fraud prevention: Optional per-room IP tracking to limit multi-accounting

## React Migration Progress (진행 중)

### 목표
HTML5 게임 클라이언트(Dice, Roulette)를 React 컴포넌트로 마이그레이션하여 40-50% 코드 재사용 및 유지보수성 향상

### 완료된 작업

**Phase 1: Infrastructure Setup** ✅
- React Router v6 설치 및 설정
- Context API 구현:
  - `SocketContext` - Socket.IO 인스턴스 전역 관리
  - `AuthContext` - 사용자 인증 정보 (userName, deviceId)
  - `GameContext` - 게임/서버 상태 관리
- `useLocalStorage` 훅 구현
- 기존 App.jsx → ServerListPage.jsx 리팩토링
- App.jsx에 React Router 설정
- 폴더 구조 생성: `src/pages/`, `src/games/`, `src/context/`, `src/hooks/`, `src/utils/`, `src/components/shared/`, `src/components/ui/`

**Bug Fixes** ✅
- `dice-game-multiplayer.html`: `/주사위` 명령어 querySelector 특수문자 이스케이프 처리 (CSS.escape)
- `dice-game-multiplayer.html`: `/주사위` 메시지에 이모티콘 반응 버튼 추가

**Phase 3: Shared Components Extraction** ✅ 완료
- ✅ ChatSystem 컴포넌트 (채팅 + 이모티콘 반응)
  - `useChatHistory.js` - 채팅 상태 관리 훅
  - `ChatMessage.jsx` - 개별 메시지 컴포넌트 (이모티콘 반응 포함)
  - `ChatMessages.jsx` - 메시지 목록 컨테이너
  - `ChatInput.jsx` - 자동완성 입력 필드
  - `ChatSystem.jsx` - 메인 컨테이너
- ✅ ReadySystem 컴포넌트 (준비 상태 + 드래그앤드롭)
  - `useReadyState.js` - 준비 상태 훅
  - `ReadyButton.jsx` - 토글 버튼
  - `ReadyUsersList.jsx` - 드래그앤드롭 사용자 목록
  - `ReadySystem.jsx` - 메인 컨테이너
- ✅ OrderSystem 컴포넌트 (주문받기 + 자동완성)
  - `useOrderState.js` - 주문 상태 관리 훅
  - `OrderInput.jsx` - 자동완성 입력 필드
  - `OrderList.jsx` - 메뉴별 그룹화 주문 목록
  - `FrequentMenus.jsx` - 자주 사용하는 메뉴 관리 (호스트 전용)
  - `NotOrderedUsers.jsx` - 미주문자 목록
  - `OrderSystem.jsx` - 메인 컨테이너
- ✅ RoomManager 컴포넌트 (방 관리)
  - `useRoomState.js` - 방 상태 관리 훅
  - `RoomHeader.jsx` - 방 헤더 (방 이름, 호스트 정보, 나가기 버튼)
  - `ParticipantsList.jsx` - 참가자 목록 (강퇴 기능 포함)
  - `RoomManager.jsx` - 메인 컨테이너

**Phase 4: GameRoomPage & DiceGame** ✅ 완료
- ✅ GameRoomPage 컴포넌트 (게임 타입별 라우팅)
  - URL 파라미터로 게임 타입 분기 (`/game/:gameType`)
  - serverId 쿼리 파라미터 처리
  - 로그인 및 권한 검증
- ✅ DiceGame 컴포넌트
  - `useDiceGame.js` - 게임 상태 관리 훅 (Socket.IO 이벤트)
  - `DiceGame.jsx` - 메인 컨테이너 (HTML과 동일한 단일 컬럼 레이아웃)
  - `DiceGame.css` - HTML과 동일한 스타일 (800px 컨테이너)
  - `HistoryPanel.jsx/.css` - 우측 고정 기록 패널 (320px, position: fixed)
  - 공유 컴포넌트 통합 (ChatSystem, ReadySystem, OrderSystem, RoomManager)
  - 실시간 주사위 굴림 및 결과 표시
  - 게임 상태 배지 (대기중/게임중/주문중) HTML 색상 체계 적용

**Phase 5: RouletteGame** ✅ 완료
- ✅ RouletteGame 컴포넌트
  - `useRouletteGame.js` - 게임 상태 관리 훅 (Socket.IO 이벤트)
  - `RouletteGame.jsx` - 메인 컨테이너
  - `RouletteGame.css` - 스타일
  - `RouletteWheel.jsx` - conic-gradient 기반 룰렛 휠
  - `RouletteWheel.css` - 휠 애니메이션 스타일
  - 터보 모드 토글
  - 회전 애니메이션 (3초/1초)
  - 참가자별 색상 표시
  - 공유 컴포넌트 통합

**Phase 6-7: 고급 기능 & 네비게이션** ✅ 완료
- ✅ ServerListPage에서 React 게임으로 리다이렉트
  - `window.location.href` → `navigate()` 변경
  - HTML 파일 대신 `/game/:gameType` 라우트 사용
- ✅ CreateServer에 게임 타입 선택 추가
  - 주사위 게임 / 룰렛 게임 라디오 버튼
  - 각 게임 타입별 설명 및 아이콘
  - gameType을 socket.emit('createServer')에 포함

**Phase 8: HTML UI/UX 동기화** ✅ 완료
- ✅ ServerList.jsx - HTML과 동일한 세로 리스트 레이아웃
  - 그리드 카드 → 세로 리스트 (max-height: 400px, 스크롤)
  - 게임 상태 배지 (대기중/게임중/주문중) HTML 색상 적용
  - 내 방 하이라이트 (노란색 배경)
- ✅ CreateServer.jsx - 추가 기능
  - 방 유지 시간 설정 (1/3/6시간)
  - IP 차단 설정 (IP당 하나의 아이디만 입장 허용)
- ✅ DiceGame 레이아웃 HTML과 동기화
  - 탭 네비게이션 제거
  - 단일 컬럼 (800px) + 우측 고정 기록 패널 (320px)
  - 채팅 항상 하단에 표시
  - 게임 상태 배지 색상 (waiting: #fff3cd, playing: #d4edda, ordering: #fff9e6)
- ✅ GameRulesPanel 컴포넌트 (DiceGame 전용)
  - 7가지 프리셋 (기본, 낮은 숫자 승, 소규모, 대규모, 빠른 게임, 경쟁 모드, 커스텀)
  - 숫자 범위 설정 (minValue, maxValue)
  - 중복 허용, 정렬, 준비 필수, 자동 시작 옵션
  - 애니메이션 타입 선택
  - 접기/펼치기 토글
- ✅ DiceAnimation 컴포넌트
  - 7가지 애니메이션 타입 (fade, slide, bounce, rotate, flip, zoom, shake)
  - 딜레이 지원 (순차적 표시)
  - 게임 결과 및 히스토리에 적용

### 남은 작업 (선택 사항)

- E2E 테스트 작성
- 성능 최적화 (코드 분할, lazy loading)
- 접근성 개선 (ARIA 레이블)

### 제외된 항목
- Team 게임은 HTML 파일 유지 (마이그레이션하지 않음)
