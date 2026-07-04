# ASF TMS Solo Workflow (Canonical)

## Canonical Workspace
- Active development path: C:/Dev/asf-tms
- Do not develop from OneDrive paths.
- OneDrive copies are archive-only.

## Daily Start
1. Open C:/Dev/asf-tms in VS Code.
2. Preferred: run startup guard script:
   - powershell -ExecutionPolicy Bypass -File .\\scripts\\start-dev.ps1
3. Run: git status --short
4. Confirm branch: git rev-parse --abbrev-ref HEAD
5. Pull latest: git pull --ff-only origin main

## Hard Guard
1. Install repo guard once in the canonical repo:
   - powershell -ExecutionPolicy Bypass -File .\\scripts\\install-guards.ps1
2. This activates a repo-managed pre-commit hook.
3. The hook blocks commits if they are attempted from a non-canonical workspace path.

## Assistant Operating Pattern
1. At the start of each new coding chat/session, run the Daily Start checklist first.
2. Before risky edits, create a checkpoint commit or tag.
3. Before any deploy, capture rollback target first.
4. After any meaningful milestone, commit before moving on.

## During Development
1. Work on main (solo mode).
2. Commit every logical milestone (30-90 minutes).
3. Before risky changes, create a checkpoint tag:
   - git tag -a checkpoint/YYYY-MM-DD-HHMM -m "short note"

## Before Production Deploy
1. Ensure clean tree: git status --short
2. Tag release:
   - git tag -a release/YYYY-MM-DD-HHMM -m "prod deploy note"
3. Push commits and tags:
   - git push origin main
   - git push origin --tags
4. Capture current production URL for rollback.

## Rollback
- Vercel rollback:
  - npx vercel redeploy <previous-production-url> --prod --yes
- Code rollback:
  - git checkout <tag-or-commit>

## End Of Day
1. Confirm clean tree.
2. Push main + tags.
3. Optional backup bundle:
   - git bundle create asf-tms-YYYY-MM-DD.bundle --all

## Rules
- No force-push on main.
- No long uncommitted sessions.
- No deploy from non-canonical paths.
