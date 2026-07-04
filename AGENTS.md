# Agent Guidance

## Primary Workflow Contract

Use `WORKFLOW.md` as the main repository workflow contract. Keep this file as
the short operational summary for assistants working here.

## Spec-Driven Development

This repository separates durable requirements from time-bounded work packets.

- Reserve `specification/` for long-lived contracts that should survive more
  than one implementation pass.
- Do not start specification capture unless the maintainer explicitly asks for
  it or a stable contract has clearly emerged.
- Write durable requirements to `specification/<slug>/spec.md`.
- Track active work in dated packets under `plans/YYYY-MM-DD-<slug>/`.
- Start each packet with `plan.md` and keep `test.md` as the proof surface.
- Create `implementation.md` only after implementation work has actually
  happened.
- Add `survey.md` only when the maintainer explicitly requests a survey.
- When work changes direction, update the packet so `plan.md`,
  `implementation.md`, and `test.md` still describe the same reality.

## Temporary Files

- Do not leave scratch files, ad-hoc scripts, logs, or captures in the
  workspace root.
- Put disposable artifacts under `.tmp/`, using subfolders when a task needs
  multiple outputs.
- Treat `.tmp/` as disposable. Nothing the repository depends on should live
  there permanently.

## Repository Discipline

- Keep this workflow layer free of business-specific assumptions until the
  runtime structure is intentionally designed.
- Do not pre-create product folders such as `src/` or `packages/` as part of
  workflow bootstrapping alone.
- Keep generated data, caches, and exported artifacts out of `plans/` and
  `specification/`.
- Run the smallest meaningful verification for the change and record the proof.
- Leave git history operations to the maintainer unless explicitly asked.
