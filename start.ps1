param(
  [string]$Config = "conf.toml",
  [string]$Addr = "",
  [switch]$SkipInstall,
  [switch]$SkipBuild,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

Set-Location $PSScriptRoot

function Require-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

Require-Command go
Require-Command npm

$frontendDir = Join-Path $PSScriptRoot "frontend"
$nodeModulesDir = Join-Path $frontendDir "node_modules"
$distDir = Join-Path $frontendDir "dist"

if (-not (Test-Path $Config)) {
  throw "Config file not found: $Config"
}

if (-not $SkipInstall -and -not (Test-Path $nodeModulesDir)) {
  Write-Step "Installing frontend dependencies"
  npm install --prefix $frontendDir
}

if (-not $SkipBuild) {
  Write-Step "Building frontend"
  npm run build --prefix $frontendDir
} elseif (-not (Test-Path $distDir)) {
  Write-Step "Frontend build output not found, building automatically"
  npm run build --prefix $frontendDir
}

$listenAddr = $Addr
if ([string]::IsNullOrWhiteSpace($listenAddr)) {
  $listenAddr = ":8080"
}

$openUrl = if ($listenAddr.StartsWith(":")) {
  "http://127.0.0.1$listenAddr"
} elseif ($listenAddr.StartsWith("0.0.0.0:")) {
  "http://127.0.0.1:$($listenAddr.Substring(8))"
} elseif ($listenAddr.StartsWith("http://") -or $listenAddr.StartsWith("https://")) {
  $listenAddr
} else {
  "http://$listenAddr"
}

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    param($Url)
    Start-Sleep -Seconds 2
    Start-Process $Url
  } -ArgumentList $openUrl | Out-Null
}

Write-Step "Starting Tiler"
Write-Host "Config: $Config"
Write-Host "URL: $openUrl"
Write-Host "Press Ctrl+C to stop."

if ([string]::IsNullOrWhiteSpace($Addr)) {
  go run . -c $Config -serve
} else {
  go run . -c $Config -serve -addr $Addr
}
