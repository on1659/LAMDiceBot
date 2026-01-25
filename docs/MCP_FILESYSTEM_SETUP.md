# MCP Filesystem 서버 설정 가이드

## 개요
Cursor IDE에서 파일 관리를 위한 MCP (Model Context Protocol) Filesystem 서버를 추가하는 방법입니다.

## 설치 방법

### 1. Filesystem MCP 서버 설치

전역 설치:
```bash
npm install -g @modelcontextprotocol/server-filesystem
```

또는 npx로 직접 실행:
```bash
npx -y @modelcontextprotocol/server-filesystem
```

### 2. Cursor MCP 설정

#### 방법 A: Cursor UI에서 설정
1. Cursor 설정 열기: `Ctrl + ,` 또는 `File > Preferences > Settings`
2. `Features > MCP` 섹션으로 이동
3. `+ Add New MCP Server` 클릭
4. 다음 정보 입력:
   - **Name**: `Filesystem` (원하는 이름)
   - **Type**: `stdio`
   - **Command**: 
     - 전역 설치한 경우: `mcp-server-filesystem`
     - npx 사용: `npx -y @modelcontextprotocol/server-filesystem`
   - **Args**: 허용할 디렉토리 경로 (예: `D:\Work\LAMDiceBot`)

#### 방법 B: 설정 파일 직접 수정
`%USERPROFILE%\.cursor\mcp.json` 파일 생성/수정:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "D:\\Work\\LAMDiceBot"
      ],
      "env": {}
    }
  }
}
```

### 3. 디렉토리 접근 제어

보안을 위해 특정 디렉토리만 허용:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "D:\\Work\\LAMDiceBot",
        "D:\\Work\\OtherProject"
      ]
    }
  }
}
```

## 사용 가능한 기능

Filesystem MCP 서버는 다음 기능을 제공합니다:

- **파일 읽기/쓰기**: 파일 내용 읽기 및 수정
- **디렉토리 관리**: 디렉토리 생성, 목록 조회, 삭제
- **파일 이동/복사**: 파일 및 디렉토리 이동
- **파일 검색**: 디렉토리 내 파일 검색
- **메타데이터 조회**: 파일 크기, 수정 시간 등

## 사용 방법

1. Cursor 재시작
2. Composer에서 파일 관련 작업 시 자동으로 MCP 도구 사용
3. 명시적으로 요청: "파일 목록 보여줘", "파일 읽어줘" 등

## 문제 해결

### MCP 서버가 작동하지 않는 경우
1. Cursor 재시작 확인
2. `mcp.json` 파일 경로 확인
3. npm 패키지 설치 확인: `npm list -g @modelcontextprotocol/server-filesystem`
4. Cursor 로그 확인: `Help > Toggle Developer Tools > Console`

### 권한 오류
- 허용된 디렉토리 경로 확인
- 디렉토리 접근 권한 확인

## 참고 자료
- [MCP 공식 문서](https://modelcontextprotocol.io/)
- [Cursor MCP 가이드](https://cursor.com/docs/context/mcp)
