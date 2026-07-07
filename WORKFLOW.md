# Workflow

This repository uses spec-driven development with a dated packet workflow.
Stable requirements live as direct files in `specification/`. Time-bounded
work lives in `plans/`.

These folders are for coordination, intent, and proof. They are not runtime
storage, cache locations, or placeholders for future product code.

## Specification Reserve

Use `specification/` only for durable contracts that should constrain more than
one implementation pass. This repository owns one product, Agent Context Trail,
so the whole `specification/` folder is for that product.

Create a specification only when the maintainer asks for one or when the work
has clearly settled a rule that future changes must follow.

When durable specification content is needed, place it directly under
`specification/` and split files by concern:

```text
specification/<concern>.md
```

Do not create product slug subfolders under `specification/`.

Specifications should describe stable facts such as:

- user-visible behavior;
- data or schema rules;
- storage, routing, or interface contracts;
- compatibility boundaries;
- explicit non-goals.

Specifications should not become plan history. Avoid timeline language and put
change history in the related packet instead.

## Plans

Use `plans/` for dated work packets tied to a concrete task.

Small edits do not always need a plan. Use a dated packet when the user asks
for plan-driven work, initiates work as a tracked packet, or explicitly
confirms a proposed plan before implementation starts.

Do not create a plan packet for a small direct edit unless the user asks for
one. Do not treat internal assistant planning as a reason to create a packet.

Each packet should follow this shape:

```text
plans/YYYY-MM/
  DD/
    change-id/
      survey.md            # only when explicitly requested
      plan.md
      implementation.md    # create only after implementation work exists
      test.md
```

Keep packet dates as the day the packet starts. Use the ISO month as the bucket, the two-digit day as the next folder, and a short lowercase change ID under that day.

Use `plans/README.md` for the layout note and keep `plans/open.md` and `plans/closed.md` as concise packet indexes when it is useful to distinguish active from completed work.

## Open/Closed Index

Track packets in `plans/open.md` and `plans/closed.md` as tables, not prose.
Each row's `Description` cell stays a single short field: a compact
status/metrics summary, plus a last-left-status or closure reason only when
one is relevant. Do not restate the full plan or implementation narrative
there — that detail belongs in the packet's own `plan.md`/`implementation.md`.

`plans/open.md` columns: `Packet`, `Status`, `Description`.
`plans/closed.md` columns: `Packet`, `Closed`, `Description`.

When a packet's `implementation.md` progress marker reaches
`[######] Done`, remove its row from `plans/open.md` and add a row to
`plans/closed.md` with the date the packet was actually completed. Do not
leave a completed packet listed as open pending a separate closure step.

Periodically check `plans/open.md` rows against their packet's
`implementation.md` marker; a row whose marker already reads `Done` (or whose
body records a resolved verdict the marker itself never caught up to) should
move to `plans/closed.md` rather than stay listed as open.

## Plan Shape

`plan.md` should stay focused on the actual work package. Include the sections
that help the task:

- problem summary;
- goal and objectives;
- scope and non-goals;
- specification checkpoint;
- open points and status;
- phases or milestones;
- dependencies and risks;
- exit criteria.

Use stable IDs such as `OP-001` for unresolved questions when the packet needs
tracked decisions.

## Specification Checkpoint

Every user-initiated or user-confirmed plan needs a specification assessment
before implementation starts, and every validated plan needs the assessment
refreshed before the packet is marked done.

At each checkpoint:

- review the relevant `specification/*.md` files, if any exist;
- identify planned behavior that may need a durable contract change,
  clarification, or explicit exception;
- identify stable behavior, data, interface, or non-goal topics that may belong
  in `specification/`;
- record the assessment in the packet as open specification-review points,
  usually in `plan.md` before work starts and in `implementation.md` or
  `test.md` when validation closes;
- suggest candidate specification topics to the maintainer for review before
  adding them unless the maintainer already asked for specification updates or a
  stable contract has clearly emerged.

If no specification exists or none applies, record that result explicitly. Do
not treat the checkpoint as permission to create speculative specifications.
Do not overstate plan/spec tension as a failure. Treat it as an explicit open
point for maintainer review unless the plan would knowingly ship behavior
against an already-settled durable contract.

## Implementation Log

Create `implementation.md` only after implementation begins. It should record
what actually changed, not what might happen later.

Open the file with a short progress marker, for example:

```text
[#-----] Phase 1/6 - discovery complete; implementation next.
```

Mark the packet done when the work is implemented and validated:

```text
[######] Done - implemented and validated; follow-ups noted below.
```

Use the rest of the file for:

- files changed;
- implementation facts;
- decisions taken during execution;
- deviations from the original plan;
- follow-up risks;
- commands or migrations that matter to the work.

## Test Proof

Use `test.md` as the proof surface:

- commands run;
- documents or fixtures reviewed;
- expected results;
- actual results;
- known gaps;
- environment notes that affect reproducibility.

For workflow-only changes, document review and tree checks are valid proof.

## Repository Boundaries

This workflow layer is intentionally separate from runtime source layout.

Until the product structure is intentionally designed, do not treat workflow
bootstrapping as a reason to create business-facing folders such as `src/`,
`packages/`, or other implementation trees.

## Generated Data

Do not use `plans/` or `specification/` for scratch outputs, logs, exports,
generated caches, or captured runtime data.

Use `.tmp/` for disposable task artifacts instead.

## Validation

Run the smallest meaningful verification for the change.

- For workflow-only changes, verify document consistency and repository shape.
- For future code changes, record the commands run and the commands not run in
  `test.md`.
- Before marking a packet validated, refresh the specification checkpoint and
  note any candidate specification topics that should be reviewed by the
  maintainer.

## Git Ownership

The maintainer owns git history. Assistants should not run commit, push,
branch-changing, or other history-changing git operations unless explicitly
asked.
