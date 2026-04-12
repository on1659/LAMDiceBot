# 서버 멤버십

## 개요

서버는 유저들이 모이는 그룹 단위. 서버별 랭킹/시즌/게임 기록 분리.

---

## 서버 생성 (`db/servers.js`)

1. 이름 검증 (2~20자, 특수문자 불가)
2. 설명 (0~100자), 비밀번호 (4~20자, 영숫자, 선택)
3. 비밀번호 bcrypt 해싱 (폴백: 평문)
4. DB insert → 호스트 자동 approved 멤버 추가

## 가입 흐름

```
joinServer(serverId, userName, password)
    ↓
이미 멤버? → 빠른 복귀 (last_seen 갱신)
    ↓ (신규)
비밀번호 검증
    ↓
가입 상한 체크 (최대 5개 서버)
    ↓
pending 멤버 생성 (is_approved = false)
    ↓
호스트가 승인 → is_approved = true
```

## 멤버 관리

| 동작 | 함수 | 설명 |
|------|------|------|
| 목록 | `getMembers(serverId)` | 전체 멤버 (승인/대기 포함) |
| 승인 | `updateMemberApproval(serverId, userName, true)` | 대기 → 승인 |
| 거절 | `updateMemberApproval(serverId, userName, false)` | 대기 → 삭제 |
| 추방 | `removeMember(serverId, userName)` | 멤버 행 삭제 |
| 상태 | `checkMember(serverId, userName)` | 멤버십 + 승인 여부 |
| 접속 | `updateLastSeen(serverId, userName)` | last_seen_at 갱신 |

## 온라인 상태

`socket/server.js`에서 인메모리 `onlineMembers` 맵 관리:
- `joinServer` / `setServerId` → 온라인 등록
- `leaveServer` / `disconnect` → 온라인 제거 + DB last_seen 갱신
- `memberUpdated` 이벤트로 실시간 상태 브로드캐스트

## HTTP 라우트

| 메서드 | 경로 | 용도 |
|--------|------|------|
| GET | `/api/server/:id/info` | 서버 정보 |
| GET | `/api/server/:id/check-member` | 멤버십 확인 |
| GET | `/api/server/:id/members` | 멤버 목록 + 온라인 상태 |
| POST | `/api/server/:id/members/:name/approve` | 승인/거절 |
| DELETE | `/api/server/:id/members/:name` | 추방 |
| GET | `/api/my-servers?userName=X` | 내가 만든 서버 |
| DELETE | `/api/my-servers/:id` | 내 서버 삭제 |
