[######] Done - implemented and validated; live confirmation on the affected
enterprise machine remains a deployment check, not an implementation blocker.

## Files changed

- `src/providers/copilot/otel/types.ts` - schema v2 retains the legacy primary
  ID and separately stores provider-specific and standard response IDs; schema
  v1 remains supported for reads.
- `src/providers/copilot/otel/normalize.ts` - preserves
  `copilot_chat.server_request_id` and `gen_ai.response.id` independently.
- `src/providers/copilot/otel/enrich.ts` - groups calls at the turn level,
  prefers exact matches across all available IDs, then permits only a unique
  canonical-UUID match after masking the version nibble.
- `src/providers/copilot/otel/storage.ts` - reads compatible v1 and v2 records.
- Corresponding normalizer, enrichment, and storage tests cover the regression
  and safety boundaries.
- `CHANGELOG.md` - records the unreleased compatibility fix.

## Decisions

- Existing `requestId` is retained instead of migrating stored history.
- Exact matching always takes precedence over compatibility matching.
- Compatibility matching changes only UUID character 14, validates canonical
  UUID shape and variant, and refuses zero or multiple candidate turn groups.
- Timestamp/order/model heuristics remain out of scope because an incorrect
  attachment is worse than unavailable context.

## Specification checkpoint

The closing review found the implementation consistent with
`specification/provider-and-cost.md` and
`specification/surfaces-and-privacy.md`: it attaches real provider data only,
retains honest unavailable behavior, and persists only allowlisted local
correlation metadata. No specification edit is required. The possible durable
correlation-policy clarification from `plan.md` remains a maintainer-review
candidate, not a correctness gap.

## Remaining deployment check

Confirm on the originally affected enterprise machine that its real ID pairs
either exact-match the separately retained `gen_ai.response.id` or differ only
in the UUID version nibble. Synthetic regression coverage models both cases.
