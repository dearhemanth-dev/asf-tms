$ErrorActionPreference = "Stop"

$canonical = "C:\Dev\asf-tms"
$current = (Get-Location).Path

function Normalize-Path([string]$path) {
  return [System.IO.Path]::GetFullPath($path).TrimEnd('\\')
}

$canonicalNorm = Normalize-Path $canonical
$currentNorm = Normalize-Path $current

if ($currentNorm -ine $canonicalNorm) {
  Write-Host "ERROR: Wrong workspace path." -ForegroundColor Red
  Write-Host "Current : $currentNorm" -ForegroundColor Yellow
  Write-Host "Expected: $canonicalNorm" -ForegroundColor Green
  Write-Host "Open VS Code in C:\Dev\asf-tms and run this script there." -ForegroundColor Yellow
  exit 2
}

Write-Host "Workspace OK: $currentNorm" -ForegroundColor Green
Write-Host "Running startup checks..." -ForegroundColor Cyan

$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Branch: $branch"

git status --short

git pull --ff-only origin main

git status --short

Write-Host "Startup checks complete. Repository is ready." -ForegroundColor Green
