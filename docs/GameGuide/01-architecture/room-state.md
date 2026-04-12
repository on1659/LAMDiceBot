# 방 상태 라이프사이클

## Room 객체 구조

```javascript
{
  roomId,            // 8자리 hex (crypto.randomBytes)
  hostId,            // 호스트 소켓 ID
  hostName,
  roomName,
  isPrivate,         // 비밀번호 방 여부
  password,          // 4~20자
  gameType,          // 'dice' | 'roulette' | 'horse-race'
  expiryHours,       // 1 | 3 | 6
  blockIPPerUser,    // IP 중복 차단
  turboAnimation,    // 빠른 애니메이션
  serverId,          // 서버 소속 (nullable)
  serverName,
  isPrivateServer,
  gameState,         // createRoomGameState()
  createdAt,
  userBadges,        // 서버 내 상위 3명 뱃지
}
```

## 생성 (`createRoom`)

1. `generateRoomId()` → 8자리 hex
2. `createRoomGameState()` → 초기 게임 상태
3. 호스트 자동 추가 + 자동 준비
4. 경마: 탈것 타입 사전 설정
5. Socket.IO room 가입
6. 방 목록 브로드캐스트

## 입장 (`joinRoom`)

1. 비밀번호 검증 (비밀방)
2. 이름 중복 시 `_N` 접미사 부여
3. IP 블록 검사 (설정 시)
4. users 배열에 추가
5. 전체 방/게임 상태 전송 (`roomJoined`)

## 호스트 승계

호스트 퇴장 시:
1. `users[0]` → 새 호스트로 승격
2. `hostChanged` 이벤트 브로드캐스트
3. `hostId` 갱신

## 재접속 (`getCurrentRoom` / `login`)

1. 소켓 ID 마이그레이션 (`user.id` 갱신)
2. `hostId` 갱신 (호스트인 경우)
3. 전체 방/게임 상태 재전송

## 유예 기간 & 삭제

```
마지막 유저 퇴장
    ↓
startRoomGrace(roomId)
    ↓ ROOM_GRACE_PERIOD (기본 120초)
'roomDeleted' 브로드캐스트
    ↓
rooms 객체에서 제거
```

- 유예 중 새 유저 입장 → 타이머 취소
- 서버 전체: 60초 간격 만료 방 체크
