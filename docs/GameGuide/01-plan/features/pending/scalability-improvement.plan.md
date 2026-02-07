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

---

## 서버 프로그래머 전문가 검증: 확장성 스트레스 분석 (2026-02-07)

> 서버 프로그래머 + DBA 전문가 에이전트가 현재 아키텍처를 분석한 결과

### 접속자 규모별 스트레스 분석

| 동접자 수 | 메모리 | DB 연결 | 이벤트 루프 | 판정 |
|:---------:|:------:|:-------:|:-----------:|:----:|
| **10명** | ~50MB | 여유 | 정상 | **안전** |
| **50명** | ~150MB | 여유 | 경미한 지연 가능 | **주의** |
| **100명** | ~300MB | 압박 시작 | 경마 시뮬 시 블로킹 | **위험** |
| **500명** | ~1.5GB+ | 풀 고갈 | 심각한 블로킹 | **한계 초과** |
| **1000명+** | OOM 위험 | 연결 불가 | 서비스 불가 | **불가능** |

### 현실적 한계
- **현재 아키텍처 최대 동접**: 80-120명
- **Quick Win 적용 후**: 200-300명
- **Redis + 클러스터링 적용 후**: 1,000명+

### TOP 5 병목 지점 (심각도 순)

#### 1A. 글로벌 브로드캐스트 폭풍 (CRITICAL)
```
위치: socket/index.js - updateRoomsList()
문제: 방 목록 갱신 시 io.emit()으로 전체 접속자에게 브로드캐스트 (방 안 사용자 포함)
     방 입장/퇴장/생성 등 빈번한 이벤트마다 실행
영향: 50명+에서 눈에 띄는 지연
수정: 디바운싱 (200ms leading+trailing) + 로비 사용자에게만 전송
복잡도: Easy (1일)
```

> ~~io.fetchSockets()는 index.js가 아니라~~ `socket/rooms.js`에 위치 (11곳)

#### 1B. fetchSockets 전체 순회 (CRITICAL)
```
위치: socket/rooms.js (line 77, 208, 659)
문제: IP 차단 기능에서 io.fetchSockets() 글로벌 순회 O(n)
     blockIPPerUser false인 방에서는 호출 안 함
영향: IP 차단 활성화된 방에서 입장 시 전체 소켓 순회
수정: 인메모리 Map으로 IP→socketId 매핑 관리
복잡도: Medium (1-2일)
```

#### 2. 경마 시뮬레이션 CPU 블로킹 (CRITICAL)
```
위치: socket/horse.js - calculateHorseRaceResult() (lines 1127-1397)
문제: 동기식 물리 시뮬레이션 (최대 3750 프레임 x 6마리 = 22,500회 연산)
     실행 중 이벤트 루프 완전 차단
영향: 동시 2개 방에서 경마 시작 시 서로 블로킹
수정: Worker Thread 분리 또는 setImmediate() 분할
복잡도: ~~Medium (2-3일)~~ setImmediate 분할: Easy (0.5일) / Worker Thread: Medium (2-3일)
```

#### 3. Base64 이미지 메모리 폭발 (HIGH)
```
위치: socket/chat.js (lines 419-503)
문제: 채팅 이미지가 Base64로 chatHistory에 저장 (이미지당 최대 5MB)
     새 입장자에게 전체 chatHistory 전송
영향: 5개 방 x 10 이미지 = 250MB 메모리 소비
수정: 이미지 수 제한 (방당 최대 5개) 또는 URL 참조만 저장
복잡도: Easy (0.5일)
```

#### 4. 단일 프로세스 아키텍처 (HIGH)
```
문제: Node.js 단일 프로세스 = CPU 코어 1개만 사용
     클러스터링/PM2/Worker Thread 없음
영향: 100명+에서 전체 성능 저하
수정: PM2 cluster mode → Socket.io Redis adapter
복잡도: Hard (1주+)
전제: PM2 cluster 모드는 Redis adapter 없이 도입 불가 (rooms 인메모리, Socket.IO adapter, 게임 상태가 프로세스 간 미공유)
순서: Redis adapter 도입 (Hard 1주+) → PM2 cluster (Easy 0.5일)
→ 이 문서의 Phase 1 (Redis)로 해결 가능
```

#### 5. DB 연결 풀 미설정 (MEDIUM)
```
위치: db/pool.js (lines 17-19)
문제: new Pool()에 max 미설정 → 기본값 10
     fire-and-forget 쿼리 + 동기식 파일 I/O 폴백
영향: 50명+에서 DB 연결 대기 발생
수정: Pool({ max: 20, idleTimeoutMillis: 30000 }) + 비동기 파일 I/O
복잡도: Easy (0.5일)
```

### Quick Win 정리 (Redis 도입 전, 1일 이내 적용 가능)

| 항목 | 예상 효과 | 소요 시간 |
|------|----------|----------|
| 브로드캐스트 디바운싱 | 50% 이벤트 감소 | 2시간 |
| chatHistory 이미지 수 제한 | 메모리 80% 절약 | 2시간 |
| DB Pool max 설정 명시 | 연결 안정성 향상 | 30분 |
| writeFileSync → writeFile | 이벤트 루프 블로킹 방지 | 1시간 |
| chatHistory 배열 크기 하드캡 | 메모리 누수 방지 | 30분 |

> Quick Win만 적용해도 최대 동접 200-300명까지 확장 가능

---

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
