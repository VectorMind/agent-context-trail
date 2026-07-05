# Plan: Plans Layout Refactor

## Problem Summary

The repository used flat dated packet folders under `plans/YYYY-MM-DD-<slug>/`, then briefly used `plans/YYYY-MM/DD-<slug>/`. The desired workflow layout now groups all packets for a day under a shared day folder:

```text
plans/YYYY-MM/DD/change-id/
```

## Goal

Move existing packets to the month/day/change layout, update workflow guidance, and rewrite stale packet references.

## Scope

- Move existing dated plan packets into month and day folders.
- Update `WORKFLOW.md`, `AGENTS.md`, and `plans/README.md`.
- Update repo-local references to moved packet paths.

## Exit Criteria

- No top-level `plans/YYYY-MM-DD-*` packet directories remain.
- No `plans/YYYY-MM/DD-<slug>/` packet directories remain.
- References use `plans/YYYY-MM/DD/<change-id>/`.
