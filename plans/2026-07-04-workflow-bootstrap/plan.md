# Repository Workflow Bootstrap

## Problem Summary

This repository did not yet have the workflow layer needed for spec-driven
development. The reusable process model already exists in another repository,
but it must be adapted here without carrying over product-specific source
structure or business logic.

## Goal

Establish the repository-level workflow contract and folder scaffolding needed
to manage durable specifications and dated work packets in this repository.

## Scope

- add repo-level workflow guidance;
- reserve `specification/` for durable contracts;
- create `plans/` packet indexes and archive area;
- establish `.tmp/` as the sanctioned scratch location;
- keep the bootstrap free of runtime folder assumptions.

## Non-Goals

- defining the future application architecture;
- creating `src/`, `packages/`, or other product-facing folders;
- writing an initial product specification;
- importing business-specific docs or implementation details from the source
  repository.

## Phases

### Phase 1 - Source Workflow Extraction

- inspect the reusable SSD and packet model in the source repository;
- separate durable process rules from source-repo-specific content.

### Phase 2 - Target Repo Scaffolding

- add sanitized `AGENTS.md` and `WORKFLOW.md`;
- create `specification/`, `plans/`, and `.tmp/` support files;
- create a first packet that records the bootstrap.

### Phase 3 - Consistency Check

- verify the created tree matches the intended workflow;
- confirm no runtime or business-specific folders were introduced.

## Risks

- copying source-repo assumptions too literally;
- accidentally introducing product layout decisions before they are designed;
- leaving the packet structure undocumented or inconsistent.

## Exit Criteria

- the repository has `AGENTS.md` and `WORKFLOW.md`;
- `specification/` is reserved but empty of product specs;
- `plans/` supports open and closed packet tracking;
- `.tmp/` is the sanctioned scratch area and is gitignored;
- no runtime or rendering-specific folders are created by this bootstrap.
