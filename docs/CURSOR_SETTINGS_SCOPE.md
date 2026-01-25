# Cursor 설정 범위 가이드

## 현재 설정 상태

### 1. Cursor IDE 전체 설정 (모든 프로젝트에 적용)

#### 위치
- **MCP 설정**: `%USERPROFILE%\.cursor\mcp.json` (예: `C:\Users\user\.cursor\mcp.json`)
- **IDE 설정**: `%APPDATA%\Cursor\User\settings.json` (예: `C:\Users\user\AppData\Roaming\Cursor\User\settings.json`)

#### 적용 범위
- ✅ **모든 프로젝트**에 적용됩니다
- ✅ Cursor IDE를 열 때마다 자동으로 로드됩니다
- ✅ 다른 프로젝트에서도 동일한 MCP 서버와 IDE 설정을 사용합니다

#### 현재 설정 내용
- MCP 서버: Filesystem, Git, Fetch, GitHub
- IDE 최적화: 메모리 최적화, 파일 감시 제외 등

---

## 프로젝트별 설정 (이 프로젝트에만 적용)

### 프로젝트별 MCP 설정 만들기

프로젝트 루트에 `.cursor/mcp.json` 파일을 만들면 **이 프로젝트에서만** 적용됩니다.

#### 설정 방법

1. **프로젝트 루트에 `.cursor` 폴더 생성**
   ```
   D:\Work\LAMDiceBot\.cursor\mcp.json
   ```

2. **프로젝트별 MCP 설정 파일 생성**
   ```json
   {
     "mcpServers": {
       "filesystem": {
         "command": "npx",
         "args": [
           "-y",
           "@modelcontextprotocol/server-filesystem",
           "D:\\Work\\LAMDiceBot"
         ]
       },
       "git": {
         "command": "npx",
         "args": [
           "-y",
           "@modelcontextprotocol/server-git",
           "D:\\Work\\LAMDiceBot"
         ]
       }
     }
   }
   ```

3. **프로젝트별 Cursor 규칙 설정** (`.cursorrules` 파일)
   ```
   D:\Work\LAMDiceBot\.cursorrules
   ```
   
   이 파일에 프로젝트별 코딩 규칙, 스타일 가이드 등을 작성할 수 있습니다.

---

## 권장 설정 방법

### 옵션 1: 전역 설정 유지 (현재 상태)
**장점:**
- 모든 프로젝트에서 동일한 MCP 서버 사용
- 설정 관리가 간단함
- 한 번 설정하면 모든 프로젝트에서 사용

**단점:**
- 프로젝트별로 다른 설정이 필요할 때 불편함

### 옵션 2: 프로젝트별 설정 추가
**장점:**
- 프로젝트별로 최적화된 설정 가능
- 팀원들과 설정 공유 가능 (`.cursor/mcp.json`을 Git에 포함)
- 프로젝트별 특화된 MCP 서버 사용 가능

**단점:**
- 프로젝트마다 설정 파일 관리 필요

---

## 설정 우선순위

Cursor는 다음 순서로 설정을 로드합니다:

1. **프로젝트별 설정** (`.cursor/mcp.json` 또는 `.cursorrules`)
   - 이 프로젝트에서만 적용
   - 전역 설정보다 우선순위 높음

2. **전역 설정** (`%USERPROFILE%\.cursor\mcp.json`)
   - 모든 프로젝트에 적용
   - 프로젝트별 설정이 없을 때 사용

---

## 현재 프로젝트에 적용된 설정

### 전역 설정 (모든 프로젝트)
- ✅ MCP Filesystem 서버
- ✅ MCP Git 서버
- ✅ MCP Fetch 서버
- ✅ MCP GitHub 서버
- ✅ IDE 메모리 최적화 설정

### 프로젝트별 설정
- ❌ 없음 (현재는 전역 설정만 사용)

---

## 프로젝트별 설정이 필요한 경우

다음과 같은 경우 프로젝트별 설정을 만드는 것을 권장합니다:

1. **프로젝트별 특화된 MCP 서버**가 필요한 경우
   - 예: 이 프로젝트에서만 사용하는 Database MCP

2. **팀원들과 설정 공유**가 필요한 경우
   - `.cursor/mcp.json`을 Git에 포함하여 팀원들과 공유

3. **프로젝트별 코딩 규칙**이 필요한 경우
   - `.cursorrules` 파일에 프로젝트별 규칙 작성

---

## 참고

- 전역 설정과 프로젝트별 설정은 **공존**할 수 있습니다
- 프로젝트별 설정이 있으면 해당 프로젝트에서는 프로젝트별 설정이 우선 적용됩니다
- 다른 프로젝트에서는 전역 설정이 계속 적용됩니다
