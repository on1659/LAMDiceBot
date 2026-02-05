# Plan: 확장성 개선 - Database/State 관리 (Scalability Improvement)

## 목표
현재 인메모리 상태 관리를 영구 저장소(Database)와 세션 관리(Redis)로 개선하여,
서버 재시작 시에도 방/유저 상태 유지 및 다중 서버 환경 지원 준비.

## 현재 상태 분석

### 현재 아키텍처
| 항목 | 현재 상태 | 문제점 |
|------|----------|--------|
| 방 목록 | 인메모리 Map | 서버 재시작 시 모든 방 소실 |
| 유저 세션 | Socket.IO 내장 | 서버 재시작 시 연결 끊김 |
| 경주 기록 | 없음 | 과거 경주 기록 조회 불가 |
| 설정 데이터 | JSON 파일 | 런타임 변경 불가 |

### 코드 위치 분석
```
socket/horse.js
├── rooms = new Map()           // 방 목록 (인메모리)
├── socket.roomId               // 유저별 방 정보 (소켓 인스턴스)
└── roomData.raceHistory        // 방별 경주 기록 (인메모리)

server.js
├── Socket.IO adapter           // 기본 인메모리 어댑터
└── Express session             // 설정 없음
```

## 제안 아키텍처

### Phase 1: Redis 세션 관리
```
┌─────────────────────────────────────────────────────┐
│                     Clients                          │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              Socket.IO Server                        │
│  ┌─────────────────────────────────────────────┐    │
│  │         Redis Adapter                        │    │
│  │  - Pub/Sub for multi-server sync            │    │
│  │  - Session persistence                       │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│                      Redis                           │
│  - rooms:{roomId}         (방 상태)                  │
│  - sessions:{socketId}    (유저 세션)                │
│  - race:history:{roomId}  (경주 기록, TTL 1일)       │
└─────────────────────────────────────────────────────┘
```

### Phase 2: Database 영구 저장소 (선택)
```
┌─────────────────────────────────────────────────────┐
│                    PostgreSQL                        │
│  - users                  (유저 프로필)              │
│  - rooms                  (방 설정)                  │
│  - race_results           (경주 결과 영구 기록)      │
│  - statistics             (통계 데이터)              │
└─────────────────────────────────────────────────────┘
```

## 구현 범위

### 필수 (Phase 1: Redis)
| 기능 | 설명 | 우선순위 |
|------|------|----------|
| Socket.IO Redis Adapter | 다중 서버 간 이벤트 동기화 | P1 |
| 방 상태 Redis 저장 | 서버 재시작 시 방 복구 | P1 |
| 세션 Redis 저장 | 재연결 시 세션 복구 | P1 |
| 경주 기록 캐싱 | 최근 경주 기록 조회 (TTL) | P2 |

### 선택 (Phase 2: Database)
| 기능 | 설명 | 우선순위 |
|------|------|----------|
| 유저 프로필 저장 | 닉네임, 통계 영구 보관 | P3 |
| 경주 결과 영구 저장 | 전체 기록 조회 | P3 |
| 리더보드 | 승률, 참여 횟수 순위 | P3 |

## 기술 스택 선택

### Redis
- **ioredis**: Node.js Redis 클라이언트 (권장)
- **socket.io-redis-adapter**: Socket.IO Redis 어댑터

### Database (Phase 2)
| 옵션 | 장점 | 단점 |
|------|------|------|
| SQLite | 설치 간편, 파일 기반 | 동시성 제한 |
| PostgreSQL | 확장성, 기능 풍부 | 별도 설치 필요 |
| MongoDB | 스키마 유연 | 조인 어려움 |

**권장**: 개발/테스트는 SQLite, 프로덕션은 PostgreSQL

## 변경 파일 목록

### Phase 1: Redis 통합
| 파일 | 변경 내용 |
|------|----------|
| `package.json` | ioredis, @socket.io/redis-adapter 추가 |
| `server.js` | Redis 연결, Socket.IO adapter 설정 |
| `socket/horse.js` | rooms Map → Redis 저장소 래퍼 |
| `lib/redis-store.js` | Redis 유틸리티 (새 파일) |
| `config/redis.json` | Redis 연결 설정 (새 파일) |

### Phase 2: Database
| 파일 | 변경 내용 |
|------|----------|
| `package.json` | better-sqlite3 또는 pg 추가 |
| `lib/database.js` | DB 연결 및 쿼리 (새 파일) |
| `migrations/` | 스키마 마이그레이션 (새 폴더) |

## 리스크 및 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| Redis 연결 실패 | 서버 시작 불가 | 폴백 모드 (인메모리) 구현 |
| Redis 데이터 손실 | 세션/방 상태 소실 | RDB 스냅샷 + AOF 활성화 |
| 직렬화 오버헤드 | 성능 저하 | 필요한 필드만 저장 |
| 스키마 변경 | 마이그레이션 필요 | 버전 관리된 마이그레이션 |

## 검증 방법

### Phase 1 테스트
1. 서버 재시작 후 방 목록 유지 확인
2. 클라이언트 재연결 시 세션 복구 확인
3. 두 서버 인스턴스 간 이벤트 동기화 확인
4. Redis 다운 시 폴백 모드 동작 확인

### Phase 2 테스트
1. 경주 결과 영구 저장 확인
2. 유저 통계 조회 확인
3. DB 다운 시 에러 핸들링 확인

## 예상 구현 순서

```
1. lib/redis-store.js 생성 (Redis 유틸리티)
2. server.js Redis 연결 추가
3. socket/horse.js rooms 저장 로직 변경
4. 세션 저장/복구 로직 추가
5. 테스트 및 폴백 모드 구현
6. (Phase 2) Database 스키마 설계
7. (Phase 2) 영구 저장 기능 구현
```

## 참고 코드

### Redis Store 예시
```javascript
// lib/redis-store.js
const Redis = require('ioredis');

class RedisStore {
    constructor(config) {
        this.client = new Redis(config);
    }

    async getRoom(roomId) {
        const data = await this.client.get(`room:${roomId}`);
        return data ? JSON.parse(data) : null;
    }

    async setRoom(roomId, roomData) {
        await this.client.set(`room:${roomId}`, JSON.stringify(roomData));
    }

    async deleteRoom(roomId) {
        await this.client.del(`room:${roomId}`);
    }

    async getAllRooms() {
        const keys = await this.client.keys('room:*');
        const rooms = new Map();
        for (const key of keys) {
            const data = await this.client.get(key);
            const roomId = key.replace('room:', '');
            rooms.set(roomId, JSON.parse(data));
        }
        return rooms;
    }
}

module.exports = RedisStore;
```

### Socket.IO Redis Adapter 예시
```javascript
// server.js
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
    io.adapter(createAdapter(pubClient, subClient));
});
```
