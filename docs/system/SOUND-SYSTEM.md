# 사운드 시스템 가이드

## 구조

```
assets/sounds/
├── sound-config.json    ← 키-경로 매핑 (이것만 수정하면 SoundManager가 자동 인식)
├── sound-manager.js     ← 공통 재생 유틸 (playSound, playLoop, stopLoop, stopAll)
├── SOUND-NOTES.md       ← 사운드 현황 노트 (에셋 유무, 재생 시점 등)
├── common/              ← 공통 효과음
├── dice/                ← 주사위 효과음
├── roulette/            ← 룰렛 효과음
├── horse-race/          ← 경마 효과음
└── team/                ← 팀전 효과음
```

## 사운드 추가 방법

### 1. 스킬 명령어 (권장)

```
/addsound 경마 결승 팡파레
/delsound 경마 발굽소리
```

스킬이 자동으로 config, 코드, 노트, placeholder 파일을 모두 처리합니다.

### 2. 수동 추가

#### Step 1: mp3 파일 배치
```
assets/sounds/{게임타입}/{파일명}.mp3
```
게임타입: `dice`, `roulette`, `horse-race`, `team`, `common`

#### Step 2: sound-config.json에 키 등록
```json
{
  "{게임타입}_{효과명}": "assets/sounds/{게임타입}/{파일명}.mp3"
}
```
키 규칙: `{gameType}_{effectName}` (예: `horse-race_gunshot`, `dice_bgm`)

#### Step 3: 게임 HTML에 재생 코드 삽입

**단발 재생** (효과음):
```js
if (window.SoundManager) SoundManager.playSound('키', get{Game}SoundEnabled());
```

**루프 재생** (BGM, 배경음):
```js
// 시작
if (window.SoundManager) SoundManager.playLoop('키', get{Game}SoundEnabled(), 0.3);

// 정지
if (window.SoundManager) SoundManager.stopLoop('키');

// 전체 루프 정지
if (window.SoundManager) SoundManager.stopAll();
```

#### Step 4: SOUND-NOTES.md 업데이트
`assets/sounds/SOUND-NOTES.md`의 해당 게임 테이블에 행 추가.

## 사운드 enabled 함수 (게임별)

| 게임 | 함수 | localStorage 키 |
|------|------|-----------------|
| 주사위 | `getDiceSoundEnabled()` | `diceSoundEnabled` |
| 룰렛 | `getRouletteSoundEnabled()` | `rouletteSoundEnabled` |
| 경마 | `getHorseSoundEnabled()` | `horseSoundEnabled` |
| 팀전 | `getTeamSoundEnabled()` | `teamSoundEnabled` |

## SoundManager API

| 메서드 | 설명 |
|--------|------|
| `playSound(key, enabled)` | 단발 재생. enabled=false면 스킵 |
| `playLoop(key, enabled, volume)` | 루프 재생. 같은 키 중복 재생 방지 |
| `stopLoop(key)` | 특정 루프 정지 |
| `stopAll()` | 모든 루프 정지 |
| `setVolume(key, volume)` | 루프 볼륨 조절 (0.0~1.0) |
| `ensureContext()` | 사용자 제스처 후 AudioContext resume |
| `loadConfig()` | sound-config.json 로드 (자동 캐시) |

## 주의사항

- 백그라운드 탭에서는 사운드 자동 스킵 (visible + hasFocus 체크)
- mp3 파일이 없거나 404면 에러 없이 무음 처리 (catch)
- `sound-manager.js` 스크립트 태그가 해당 게임 HTML에 있어야 함
- 룰렛은 `RouletteSound` 객체(Web Audio API)로 별도 합성 재생 중, SoundManager와 병행
