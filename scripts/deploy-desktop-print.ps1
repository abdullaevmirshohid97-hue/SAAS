<#
  CLARY - desktop chop etish tuzatishi (f12b2a0): prod deploy (kompyuterdan bitta buyruq)
  -------------------------------------------------------------
  Ishlatish (PowerShell):
    powershell -ExecutionPolicy Bypass -File D:\SAAS\scripts\deploy-desktop-print.ps1
    ... -WithApi   API'ni ham yangilaydi (LAN printer matnida "×" → "x"; shart emas)
    ... -DryRun    serverga ulanmaydi, nima bajarilishini ko'rsatadi

  Nima qiladi:
    root@SERVER ga SSH (root paroli so'raladi) -> /opt/clary: git pull ->
    scripts/deploy-desktop-print.sh (web-clinic build -> /var/www/app -> tekshiruv)

  Migratsiya va maxfiy kalit YO'Q — parol faqat SSH tomonidan so'raladi.
#>
param(
  [switch]$WithApi,
  [switch]$DryRun,
  [string]$Server = 'root@72.61.88.214'
)

$ErrorActionPreference = 'Stop'

$flags = ''
if ($WithApi) { $flags = ' --with-api' }

$remote = "set -euo pipefail; cd /opt/clary; " +
  "git fetch -q origin main && git checkout -q main && git pull --ff-only -q origin main; " +
  "bash scripts/deploy-desktop-print.sh$flags"

if ($DryRun) {
  Write-Host "=== $Server - bajariladigan buyruq ===" -ForegroundColor Cyan
  Write-Host $remote
  exit 0
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
  Write-Host 'XATO: ssh topilmadi (Windows: Sozlamalar -> Ilovalar -> Qo''shimcha imkoniyatlar -> OpenSSH Client)' -ForegroundColor Red
  exit 1
}

Write-Host ">> $Server ga ulanilmoqda (root paroli so'raladi)..." -ForegroundColor Cyan
& ssh -t $Server $remote
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host "XATO: deploy yakunlanmadi (exit $LASTEXITCODE). Yuqoridagi qizil qatorni ko'ring." -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host ''
Write-Host 'TAYYOR: desktop ilovada "Yangilash" bannerini bosing, keyin Sozlamalar -> Termal printerlar -> Sinov.' -ForegroundColor Green
