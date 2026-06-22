# Release Playbook (ASF TMS)

Use this file every time you cut a version so rollbacks are easy.

## 1) Version naming

Recommended format:

- Tag: `vYYYY.MM.DD.N` (example: `v2026.06.21.1`)
- Optional hotfix tag: `vYYYY.MM.DD.N-hotfix.1`

## 2) Commit message template

Use this structure:

- Subject: `release: <short release title>`
- Body:
  - `Scope:` pages/components touched
  - `Highlights:` user-facing behavior changes
  - `Fixes:` bug fixes
  - `Notes:` known limitations

Example:

`release: fleet/list-view and reports UX alignment`

`Scope: TopNav, FleetViewClient, reports headers`
`Highlights: list view hauling popup simplified; accounts menu trimmed`
`Fixes: repairs report back route to fleet; report back buttons standardized`
`Notes: top-menu hauling MPH removed by request`

## 3) Git commands (first-time setup)

Run from project root:

```powershell
# Install Git first if missing
# winget install --id Git.Git -e

# Initialize repo if needed
git init

git add .
git commit -m "chore: initial project import"

# Connect remote (replace URL)
git branch -M main
git remote add origin <YOUR_GIT_REMOTE_URL>
git push -u origin main
```

## 4) Git commands (new release)

```powershell
# 1) Review changes
git status
git add .

# 2) Commit release
git commit -m "release: <short release title>" -m "Scope: ..." -m "Highlights: ..." -m "Fixes: ..." -m "Notes: ..."

# 3) Tag release
git tag -a vYYYY.MM.DD.N -m "ASF TMS release vYYYY.MM.DD.N"

# 4) Push commit + tag
git push origin main
git push origin vYYYY.MM.DD.N
```

## 5) Rollback options

### Option A: Fast safe rollback (recommended)

Create a new commit that undoes a bad release:

```powershell
# Revert the release commit
git revert <BAD_COMMIT_SHA>
git push origin main
```

### Option B: Restore app to a known good tag

```powershell
# Create rollback branch from good tag
git checkout -b rollback/vYYYY.MM.DD.N vYYYY.MM.DD.N
git push -u origin rollback/vYYYY.MM.DD.N
```

### Option C: Hard reset main (only if team agrees)

```powershell
git checkout main
git reset --hard vYYYY.MM.DD.N
git push --force-with-lease origin main
```

## 6) Release description template (copy/paste)

Title:

`ASF TMS Release vYYYY.MM.DD.N`

Description:

`What changed`
- `...`
- `...`

`Why`
- `...`

`Validation`
- `Production build passed`
- `Key paths manually checked: login, fleet map/list, reports`

`Rollback`
- `Tag: vYYYY.MM.DD.N`
- `Revert command: git revert <release_commit_sha>`

## 7) Current release draft (this session)

Suggested title:

`release: fleet ui refinements and reports navigation consistency`

Suggested highlights:

- Fleet list view metrics and labels refined per role/user feedback
- Hauling/Home popup content simplified for mobile readability
- Top-menu hauling MPH removed where requested
- Reports and fuel pages now use consistent top-left back button placement
- Accounts burger menu no longer shows Fleet and Fuel Import

Suggested rollback anchor:

- Create tag after commit: `v2026.06.21.1`
