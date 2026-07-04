# Workflow

This repository uses spec-driven development with a dated packet workflow.
Stable requirements live in `specification/`. Time-bounded work lives in
`plans/`.

These folders are for coordination, intent, and proof. They are not runtime
storage, cache locations, or placeholders for future product code.

## Specification Reserve

Use `specification/` only for durable contracts that should constrain more than
one implementation pass.

Create a specification only when the maintainer asks for one or when the work
has clearly settled a rule that future changes must follow.

When a durable specification is needed, place it at:

```text
specification/<slug>/spec.md
```

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

Each packet should follow this shape:

```text
plans/YYYY-MM-DD-<slug>/
  survey.md            # only when explicitly requested
  plan.md
  implementation.md    # create only after implementation work exists
  test.md
```

Keep packet dates as the day the packet starts. Use a short lowercase slug.

Use `plans/open.md` and `plans/closed.md` as concise packet indexes when it is
useful to distinguish active from completed work.

## Plan Shape

`plan.md` should stay focused on the actual work package. Include the sections
that help the task:

- problem summary;
- goal and objectives;
- scope and non-goals;
- open points and status;
- phases or milestones;
- dependencies and risks;
- exit criteria.

Use stable IDs such as `OP-001` for unresolved questions when the packet needs
tracked decisions.

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

## Git Ownership

The maintainer owns git history. Assistants should not run commit, push,
branch-changing, or other history-changing git operations unless explicitly
asked.
