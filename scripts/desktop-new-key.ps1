<#
.SYNOPSIS
  Clary desktop: YANGI updater imzo kaliti (parol bilan) yaratish.

.DESCRIPTION
  Eski kalitning paroli yo'qolganda ishlatiladi. Parolni "almashtirib" bo'lmaydi:
  kalit parol bilan shifrlangan, eski parolsiz uni ochib bo'lmaydi. Shuning uchun
  yangi kalit-jufti yaratiladi va uning ochiq qismi tauri.conf.json'ga yoziladi.

  Skript:
    1. eski kalitni o'chirmaydi - ~/.clary/eski-<sana>/ ga ko'chiradi;
    2. yangi parolni ikki marta so'raydi (kamida 8 belgi);
    3. tauri signer generate bilan kalit yaratadi;
    4. sinov imzosi bilan parolni tekshiradi;
    5. ochiq kalitni tauri.conf.json -> plugins.updater.pubkey ga yozadi;
    6. xohlasangiz parolni D:\1997\PAROLLAR.md ga qo'shadi.

  OQIBAT: 0.1.x o'rnatilgan kompyuterlar eski ochiq kalitni biladi - yangi kalit
  bilan imzolangan yangilanishni QABUL QILMAYDI. Ularga 0.2.0 ni bir marta qo'lda
  o'rnatish kerak (clary.uz/download). Undan keyin hammasi avtomatik.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\desktop-new-key.ps1
#>
param(
  [string]$KeyDir = "$env:USERPROFILE\.clary",
  [string]$ConfPath,
  [string]$PasswordsFile = 'D:\1997\PAROLLAR.md',
  # Faqat avtomatik sinov uchun - buyruqlar tarixida qoladi, oddiy ishda ISHLATMANG
  [string]$Password
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $root 'apps\web-clinic'
if (-not $ConfPath) { $ConfPath = Join-Path $webDir 'src-tauri\tauri.conf.json' }
$keyPath = Join-Path $KeyDir 'updater.key'
$pubPath = "$keyPath.pub"

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Plain($sec) {
  [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

Write-Host "Yangi updater imzo kaliti yaratiladi." -ForegroundColor Yellow
Write-Host "0.1.x o'rnatilgan kompyuterlar 0.2.0 ni bir marta QO'LDA o'rnatishi kerak bo'ladi." -ForegroundColor Yellow

# --- 1. Parol ------------------------------------------------------------------
if (-not $Password) {
  $go = Read-Host "Davom etilsinmi? (ha/yo'q)"
  if ($go -ne 'ha') { Write-Host 'Bekor qilindi.'; exit 1 }
  $p1 = Plain (Read-Host 'Yangi parol (kamida 8 belgi)' -AsSecureString)
  $p2 = Plain (Read-Host 'Parolni takrorlang' -AsSecureString)
  if ($p1 -ne $p2) { throw 'Parollar bir xil emas.' }
  $Password = $p1
}
if ($Password.Length -lt 8) { throw "Parol kamida 8 belgi bo'lsin." }

# --- 2. Eski kalitni zaxiraga ---------------------------------------------------
New-Item -ItemType Directory -Force $KeyDir | Out-Null
if (Test-Path $keyPath) {
  $old = Join-Path $KeyDir ("eski-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  Step "Eski kalit zaxiraga: $old"
  New-Item -ItemType Directory -Force $old | Out-Null
  Move-Item $keyPath $old
  if (Test-Path $pubPath) { Move-Item $pubPath $old }
}

# --- 3. Yaratish ---------------------------------------------------------------
Step "Kalit yaratish: $keyPath"
Push-Location $webDir
try {
  & pnpm exec tauri signer generate -w $keyPath "--password=$Password" --ci *> $null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $keyPath) -or -not (Test-Path $pubPath)) {
    throw 'tauri signer generate xato bilan tugadi'
  }

  # --- 4. Sinov imzosi ---------------------------------------------------------
  Step 'Parolni tekshirish (sinov imzosi)'
  $probe = Join-Path $env:TEMP "clary-newkey-probe-$PID.txt"
  [IO.File]::WriteAllText($probe, 'probe', $utf8)
  & pnpm exec tauri signer sign -f $keyPath "--password=$Password" $probe *> $null
  $ok = Test-Path "$probe.sig"
  Remove-Item $probe, "$probe.sig" -ErrorAction SilentlyContinue
  if (-not $ok) { throw 'Sinov imzosi chiqmadi - kalitni tekshiring' }
} finally {
  Pop-Location
}

# --- 5. tauri.conf.json -> pubkey ---------------------------------------------
$pub = ([IO.File]::ReadAllText($pubPath)).Trim()
Step "Ochiq kalit -> $ConfPath"
$conf = [IO.File]::ReadAllText($ConfPath)
$re = [regex]'"pubkey":\s*"[^"]*"'
if (-not $re.IsMatch($conf)) { throw "tauri.conf.json'da pubkey topilmadi" }
$conf = $re.Replace($conf, ('"pubkey": "' + $pub + '"'), 1)
[IO.File]::WriteAllText($ConfPath, $conf, $utf8)

# --- 6. Parolni saqlash ---------------------------------------------------------
if ((Test-Path $PasswordsFile) -and -not $PSBoundParameters.ContainsKey('Password')) {
  $save = Read-Host "Parol $PasswordsFile ga yozib qo'yilsinmi? (ha/yo'q)"
  if ($save -eq 'ha') {
    $line = "`r`n- Tauri updater imzo kaliti PAROLI ($(Get-Date -Format 'yyyy-MM-dd'), $keyPath): $Password`r`n"
    [IO.File]::AppendAllText($PasswordsFile, $line, $utf8)
    Write-Host "  Yozildi."
  }
}

Step 'Tayyor'
Write-Host "  Maxfiy kalit:  $keyPath   <- ikkinchi joyga (fleshka/Drive) ham nusxa oling!"
Write-Host "  Ochiq kalit:   tauri.conf.json ga yozildi - commit qiling."
Write-Host "  Keyingi qadam: scripts\desktop-release.ps1 -Version 0.2.0 -Notes `"...`" -Upload"
Write-Host "  Kalit YOKI parol yo'qolsa - o'rnatilgan ilovalar avto-yangilanishni yo'qotadi."
