<#
  CLARY - A0: rahbar hisobotlari + obuna teshigi + chek matni -> prod deploy (kompyuterdan bitta buyruq)
  -------------------------------------------------------------
  Ishlatish (PowerShell, KECHQURUN - klinikalar yopilganda):
    powershell -ExecutionPolicy Bypass -File D:\SAAS\scripts\deploy-analytics-a0.ps1
    ... -DbOnly    faqat migratsiya (20261125000001) + tekshiruv
    ... -CodeOnly  faqat kod (migratsiya avval qo'llangan bo'lsa)
    ... -DryRun    serverga ulanmaydi, nima bajarilishini ko'rsatadi

  Nima qiladi:
    root@SERVER ga SSH (root paroli so'raladi) -> /opt/clary: git pull ->
    scripts/deploy-analytics-a0.sh (migratsiya -> sinov -> api + web-clinic + web-admin -> tekshiruv)

  Baza paroli serverdagi env fayllaridan yoki ~/.clary-db dan olinadi.
#>
param(
  [switch]$DbOnly,
  [switch]$CodeOnly,
  [switch]$DryRun,
  [string]$Server = 'root@72.61.88.214'
)

$ErrorActionPreference = 'Stop'

if ($DbOnly -and $CodeOnly) {
  Write-Host 'XATO: -DbOnly va -CodeOnly birga ishlatilmaydi' -ForegroundColor Red
  exit 1
}
$flags = ''
if ($DbOnly) { $flags = ' --db-only' }
if ($CodeOnly) { $flags = ' --code-only' }

$remote = "set -euo pipefail; cd /opt/clary; " +
  "git fetch -q origin main && git checkout -q main && git pull --ff-only -q origin main; " +
  "bash scripts/deploy-analytics-a0.sh$flags"

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
Write-Host 'TAYYOR: brauzerda Ctrl+Shift+R -> Analitika ("Kassa foydasi", "Bemorlar qarzi"); desktop ilovada "Yangilash".' -ForegroundColor Green
