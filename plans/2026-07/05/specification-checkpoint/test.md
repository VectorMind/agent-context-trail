# Test Proof

## Validation Performed

- reviewed `WORKFLOW.md` and `AGENTS.md` for consistency;
- inspected `specification/` and confirmed there are no product specs to
  conflict with this workflow change;
- checked the worktree status to confirm only workflow documentation and this
  packet were changed by this task, aside from unrelated worktree changes.

## Expected Result

The repository workflow should require every agreed and validated plan to assess
relevant durable specifications for possible violations and candidate additions.

## Actual Result

The workflow now contains an explicit specification checkpoint for agreed plans
and validated packets. It also requires candidate durable topics to be suggested
to the maintainer for review before they are added, unless the maintainer asked
for specification work or a stable contract has clearly emerged.

## Gaps

- no runtime validation was needed because this change is documentation-only;
- existing open packets were not rewritten as part of this narrow workflow
  reinforcement.
