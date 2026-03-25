param(
  [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'

function Get-ListeningPids {
  param([int]$ListenPort)

  $lines = netstat -ano | Select-String ":$ListenPort"
  $pids = @()

  foreach ($line in $lines) {
    $text = $line.ToString().Trim()
    if ($text -notmatch 'LISTENING') {
      continue
    }

    $parts = $text -split '\s+'
    if ($parts.Length -lt 5) {
      continue
    }

    $targetPid = $parts[-1]
    if ($targetPid -match '^\d+$') {
      $pids += [int]$targetPid
    }
  }

  return $pids | Sort-Object -Unique
}

$pids = Get-ListeningPids -ListenPort $Port

if (-not $pids -or $pids.Count -eq 0) {
  Write-Host "No listening process found on port $Port."
  exit 0
}

foreach ($targetPid in $pids) {
  Write-Host "Stopping PID $targetPid on port $Port..."
  taskkill /PID $targetPid /F | Out-Null
}

Write-Host "Done."
