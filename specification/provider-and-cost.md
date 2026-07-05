# Agent Context Trail - Provider And Cost Specification

Durable provider and cost contract for Agent Context Trail.

## Provider Strategy

The extension is not constrained to a lowest-common-denominator provider model.
It should expose a shared core where fields are genuinely comparable, and it
should also take maximum practical advantage of provider-specific local
telemetry when a provider exposes richer signals.

Binding rules:

- The product may define provider-specific behavior and provider-specific
  enriched fields when they improve the real reading of that provider.
- A shared field should stay shared only when the underlying meaning is
  actually comparable across providers.
- Provider-specific depth must not be flattened away just to preserve a false
  appearance of symmetry across Copilot, Codex, and Claude.

## Provider Support

Three providers are in scope: Claude Code, Codex, and GitHub Copilot. They are
not required to reach equal feature depth, and the extension must not force
them to look equivalent when they are not.

- **Claude Code** is the reference implementation. It is expected to reach full
  feature depth: tokens, cache read/write, cost, tool calls, and titles.
- **Codex** is implemented best-effort against whatever its local session data
  exposes.
- **GitHub Copilot** is lowest priority. It is implemented only as far as its
  local session data yields cheaply: titles and conversation structure. Richer
  telemetry is out of scope until separately investigated.

Binding rule: never fabricate missing data. If a provider's local data does
not expose a field, such as Copilot cache tokens, the extension must present
that field as unavailable. It must not show zero, and it must not omit the
field in a way that could be misread as zero.

A provider tab with no supported conversations must say so explicitly, for
example "support is not implemented yet." It must never render as a silently
empty list indistinguishable from "no conversations found."

## Cost

- Cost is always expressed in **USD**. There is no alternate display unit.
- Provider/account status signals such as Codex or Claude rate-limit
  consumption are not cost. They must be shown, when available, as separate
  status fields in addition to USD cost, never as a substitute for it and
  never converted into or merged with USD cost.
- Every cost figure carries a confidence label:
  - `provider-reported`: the provider's own log or response stated the cost.
  - `estimated`: computed from token counts against a maintained rate table,
    because the provider does not report cost directly.
  - `unavailable`: neither a reported cost nor a usable rate exists.
- `provider-reported` cost always wins over `estimated` when both are available
  for the same request.
- Rate tables used for estimation must cite their official source and the date
  they were last checked.
- Rates are maintained by hand, not auto-synced from any live pricing API.

### Subscription-billed providers still get a BYOT cost estimate

The purpose of this tool is to make real usage legible. Many providers (Codex,
Copilot) bill through a subscription with opaque time- or request-based rate
limits instead of metered per-token pricing, and that opacity is exactly what
users need surfaced, not shrugged off as "unavailable."

- A provider billing through a subscription or rate-limit plan is **not** a
  reason to mark its cost `unavailable`. As long as local session data exposes
  usable token counts (input, cached input, output, reasoning), compute an
  `estimated` cost as if the same usage had been paid for as an API call at
  that vendor's standard, publicly listed per-token rate ("bring your own
  token" / BYOT equivalence). This is the same rate-table mechanism already
  used for Claude; it is not provider-specific behavior.
- `unavailable` is reserved for when no usable rate table entry (including a
  fallback rate) exists for that vendor at all, not for "this provider's
  billing model isn't per-token."
- Rate-limit consumption (e.g. Codex's `used_percent` windows) stays a
  separate status field precisely so both signals are visible together: the
  literal dollar-equivalent cost of the tokens moved, and the plan-level
  quota those tokens burned against.
