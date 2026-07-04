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
Write-Host "Running mandatory startup gate..." -ForegroundColor Cyan

$branch = git rev-parse --abbrev-ref HEAD
Write-Host "Branch: $branch"

if ($branch -ne "main") {
  Write-Host "ERROR: You are not on main." -ForegroundColor Red
  Write-Host "Current branch: $branch" -ForegroundColor Yellow
  Write-Host "Switch to main or explicitly decide to use a feature branch before coding." -ForegroundColor Yellow
  exit 3
}

$hooksPath = git config --get core.hooksPath
if (-not $hooksPath) {
  Write-Host "ERROR: core.hooksPath is not configured." -ForegroundColor Red
  Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\\scripts\\install-guards.ps1" -ForegroundColor Yellow
  exit 4
}

Write-Host "Hooks path: $hooksPath"

$preCommitPath = Join-Path $currentNorm "$hooksPath\\pre-commit"
if (-not (Test-Path $preCommitPath)) {
  Write-Host "ERROR: pre-commit hook is missing at $preCommitPath" -ForegroundColor Red
  Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\\scripts\\install-guards.ps1" -ForegroundColor Yellow
  exit 5
}

Write-Host "Pre-commit hook: present" -ForegroundColor Green

$shortStatus = git status --short
if ($shortStatus) {
  Write-Host "ERROR: Working tree is not clean." -ForegroundColor Red
  Write-Host $shortStatus
  Write-Host "Commit/stash/discard changes before starting a new coding session." -ForegroundColor Yellow
  exit 6
}

Write-Host "Working tree: clean" -ForegroundColor Green

Write-Host "Last check-in recap:" -ForegroundColor Cyan
git show --no-patch --pretty=format:"  Commit: %h%n  Subject: %s%n  Date: %ci"
Write-Host ""
$headTags = git tag --points-at HEAD
if ($headTags) {
  Write-Host "  Tag(s): $headTags"
} else {
  Write-Host "  Tag(s): none on HEAD"
}

git pull --ff-only origin main

Write-Host "Running quick verification build..." -ForegroundColor Cyan
npm run build

Write-Host "Manual smoke checklist:" -ForegroundColor Cyan
Write-Host "  1) npm run dev"
Write-Host "  2) Verify login"
Write-Host "  3) Verify /fleet"
Write-Host "  4) Verify /reports"
Write-Host "  5) Verify /maintenance/fault-codes"
Write-Host "  6) Verify /fuel-expenses/report"
Write-Host "  7) Confirm no blocking browser errors"

$confirm = Read-Host "Type READY after manual smoke is done"
if ($confirm -ne "READY") {
  Write-Host "Startup gate incomplete. Session is NOT READY." -ForegroundColor Red
  exit 7
}

Write-Host "Startup gate complete. Session is READY." -ForegroundColor Green
