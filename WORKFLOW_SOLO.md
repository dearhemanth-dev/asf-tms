# ASF TMS Solo Workflow (Canonical)

## Canonical Workspace
- Active development path: C:/Dev/asf-tms
- Do not develop from OneDrive paths.
- OneDrive copies are archive-only.

## Daily Start
1. Open C:/Dev/asf-tms in VS Code.
2. Mandatory: run startup gate script:
   - powershell -ExecutionPolicy Bypass -File .\\scripts\\start-dev.ps1
3. Script enforces: canonical path, main branch, hook presence, clean tree, pull latest, quick build, and manual smoke acknowledgment.
4. Only start feature coding after the script reports: Session is READY.

## Mandatory Startup Gate
The startup gate is required at the beginning of each new chat/session, including after reboot or VS Code restart.

Pass criteria:
1. Source of truth path is C:/Dev/asf-tms.
2. Branch is main unless a branch is intentionally chosen.
3. Managed pre-commit hook exists.
4. Working tree is clean before new coding.
5. Quick verification build passes.
6. Manual smoke on login, /fleet, /reports, /maintenance/fault-codes, /fuel-expenses/report passes.
7. User acknowledges READY.

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
