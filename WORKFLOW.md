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
- specification checkpoint;
- open points and status;
- phases or milestones;
- dependencies and risks;
- exit criteria.

Use stable IDs such as `OP-001` for unresolved questions when the packet needs
tracked decisions.

## Specification Checkpoint

Every agreed plan needs a specification assessment before implementation starts,
and every validated plan needs the assessment refreshed before the packet is
marked done.

At each checkpoint:

- review the relevant `specification/*.md` files, if any exist;
- identify planned changes that may violate an existing durable contract;
- identify stable behavior, data, interface, or non-goal topics that may belong
  in `specification/`;
- record the assessment in the packet, usually in `plan.md` before work starts
  and in `implementation.md` or `test.md` when validation closes;
- suggest candidate specification topics to the maintainer for review before
  adding them unless the maintainer already asked for specification updates or a
  stable contract has clearly emerged.

If no specification exists or none applies, record that result explicitly. Do
not treat the checkpoint as permission to create speculative specifications.

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
