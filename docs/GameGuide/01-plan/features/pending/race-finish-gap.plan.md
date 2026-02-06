# 경마 순위 간 최소 거리 보장 계획

## 문제
- 꼴등과 그 다음 말이 거의 동시에 들어오는 경우 발생
- 서버 순위로 정리는 되지만, 시각적으로 구분이 안 됨

## 핵심 요구사항
- **순위 동기화 최우선**: 서버 순위 = 클라이언트 도착 순서
- 시각적으로 들어오는 시점에 최소 간격 보장
- **속도 조정 방식**: 처음부터 순위별 속도 차이로 자연스럽게 간격 발생

## 구조
1. 서버: `rankings[].finishTime` → 클라이언트로 전송
2. 클라이언트: `baseSpeed = totalDistance / finishTime` 계산
3. 속도 차이로 자연스럽게 도착 간격 발생

## 수정 파일
**파일**: `socket/horse.js` (calculateHorseRaceResult 함수 내)

### 현재 코드
```javascript
const rankings = simResults.map((result, rank) => ({
    horseIndex: result.horseIndex,
    rank: rank + 1,
    finishTime: result.baseDuration,
    speed: parseFloat((0.8 + Math.random() * 0.7).toFixed(2))
}));
```

### 수정 코드
```javascript
// 최소 3m 간격 보장 (약 200ms)
const MIN_GAP_MS = 200;
let lastFinishTime = 0;

const rankings = simResults.map((result, rank) => {
    let finishTime = result.baseDuration;
    // 이전 순위보다 최소 200ms 늦게 도착하도록 조정
    if (rank > 0 && finishTime - lastFinishTime < MIN_GAP_MS) {
        finishTime = lastFinishTime + MIN_GAP_MS;
    }
    lastFinishTime = finishTime;

    return {
        horseIndex: result.horseIndex,
        rank: rank + 1,
        finishTime: finishTime,
        speed: parseFloat((0.8 + Math.random() * 0.7).toFixed(2))
    };
});
```

## 효과
- 클라이언트에서 `baseSpeed = totalDistance / finishTime`
- finishTime이 200ms씩 차이나면 → 속도가 조금씩 느려짐 → 자연스럽게 간격 발생

## 검증 방법
- 콘솔 로그에서 `[서버시뮬]` 메시지로 finishTime 간격 확인
- 경마 실행 후 시각적으로 모든 말이 충분한 간격으로 들어오는지 확인

## 상태
- [ ] 구현 대기 중
- [ ] 테스트 완료
- [ ] 배포 완료
