# Agent Context Trail - Provider And Cost Specification

Durable provider and cost contract for Agent Context Trail.

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
