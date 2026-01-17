# 🚂 Railway 배포 완벽 가이드

## 📋 준비된 파일

모든 파일이 Railway 배포용으로 준비되었습니다!
- ✅ `server.js` - PORT 환경변수 지원
- ✅ `package.json` - Node 버전 명시 (>=20.19.0)
- ✅ `.nvmrc` - Node.js 버전 명시 (20.19.0)
- ✅ `.gitignore` - 불필요한 파일 제외

**⚠️ 중요:** Vite 7.x는 Node.js 20.19+ 또는 22.12+가 필요합니다. `.nvmrc` 파일이 자동으로 Railway에서 인식됩니다.

## 🚀 배포 단계별 가이드

### 1단계: GitHub 계정 준비

1. **GitHub 계정이 없다면:**
   - https://github.com 접속
   - "Sign up" 클릭
   - 이메일, 비밀번호 입력
   - 계정 생성 완료!

2. **GitHub에 로그인**

### 2단계: GitHub에 코드 업로드

#### 방법 A: GitHub 웹사이트 사용 (가장 쉬움!)

1. **새 저장소 만들기**
   - https://github.com/new 접속
   - Repository name: `dice-game-multiplayer`
   - Public 선택
   - "Create repository" 클릭

2. **파일 업로드**
   - "uploading an existing file" 클릭
   - 다음 파일들을 드래그 앤 드롭:
     * server.js
     * dice-game-multiplayer.html
     * package.json
     * .gitignore
   - "Commit changes" 클릭

#### 방법 B: GitHub Desktop 사용 (추천)

1. **GitHub Desktop 다운로드**
   - https://desktop.github.com
   - 설치 후 GitHub 계정으로 로그인

2. **저장소 생성**
   - File → New Repository
   - Name: `dice-game-multiplayer`
   - Local Path: 프로젝트 폴더 선택
   - "Create Repository" 클릭

3. **파일 커밋**
   - 왼쪽에 변경된 파일 목록 표시됨
   - Summary: "Initial commit"
   - "Commit to main" 클릭

4. **GitHub에 업로드**
   - "Publish repository" 클릭
   - Public 선택
   - "Publish repository" 클릭

#### 방법 C: Git 명령어 (개발자용)

```bash
# 프로젝트 폴더에서
git init
git add .
git commit -m "Initial commit"
git branch -M main

# GitHub 저장소 연결 (저장소 생성 후)
git remote add origin https://github.com/[사용자명]/dice-game-multiplayer.git
git push -u origin main
```

### 3단계: Railway 배포

1. **Railway 접속**
   - https://railway.app 접속

2. **로그인**
   - "Login" 클릭
   - "Login with GitHub" 선택
   - GitHub 계정으로 로그인
   - Railway 권한 승인

3. **새 프로젝트 생성**
   - "New Project" 클릭
   - "Deploy from GitHub repo" 선택

4. **저장소 선택**
   - `dice-game-multiplayer` 찾기
   - 클릭하여 선택

5. **배포 시작!**
   - 자동으로 배포 시작됨
   - 진행 상황 실시간 확인 가능
   - 2-3분 소요

6. **배포 완료 대기**
   - "Active" 상태가 되면 완료!

### 4단계: 도메인 생성

1. **프로젝트 클릭**
   - 배포된 서비스 클릭

2. **Settings 탭 이동**

3. **도메인 생성**
   - "Networking" 섹션 찾기
   - "Generate Domain" 클릭
   - 무료 도메인 자동 생성! 🎉

4. **도메인 복사**
   - 예시: `https://dice-game-production-abc123.up.railway.app`
   - 이 주소를 친구들에게 공유!

### 5단계: 접속 테스트

1. **생성된 도메인 클릭**
2. **게임 화면이 나타나면 성공!** 🎲
3. **여러 기기에서 동시 접속 테스트**

## ✅ 완료!

이제 전 세계 어디서나 HTTPS로 접속 가능합니다!

```
친구 A (한국): https://your-app.up.railway.app
친구 B (미국): https://your-app.up.railway.app
친구 C (유럽): https://your-app.up.railway.app

→ 모두 같은 게임에 접속! 🌍
```

## 🔄 코드 업데이트 방법

### GitHub Desktop 사용:
1. 파일 수정
2. GitHub Desktop에서 변경사항 확인
3. "Commit to main" 클릭
4. "Push origin" 클릭
5. Railway가 자동으로 재배포! 🚀

### Git 명령어:
```bash
git add .
git commit -m "Update feature"
git push
```

## 📊 모니터링

Railway 대시보드에서:
- **Deployments**: 배포 기록
- **Logs**: 실시간 로그 (console.log 확인 가능)
- **Metrics**: CPU/메모리 사용량
- **Settings**: 환경변수, 도메인 설정

## 💰 비용

**무료 플랜:**
- 월 500시간 무료 ($5 크레딧)
- 대부분의 소규모 프로젝트에 충분
- 시간 초과 시 서비스 중지 (다음 달 다시 시작)

**사용 시간 확인:**
- Railway 대시보드 → Usage 탭

## 🛑 문제 해결

### 배포 실패 시

1. **Logs 확인**
   - Deployments → 실패한 배포 클릭
   - Build Logs 또는 Deploy Logs 확인

2. **흔한 에러:**
   ```
   Error: Cannot find module 'express'
   ```
   → package.json 파일이 없거나 잘못됨
   
   ```
   Port already in use
   ```
   → 포트 설정 확인 (환경변수 사용해야 함)
   
   ```
   You are using Node.js 18.20.8. Vite requires Node.js version 20.19+ or 22.12+.
   ```
   → Node.js 버전 문제 (`.nvmrc` 파일이 있으면 자동 해결됨)
   → Railway Settings → Variables에서 `NODE_VERSION=20.19.0` 추가

3. **해결 안 되면:**
   - GitHub 저장소 확인 (모든 파일이 있는지)
   - Railway 프로젝트 삭제 후 재생성

### 도메인 접속 안 됨

1. **배포 상태 확인**
   - Active 상태인지 확인
   - Crashed 상태라면 Logs 확인

2. **시간 대기**
   - 첫 배포는 2-3분 소요
   - 도메인 생성 직후 1분 정도 대기

## 🎯 추가 기능

### 환경변수 설정
Railway 대시보드:
- Variables 탭
- `NEW_VARIABLE` 클릭
- 변수 추가 (예: `MAX_USERS=100`)

### 커스텀 도메인 연결
1. 도메인 구입 (Namecheap 등)
2. Railway → Settings → Domains
3. Custom Domain 추가
4. DNS 설정 (Railway가 안내)

### 자동 배포 중지
- Settings → Service
- Auto Deploy 토글 OFF

## 📱 모바일 접속

Railway 도메인은 모바일에서도 바로 작동합니다!
- iOS Safari ✅
- Android Chrome ✅

## 🎉 장점 요약

✅ **완전 무료** (월 500시간)
✅ **자동 HTTPS** (SSL 인증서 자동)
✅ **무료 도메인** (.up.railway.app)
✅ **자동 배포** (Git push만 하면 됨)
✅ **24시간 운영** (컴퓨터 꺼도 됨)
✅ **실시간 로그** (디버깅 쉬움)
✅ **설정 5분** (ngrok보다 쉬움)

## 🆚 ngrok과 비교

| 항목 | Railway | ngrok |
|------|---------|-------|
| 무료 사용 | 월 500시간 | 무제한 |
| 도메인 | 고정 | 매번 변경 |
| 컴퓨터 | 꺼도 됨 | 켜져 있어야 함 |
| 설정 | 한 번만 | 매번 실행 |
| HTTPS | 자동 | 자동 |

## 📞 도움말

**Railway 공식 문서:**
- https://docs.railway.app

**커뮤니티:**
- Discord: https://discord.gg/railway

**문제 발생 시:**
1. Logs 확인
2. GitHub 저장소 확인
3. Railway 문서 참고

---

## 🎊 축하합니다!

이제 당신의 주사위 게임이 인터넷에 공개되었습니다! 🎲

친구들과 함께 즐기세요! 🎉
