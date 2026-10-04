# 채팅 좋아요를 메시지 고유 번호로 찾기

작성: 2026-10-04. 사용자 제보: "좋아요 누르면 채팅을 못 찾는다 — 이미지 올린 뒤·게임 끝난 뒤에 많다."

## 원인

`toggleReaction` 이 메시지를 **채팅 목록의 순번(`messageIndex`)** 으로 찾는다. 서버 `gameState.chatHistory` 와
화면의 `ChatModule` 목록 순번이 한 칸이라도 어긋나면 서버에 없는 순번 → "메시지를 찾을 수 없습니다!",
있는 순번 → 다른 메시지에 좋아요가 붙는다. 어긋나는 길은 네 가지였다.

| 경우 | 어긋나는 이유 |
|---|---|
| 경마 한 판 뒤 | 화면에만 띄우는 채팅(출발 안내·결과 카드·모바일 안내)이 서버 기록에 없다 → 화면이 2~3칸 앞선다 |
| 재연결 뒤(사진 고르다 앱 전환 등) | 재입장 때 서버 기록을 다시 그리면서 `ChatModule` 목록은 안 비운다 → 기존 개수만큼 밀린다. 주사위는 `clientChatHistory = []` 가 읽기 전용 속성이라 조용히 무시된다 |
| 채팅 100개 넘음 | 서버만 오래된 것을 잘라낸다 |
| 룰렛 화면 꺼짐 | 당첨 메시지를 숨기며 목록에서도 빠진다 |

## 결정

- 서버(`socket/chat.js`)가 좋아요를 달 수 있는 메시지(일반 채팅·이미지)에 프로세스 안에서 유일한 `id` 를 붙인다.
  시스템·AI 메시지는 반응 버튼이 없으므로 번호가 필요 없다(다른 socket 파일은 안 건드린다).
- 계약: `toggleReaction {messageId, emoji}` → `messageReactionUpdated {messageId, message}`.
  서버는 `chatHistory` 에서 `id` 로 찾는다. JS 는 ETag 재검증이라 옛 `messageIndex` 페이로드 호환은 두지 않는다.
- 클라이언트 순번(`data-message-index`)은 화면 안에서만 쓴다(핀·스크롤). 서버로 보낼 때만
  `ChatModule.toggleReaction(index, emoji)` 가 `chatHistory[index].id` 로 바꾼다. 받은 갱신은 `id` 로 순번을 찾는다.
- 재입장 시 서버 기록을 다시 그리기 전에 `ChatModule.resetHistory()` 로 목록·핀을 비운다(경마·룰렛·주사위).
- 주사위 자체 렌더러의 반응 버튼 4곳도 `ChatModule.toggleReaction` 을 쓰고, 중복 판정은 `id` 가 있으면 `id` 로 한다.

## 완료 조건

1. 경마 한 판 뒤 새 메시지에 좋아요 → 그 메시지에 붙는다(PC·모바일 둘 다).
2. 재연결(서버 기록 재수신) 뒤 좋아요 → 그 메시지에 붙는다.
3. 다른 사람 화면에서도 같은 메시지에 반응이 보인다.
4. 주사위·룰렛·경마 채팅 반응 정상(공유 모듈 크로스게임 확인).
5. 문서 `shared-modules.md` 계약 표 갱신, lesson `_common.md` 추가.
