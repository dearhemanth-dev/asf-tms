$ErrorActionPreference = "Stop"

$repoRoot = (git rev-parse --show-toplevel).Trim()
$expected = "C:\Dev\asf-tms"

function Normalize-Path([string]$path) {
  return [System.IO.Path]::GetFullPath($path).TrimEnd('\\')
}

$repoRootNorm = Normalize-Path $repoRoot
$expectedNorm = Normalize-Path $expected

if ($repoRootNorm -ine $expectedNorm) {
  Write-Host "ERROR: Run this only in canonical repo: $expectedNorm" -ForegroundColor Red
  Write-Host "Current: $repoRootNorm" -ForegroundColor Yellow
  exit 2
}

git config core.hooksPath .githooks
Write-Host "Installed repo hooks path: .githooks" -ForegroundColor Green
Write-Host "Canonical guard active for commits in $repoRootNorm" -ForegroundColor Green
