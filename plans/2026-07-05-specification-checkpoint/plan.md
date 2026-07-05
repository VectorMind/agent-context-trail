# Specification Checkpoint Reinforcement

## Problem Summary

The workflow already separates durable specifications from dated work packets,
but it does not explicitly require a specification assessment when a plan is
agreed or when validation closes.

## Goal

Reinforce the workflow so every agreed and validated plan checks relevant
specifications for conflicts and surfaces candidate durable topics for
maintainer review.

## Scope

- update the main workflow contract;
- update the assistant-facing operational summary;
- record proof for this workflow-only change.

## Non-Goals

- create a product specification;
- change runtime source code;
- add speculative specification content.

## Specification Checkpoint

No product specifications currently exist under `specification/`; only
`specification/.gitkeep` is present.

This plan does not violate an existing durable contract. The durable workflow
topic that should be added is the checkpoint itself: plans must assess relevant
specifications when they are agreed and again when validation closes, then
suggest candidate specification additions to the maintainer for review.

## Phases

### Phase 1 - Workflow Contract

- add the checkpoint requirement to `WORKFLOW.md`;
- make the requirement visible in `AGENTS.md`.

### Phase 2 - Proof

- verify the documentation is internally consistent;
- verify no runtime files were changed for this task.

## Exit Criteria

- agreed and validated plans now have an explicit specification checkpoint;
- candidate specification topics must be suggested to the maintainer before
  being added unless specification work was requested or a stable contract has
  clearly emerged;
- proof is recorded in this packet.
