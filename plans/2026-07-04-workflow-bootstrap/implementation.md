# Implementation

[######] Done - implemented and validated; follow-ups noted below.

## Files Added

- `AGENTS.md`
- `WORKFLOW.md`
- `.gitignore`
- `.tmp/.gitkeep`
- `specification/.gitkeep`
- `plans/open.md`
- `plans/closed.md`
- `plans/archive/.gitkeep`
- `plans/2026-07-04-workflow-bootstrap/plan.md`
- `plans/2026-07-04-workflow-bootstrap/test.md`

## Implementation Facts

- introduced a repo-level SSD workflow contract without copying source-repo
  business logic;
- reserved singular `specification/` for durable contracts only;
- established dated packet handling under `plans/`;
- recorded the bootstrap as a closed packet to demonstrate the packet model;
- kept the bootstrap intentionally separate from any future runtime structure.

## Decisions

- use the singular folder name `specification/` as the durable contract area;
- leave product-facing layout undefined until a later design pass;
- keep `.tmp/` as the only sanctioned disposable workspace inside the repo.

## Follow-Up Risks

- future work should avoid treating this scaffold as a decision about app
  architecture;
- when runtime folders are introduced, their boundaries should be documented
  explicitly rather than inferred from this bootstrap.
