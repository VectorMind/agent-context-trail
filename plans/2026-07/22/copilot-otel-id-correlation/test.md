# Test Proof

## Automated verification

Run from the repository root on 2026-07-22:

- `npm.cmd test` - passed: 79 tests, 0 failed.
- `npm.cmd run typecheck` - passed: `tsc --noEmit`.
- `npm.cmd run build` - passed: esbuild completed successfully.
- `git diff --check` - passed before packet closure; no whitespace errors.

The first attempt through `npm` was blocked by the machine's PowerShell policy
for `npm.ps1`; rerunning through the equivalent `npm.cmd` entry point passed.

## Regression coverage

- Both OTel correlation IDs are preserved even when they differ.
- The standard response ID can correlate exactly while the server ID differs.
- UUIDs differing only at the version nibble correlate.
- Exact correlation wins over a possible compatibility match.
- Multiple compatibility candidates are rejected as ambiguous.
- Non-UUID and broader UUID differences are not normalized into a match.
- Existing schema-v1 local records remain readable; unsupported schemas remain
  rejected.

## Known gap

The affected enterprise machine was not available in this workspace, so the
final live-data confirmation remains to be performed there. The reported shape
is represented directly by the regression fixtures.
