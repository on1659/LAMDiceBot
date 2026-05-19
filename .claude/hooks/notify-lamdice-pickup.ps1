# SpriteMake → LAMDice pickup notifier
#
# SpriteMake 측이 batch 작업 완료 후 호출하는 알림 스크립트.
# 호출 조건: 의뢰서 batch 폴더에 READY-FOR-PICKUP 마커 파일이 존재할 때.
#
# 사용법 (SpriteMake 세션 또는 Codex가 batch 작업 끝낸 직후 실행):
#   pwsh D:\Work\LAMDiceBot\.claude\hooks\notify-lamdice-pickup.ps1 `
#        -BatchDir D:\Work\vibe\SpriteMake\output\vehicle-backgrounds-2026-05-19
#
# 동작:
#   1. $BatchDir\READY-FOR-PICKUP 존재 확인 (없으면 종료 — 작업 미완료로 간주)
#   2. LAMDice .claude\inbox\에 spritemake-done-{batchName}.md 마커 작성
#   3. Windows 시스템 사운드 + (옵션) BurntToast 알림
#   4. (옵션) 텔레그램 봇 알림 — $env:LAMDICE_TELEGRAM_BOT_TOKEN + $env:LAMDICE_TELEGRAM_CHAT_ID 설정 시
#
# 중복 처리 방지: READY-FOR-PICKUP을 READY-FOR-PICKUP.processed로 rename.

param(
    [Parameter(Mandatory=$true)][string]$BatchDir
)

$ErrorActionPreference = 'Stop'

$marker = Join-Path $BatchDir 'READY-FOR-PICKUP'
if (-not (Test-Path $marker)) {
    Write-Host "[notify] READY-FOR-PICKUP not found in $BatchDir — skip" -ForegroundColor Yellow
    exit 0
}

$batchName = Split-Path $BatchDir -Leaf
$inboxDir  = 'D:\Work\LAMDiceBot\.claude\inbox'
if (-not (Test-Path $inboxDir)) {
    New-Item -ItemType Directory -Path $inboxDir -Force | Out-Null
}

# 1. inbox 마커 작성
$markerPath = Join-Path $inboxDir "spritemake-done-$batchName.md"
$finalDir   = Join-Path $BatchDir 'final'
$pngCount   = if (Test-Path $finalDir) {
    (Get-ChildItem $finalDir -Filter '*.png' -ErrorAction SilentlyContinue).Count
} else { 0 }

$content = @"
# SpriteMake 완료: $batchName

- 완료 시각: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
- batch 폴더: $BatchDir
- final/ PNG 수: $pngCount
- 의뢰서: D:\Work\LAMDiceBot\docs\spritemake-request\2026-05-19-vehicle-backgrounds.md

## LAMDice 세션에서 이 한 줄 던지세요

  /spritemake-pickup $batchName

또는

  inbox에 $batchName 인수 작업 시작해줘
"@

Set-Content -Path $markerPath -Value $content -Encoding UTF8
Write-Host "[notify] inbox marker created: $markerPath" -ForegroundColor Green

# 2. Windows 알림 (BurntToast 있으면 toast, 없으면 사운드만)
try {
    if (Get-Module -ListAvailable -Name BurntToast) {
        Import-Module BurntToast -ErrorAction Stop
        New-BurntToastNotification `
            -Text 'SpriteMake 완료', "$batchName ($pngCount PNGs) — LAMDice에서 /spritemake-pickup" `
            -Sound 'IM' | Out-Null
    } else {
        [System.Media.SystemSounds]::Asterisk.Play()
    }
} catch {
    Write-Host "[notify] toast/sound 실패: $($_.Exception.Message)" -ForegroundColor Yellow
}

# 3. 텔레그램 알림 (환경변수 설정된 경우만)
$botToken = $env:LAMDICE_TELEGRAM_BOT_TOKEN
$chatId   = $env:LAMDICE_TELEGRAM_CHAT_ID
if ($botToken -and $chatId) {
    try {
        $msg = "SpriteMake 완료: $batchName ($pngCount PNGs)`nLAMDice에서 /spritemake-pickup $batchName"
        $uri = "https://api.telegram.org/bot$botToken/sendMessage"
        Invoke-RestMethod -Uri $uri -Method Post -Body @{
            chat_id = $chatId
            text    = $msg
        } | Out-Null
        Write-Host "[notify] telegram sent to $chatId" -ForegroundColor Green
    } catch {
        Write-Host "[notify] telegram 실패: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# 4. 중복 발사 방지 — 마커 rename
Rename-Item -Path $marker -NewName 'READY-FOR-PICKUP.processed'
Write-Host "[notify] $batchName 알림 완료" -ForegroundColor Cyan
