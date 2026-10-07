<#
.SYNOPSIS
  Clary desktop (Windows) relizi: versiya -> imzolangan build -> latest.json -> serverga yuklash.

.DESCRIPTION
  Desktop ilova interfeysni serverdan (https://app.clary.uz) yuklaydi, shuning uchun
  ODDIY web deploy desktop foydalanuvchilarga ham darhol yetadi ("Yangilash" banneri).
  Bu skript faqat desktop QOBIG'I o'zgarganda kerak (printer/Rust kodi, tauri.conf.json,
  ikonka, ruxsatlar). O'rnatilgan ilovalar clary.uz/download/latest.json'ni ko'rib,
  "Clary desktop X tayyor -> Yangilash" bannerini chiqaradi (bitta tugma).

  Talablar (bir martalik): Rust + MSVC Build Tools (src-tauri/README.md), imzo kaliti
  %USERPROFILE%\.clary\updater.key va uning PAROLI.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\desktop-release.ps1 -Version 0.2.1 -Notes "Printer tuzatildi" -Upload
#>
param(
  [string]$Version,
  [string]$Notes = '',
  [switch]$Upload,
  [switch]$SkipBuild,
  [string]$Server = 'root@72.61.88.214',
  [string]$RemoteDir = '/var/www/download',
  [string]$BaseUrl = 'https://clary.uz/download',
  [string]$KeyPath = "$env:USERPROFILE\.clary\updater.key"
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false   # BOM'siz (tauri.conf.json uchun muhim)

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$webDir = Join-Path $root 'apps\web-clinic'
$tauriDir = Join-Path $webDir 'src-tauri'
$confPath = Join-Path $tauriDir 'tauri.conf.json'
$cargoPath = Join-Path $tauriDir 'Cargo.toml'
$bundleDir = Join-Path $tauriDir 'target\release\bundle\nsis'

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }

# --- 1. Versiya ---------------------------------------------------------------
$confText = [IO.File]::ReadAllText($confPath)
$current = ([regex]'"version":\s*"([^"]+)"').Match($confText).Groups[1].Value
if (-not $Version) { $Version = $current }
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Versiya X.Y.Z ko'rinishida bo'lsin: '$Version'" }
Step "Versiya: $current -> $Version"
# -SkipBuild (tayyor build'ni yuklash) versiya fayllariga tegmaydi
if (-not $SkipBuild -and $current -ne $Version) {
  $confText = ([regex]'"version":\s*"[^"]+"').Replace($confText, "`"version`": `"$Version`"", 1)
  [IO.File]::WriteAllText($confPath, $confText, $utf8)
  $cargoText = [IO.File]::ReadAllText($cargoPath)
  $cargoText = ([regex]'(?m)^version = "[^"]+"').Replace($cargoText, "version = `"$Version`"", 1)
  [IO.File]::WriteAllText($cargoPath, $cargoText, $utf8)
}

$exeName = "Clary_${Version}_x64-setup.exe"
$exePath = Join-Path $bundleDir $exeName
$sigPath = "$exePath.sig"

# --- 2. Imzo kaliti + parol (build'dan OLDIN tekshiriladi) ---------------------
if (-not $SkipBuild) {
  if (-not (Test-Path $KeyPath)) { throw "Imzo kaliti topilmadi: $KeyPath" }
  $pw = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  if (-not $pw) {
    $sec = Read-Host 'Imzo kaliti (updater.key) paroli' -AsSecureString
    $pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
      [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  }
  Step 'Parolni tekshirish (sinov imzosi)'
  $probe = Join-Path $env:TEMP "clary-sign-probe-$PID.txt"
  [IO.File]::WriteAllText($probe, 'probe', $utf8)
  Push-Location $webDir
  try {
    # Bo'sh parol PowerShell'da "" token sifatida tushib qoladi - --password= shakli
    & pnpm exec tauri signer sign -f $KeyPath "--password=$pw" $probe *> $null
    $ok = ($LASTEXITCODE -eq 0) -and (Test-Path "$probe.sig")
  } finally {
    Pop-Location
    Remove-Item $probe, "$probe.sig" -ErrorAction SilentlyContinue
  }
  if (-not $ok) { throw "Imzo paroli noto'g'ri (yoki kalit buzilgan). Build boshlanmadi." }

  # --- 3. Build -----------------------------------------------------------------
  Step "tauri build ($Version)"
  $env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($KeyPath)
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $pw
  Push-Location $webDir
  try {
    & pnpm exec tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build xato bilan tugadi ($LASTEXITCODE)" }
  } finally {
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path $exePath)) { throw "O'rnatuvchi topilmadi: $exePath" }
if (-not (Test-Path $sigPath)) { throw "Imzo (.sig) topilmadi: $sigPath - kalit/parol bilan qayta build qiling" }

# --- 4. latest.json + doimiy nomli o'rnatuvchi --------------------------------
Step 'latest.json'
$manifest = [ordered]@{
  version   = $Version
  notes     = $Notes
  pub_date  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      signature = ([IO.File]::ReadAllText($sigPath)).Trim()
      url       = "$BaseUrl/$exeName"
    }
  }
}
$latestPath = Join-Path $bundleDir 'latest.json'
[IO.File]::WriteAllText($latestPath, ($manifest | ConvertTo-Json -Depth 5), $utf8)
$stablePath = Join-Path $bundleDir 'Clary_x64-setup.exe'
Copy-Item $exePath $stablePath -Force
$sizeMb = [math]::Round((Get-Item $exePath).Length / 1MB, 1)

# --- 5. Serverga yuklash -------------------------------------------------------
if ($Upload) {
  Step "Serverga yuklash: ${Server}:$RemoteDir"
  & ssh $Server "mkdir -p $RemoteDir"
  if ($LASTEXITCODE -ne 0) { throw 'ssh mkdir xato' }
  # latest.json OXIRIDA - mijozlar manifestni o'rnatuvchidan oldin ko'rmasin
  & scp $exePath $sigPath $stablePath $latestPath "${Server}:$RemoteDir/"
  if ($LASTEXITCODE -ne 0) { throw 'scp xato' }
}

Step 'Tayyor'
Write-Host "  Versiya:        $Version  ($sizeMb MB)"
Write-Host "  Fayllar:        $bundleDir"
Write-Host "  Yuklab olish:   $BaseUrl/Clary_x64-setup.exe   (doimiy havola)"
Write-Host "  Manifest:       $BaseUrl/latest.json"
if (-not $Upload) {
  Write-Host "`n  Serverga hali yuklanmadi. Yuklash: shu buyruqni -SkipBuild -Upload bilan qayta ishga tushiring." -ForegroundColor Yellow
}
Write-Host "  Tekshirish:     curl -I $BaseUrl/Clary_x64-setup.exe ; curl $BaseUrl/latest.json"
Write-Host "  Eslatma: tauri.conf.json/Cargo.toml versiyasini commit qiling."
