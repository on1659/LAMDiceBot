# Fallen Motion Profiles
날짜: 2026-04-23
대상 프로젝트: LAMDiceBot

## 목적

경마게임의 `run -> fallen` 연출을 모든 탈것에 동일하게 적용하지 않고, 탈것 성격에 따라 다르게 보이도록 모션 프로필을 정의한다.

이 문서는 구현 코드가 아니라 기획 기준 문서다. 나중에 `AutoTest/horse-devtools.html` 프리뷰와 실제 게임 런타임에서 같은 기준으로 사용할 수 있도록, 탈것별 성격과 공통 파라미터를 먼저 고정하는 것이 목적이다.

## 공통 원칙

- 전부 오른쪽 진행 기준이다.
- `fallen` 리소스는 공용 상태로 유지하되, `run -> fallen` 전환 모션만 탈것별로 차별화한다.
- 모바일 작은 화면에서도 읽히도록 과한 잔동작보다 큰 방향성과 충돌감이 먼저 보여야 한다.
- 차이는 크게 네 가지로 만든다.
  - 전진량
  - 기울기
  - 충돌 반동
  - 보조 FX

## 공통 모션 구조

모든 탈것은 아래 4단계 안에서만 변형한다.

1. `brace`
   - 휘청하거나 버티는 예비 동작
   - 60~120ms
2. `pitch`
   - 진행방향으로 실수하듯 앞쪽으로 쏠림
   - 120~180ms
3. `impact`
   - 바닥과 닿으며 크게 읽히는 충돌 구간
   - 120~220ms
4. `settle`
   - `fallen` 포즈에 정착
   - 120~180ms

기본 체감 공식:

```text
run 유지 -> 살짝 더 나감 -> 앞쪽으로 무너짐 -> 한번 튕김 -> fallen 안착
```

## 분류

### 1. 전진형

앞쪽으로 쓸리듯 넘어지는 타입이다.

- `car`
- `bicycle`
- `scooter`
- `rabbit`
- `ninja`

특징:

- 전진량이 큼
- 충돌 전 살짝 더 속도가 붙어 보임
- `spark` 또는 `dust`가 잘 어울림

### 2. 무게형

관성 때문에 늦게 무너지거나, 짧게 밀린 뒤 크게 눌러앉는 타입이다.

- `turtle`
- `horse`
- `dinosaur`
- `knight`

특징:

- 전진량은 중간 이하
- `dropY`, `impactScale`, `settleWeight`가 큼
- 바닥을 누르는 느낌이 중요함

### 3. 비행형

날개나 추진이 먼저 무너지며 낙하하듯 `fallen`으로 들어가는 타입이다.

- `bird`
- `eagle`
- `rocket`
- `helicopter`

특징:

- 수평 슬라이드보다 `tilt`와 `dropY`가 큼
- `smoke`, `feather`, `wind` 성격의 FX가 어울림

### 4. 특수형

일반적인 미끄러짐보다 탈것 고유의 접지 방식이 먼저 읽혀야 하는 타입이다.

- `boat`
- `crab`

특징:

- `boat`는 물결/물보라
- `crab`는 좌우 흔들림과 낮은 미끄러짐

## 프로필 파라미터 제안

구현은 탈것별 SVG를 새로 그리기보다, 아래 프로필 값으로 조정하는 방식이 효율적이다.

```js
{
  category: 'glide' | 'heavy' | 'air' | 'special',
  braceMs: 80,
  pitchMs: 140,
  impactMs: 160,
  settleMs: 140,
  slideX: 10,
  overshootX: 14,
  dropY: 6,
  tiltDeg: 18,
  reboundY: -2,
  impactScale: 1.05,
  settleScale: 1,
  outgoingBlur: 1.2,
  fxType: 'dust' | 'spark' | 'smoke' | 'feather' | 'splash' | 'wind',
  fxStrength: 0.6,
  notes: 'short description'
}
```

### 파라미터 의미

- `slideX`
  - 최종적으로 오른쪽으로 얼마나 밀리는지
- `overshootX`
  - 충돌 직전 가장 멀리 나가는 지점
- `dropY`
  - 넘어질 때 아래로 떨어지는 깊이
- `tiltDeg`
  - 충돌 순간 기울기
- `reboundY`
  - 충돌 후 살짝 튀는 높이
- `impactScale`
  - 충돌 순간 커 보이게 하는 스케일
- `fxType`
  - 먼지, 스파크, 연기, 깃털, 물보라 등

## 탈것별 프로필 제안

### car

- 방향: 전진형 + 휠 걸림
- 느낌: 앞바퀴가 턱에 걸리며 코가 먼저 박힘
- 추천 값:
  - `slideX: 11`
  - `overshootX: 15`
  - `dropY: 6`
  - `tiltDeg: 22`
  - `fxType: spark`
  - `fxStrength: 0.45`
- 메모:
  - 충돌 전에 차체가 한 번 들썩여야 함

### rocket

- 방향: 비행형 + 추진 상실
- 느낌: 불꽃이 꺼지며 앞으로 미끄러지다가 연기 속으로 추락
- 추천 값:
  - `slideX: 13`
  - `overshootX: 16`
  - `dropY: 8`
  - `tiltDeg: 18`
  - `fxType: smoke`
  - `fxStrength: 0.85`
- 메모:
  - 먼지보다 연기와 잔불이 우선

### bird

- 방향: 비행형 + 허둥 날갯짓
- 느낌: 날개를 한 번 치며 버티려다 툭 접힘
- 추천 값:
  - `slideX: 8`
  - `overshootX: 10`
  - `dropY: 7`
  - `tiltDeg: 20`
  - `fxType: feather`
  - `fxStrength: 0.75`
- 메모:
  - `brace` 단계에서 날개 허둥거림이 중요

### boat

- 방향: 특수형 + 선수 박힘
- 느낌: 앞으로 기울며 물결에 걸려 턱처럼 처박힘
- 추천 값:
  - `slideX: 9`
  - `overshootX: 12`
  - `dropY: 4`
  - `tiltDeg: 14`
  - `fxType: splash`
  - `fxStrength: 0.78`
- 메모:
  - 먼지 대신 물보라와 수평 흔들림 사용

### bicycle

- 방향: 전진형 + 최고 과장
- 느낌: 앞바퀴가 걸리며 가장 크게 앞으로 고꾸라짐
- 추천 값:
  - `slideX: 14`
  - `overshootX: 18`
  - `dropY: 7`
  - `tiltDeg: 26`
  - `fxType: spark`
  - `fxStrength: 0.68`
- 메모:
  - 이번 fallen 연출에서 가장 드라마틱해야 함

### rabbit

- 방향: 전진형 + 깡총 실수
- 느낌: 뛰다 발이 꼬여서 앞으로 툭 굴러박음
- 추천 값:
  - `slideX: 12`
  - `overshootX: 15`
  - `dropY: 5`
  - `tiltDeg: 18`
  - `fxType: dust`
  - `fxStrength: 0.5`
- 메모:
  - 귀가 한 박자 늦게 따라오면 좋음

### turtle

- 방향: 무게형 + 저중심
- 느낌: 크게 날아가지 않고 짧게 밀린 뒤 툭 눌러앉음
- 추천 값:
  - `slideX: 5`
  - `overshootX: 7`
  - `dropY: 3`
  - `tiltDeg: 9`
  - `fxType: dust`
  - `fxStrength: 0.32`
- 메모:
  - 빠른 붕괴보다 무게감이 중요

### eagle

- 방향: 비행형 + 품위 있는 낙하
- 느낌: 큰 날개를 펴다 접히며 낮게 추락
- 추천 값:
  - `slideX: 9`
  - `overshootX: 12`
  - `dropY: 8`
  - `tiltDeg: 17`
  - `fxType: feather`
  - `fxStrength: 0.82`
- 메모:
  - `bird`보다 더 큰 날개 반응이 있어야 함

### scooter

- 방향: 전진형 + 핸들 흔들림
- 느낌: 핸들이 털린 뒤 차체가 앞쪽으로 쓸림
- 추천 값:
  - `slideX: 10`
  - `overshootX: 13`
  - `dropY: 6`
  - `tiltDeg: 19`
  - `fxType: spark`
  - `fxStrength: 0.42`
- 메모:
  - `car`보다 가볍고 `bicycle`보다 덜 과장

### helicopter

- 방향: 비행형 + 로터 불안정
- 느낌: 로터 균형이 무너지며 동체가 앞으로 처짐
- 추천 값:
  - `slideX: 10`
  - `overshootX: 12`
  - `dropY: 8`
  - `tiltDeg: 16`
  - `fxType: wind`
  - `fxStrength: 0.7`
- 메모:
  - 먼지보다 바람과 잔연기 계열이 맞음

### horse

- 방향: 무게형 + 메인 고급형
- 느낌: 앞다리가 풀리며 가슴부터 미끄러짐
- 추천 값:
  - `slideX: 11`
  - `overshootX: 14`
  - `dropY: 6`
  - `tiltDeg: 20`
  - `fxType: dust`
  - `fxStrength: 0.72`
- 메모:
  - 가장 품질 높게 다뤄야 할 대상
  - 나중에 전용 `pre-fall` 프레임 후보

### knight

- 방향: 무게형 + 갑옷 지연
- 느낌: 늦게 무너지지만 닿을 때는 묵직함
- 추천 값:
  - `slideX: 7`
  - `overshootX: 9`
  - `dropY: 5`
  - `tiltDeg: 15`
  - `fxType: spark`
  - `fxStrength: 0.74`
- 메모:
  - 금속성 충돌감이 중요

### dinosaur

- 방향: 무게형 + 큰 반동
- 느낌: 짧게 밀리고 두 단계로 주저앉음
- 추천 값:
  - `slideX: 8`
  - `overshootX: 11`
  - `dropY: 7`
  - `tiltDeg: 13`
  - `fxType: dust`
  - `fxStrength: 0.88`
- 메모:
  - 먼지 크기는 상위권으로

### ninja

- 방향: 전진형 + 낮은 슬라이드
- 느낌: 헛디딘 뒤 낮게 미끄러지며 사라짐
- 추천 값:
  - `slideX: 13`
  - `overshootX: 17`
  - `dropY: 4`
  - `tiltDeg: 15`
  - `fxType: smoke`
  - `fxStrength: 0.52`
- 메모:
  - 먼지보다 그림자/연막에 가까운 FX

### crab

- 방향: 특수형 + 좌우 불안정
- 느낌: 정면 붕괴보다 옆으로 덜컥거리다 낮게 넘어짐
- 추천 값:
  - `slideX: 6`
  - `overshootX: 8`
  - `dropY: 3`
  - `tiltDeg: 11`
  - `fxType: dust`
  - `fxStrength: 0.38`
- 메모:
  - 좌우 흔들림 보정이 있으면 더 좋음

## 우선순위

### 1차 우선 구현

가장 차이가 잘 보여야 하는 탈것부터 먼저 분리한다.

- `horse`
- `bicycle`
- `car`
- `rocket`
- `bird`

### 2차 우선 구현

보조 FX 차이가 큰 그룹

- `boat`
- `rabbit`
- `eagle`
- `helicopter`

### 3차 우선 구현

기본 파라미터 분기만 먼저 넣어도 충분한 그룹

- `turtle`
- `scooter`
- `knight`
- `dinosaur`
- `ninja`
- `crab`

## 구현 제안

### 단계 1

`AutoTest/horse-devtools.html`에 탈것별 `fallProfile` 객체를 도입한다.

- 목표:
  - 지금 공용으로 쓰는 `slideX`, `overshoot`, `dropY`, `tilt`, `fxType`를 탈것별로 분리

### 단계 2

FX 타입을 분기한다.

- `dust`
- `spark`
- `smoke`
- `feather`
- `splash`
- `wind`

### 단계 3

실제 게임 런타임에 연결한다.

- 후보 파일:
  - `js/horse-race.js`
- 조건:
  - 마지막 스퍼트 구간의 `finish-stun` 계열 보정이 실제로 `fallen`을 요청할 때

### 단계 4

핵심 탈것만 전용 프레임 또는 추가 보정값을 붙인다.

- `horse`
- `bicycle`
- `rocket`
- `bird`
- `boat`

## 추천 구현 순서

1. `fallProfile` 데이터 구조 추가
2. devtools에서 탈것별 전환 차이 먼저 튜닝
3. 실제 게임 런타임에 연결
4. 반응 좋은 프로필만 전용 FX나 추가 상태로 확장

## 결론

이번 fallen 연출은 SVG를 탈것마다 완전히 새로 그리는 방식보다, `fallen` 리소스는 공용으로 두고 `run -> fallen` 전환 모션 프로필만 탈것별로 나누는 쪽이 효율이 좋다.

특히 `horse`, `bicycle`, `car`, `rocket`, `bird` 다섯 개는 차별화 효과가 매우 크게 보일 가능성이 높아서, 구현 첫 단계의 시각적 임팩트를 만들기에 가장 적합하다.
