# Test / Validation: Plans Layout Refactor

This is a workflow-only change, so validation is tree and document consistency review.

## Commands run

```txt
Get-ChildItem -Path plans -Force
Get-ChildItem -Path plans -Directory -Recurse
rg -n "plans/YYYY-MM-DD-<slug>|plans/YYYY-MM/DD-<slug>|plans/20[0-9]{2}-[0-9]{2}-[0-9]{2}-|plans/[0-9]{4}-[0-9]{2}/[0-9]{2}-|plans\\20[0-9]{2}-[0-9]{2}-[0-9]{2}-|plans\\[0-9]{4}-[0-9]{2}\\[0-9]{2}-" . -g '!node_modules' -g '!dist' -g '!.git'
rg -n "plans/YYYY-MM/DD/<change-id>|plans/README.md|plans/open.md|plans/closed.md" AGENTS.md WORKFLOW.md plans\README.md plans\open.md plans\closed.md
Index path existence check for every `plans/YYYY-MM/DD/<change-id>` reference in `plans/open.md` and `plans/closed.md`.
git status --short
```

## Expected

- Plan packets live under `plans/YYYY-MM/DD/<change-id>/`.
- Workflow docs describe `plans/YYYY-MM/DD/<change-id>/`.
- No active stale flat-layout or day-slug references remain.
- Every packet path in `plans/open.md` and `plans/closed.md` resolves on disk.

## Actual

- Passed: top-level `plans/` contains `2026-07/`, `archive/`, `README.md`, `open.md`, and `closed.md`.
- Passed: all dated packets live under `plans/2026-07/DD/<change-id>/`.
- Passed: `WORKFLOW.md`, `AGENTS.md`, and `plans/README.md` describe `plans/YYYY-MM/DD/<change-id>/`.
- Passed: every indexed packet/proof path in `plans/open.md` and `plans/closed.md` resolves on disk.
- Passed with intentional historical exceptions: stale-layout scans only report this migration packet describing the old layouts and recording the validation command.

## Known Gaps

- No runtime build was run because this change only moves workflow files and updates references.
