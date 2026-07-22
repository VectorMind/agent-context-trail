# Copilot OTel ID Correlation Compatibility

## Problem summary

Copilot OTel enrichment currently assumes exact equality between
`copilot_chat.server_request_id` and the session log's
`result.metadata.responseId`. An enterprise-account capture showed identifiers
that differed only in the UUID version nibble, so no per-call context attached
and every Copilot prompt was excluded from the Prompt cost map.

## Goal

Make request correlation tolerate the observed provider variation without
allowing speculative or ambiguous attachment.

## Scope

- Preserve both `copilot_chat.server_request_id` and `gen_ai.response.id` in
  normalized records.
- Prefer exact equality against every available OTel response identifier.
- Fall back to UUID comparison with only the version nibble masked.
- Accept a fallback only when it identifies one unambiguous OTel ID inside the
  already conversation-scoped calls.
- Continue reading schema-v1 records so existing local history can benefit from
  the fallback.
- Add focused normalization, correlation, and storage-compatibility tests.

## Non-goals

- No timestamp/order/model heuristic correlation.
- No fabricated request-level substitute for per-call context.
- No settings changes or changes to OTel capture privacy.
- No UI redesign in this packet.

## Specification checkpoint

- `specification/provider-and-cost.md` applies: the change restores real
  Copilot per-call telemetry while retaining the rule that missing data is
  never fabricated. No specification change is required.
- `specification/surfaces-and-privacy.md` applies: only allowlisted correlation
  identifiers are retained, storage remains local and bounded, and cost-map
  exclusions remain honest when correlation is unavailable. No specification
  change is required.
- Candidate durable clarification for maintainer review: Copilot OTel
  correlation should prefer exact standard/provider identifiers and permit
  only an unambiguous, explicitly bounded compatibility fallback. This packet
  will not add that rule to the specification without further review.

## Phases

1. Extend the normalized schema while retaining v1 read compatibility.
2. Implement exact multi-ID and guarded UUID-version-insensitive matching.
3. Add regression tests and run test, typecheck, and build verification.
4. Refresh the specification checkpoint and close the packet when validated.

## Exit criteria

- Exact matching remains preferred and unchanged for existing captures.
- Either preserved OTel identifier can match a session response ID.
- A UUID version-nibble-only mismatch correlates when unique.
- Ambiguous or broader mismatches remain unmatched.
- Existing schema-v1 stored calls remain readable.
- Tests, typecheck, and build pass.
