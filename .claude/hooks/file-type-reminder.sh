#!/bin/bash
# Hook B: 파일 수정 후 유형별 체크리스트 리마인더
# jq가 없으므로 node로 file_path 추출
FILE=$(cat | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.tool_input?.file_path||'')}catch{}})")
case "$FILE" in
  *socket/*.js)
    echo '{"systemMessage":"Socket 핸들러 수정됨. 확인: ctx.checkRateLimit() + ctx.updateRoomsList()"}';;
  *db/*.js)
    echo '{"systemMessage":"DB 모듈 수정됨. 확인: db/init.js 스키마 일치? 마이그레이션 필요?"}';;
  *.html)
    echo '{"systemMessage":"HTML 수정됨. 확인: AdSense(admin제외), 상대경로 API, Socket.IO 버전"}';;
  *horse-app/src/*)
    echo '{"systemMessage":"React 앱 수정됨. 빌드 필요: cd horse-app && npm run build"}';;
esac
