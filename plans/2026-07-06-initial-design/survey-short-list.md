# Survey Short List — Top 3 vs Restricted Scope

Companion to [survey.md](survey.md). The full survey compared 12 products
against the broad concept. This short list compares only the **top 3** against
the **restricted scope** decided on 2026-07-04:

- no month, day, or folder aggregations;
- only two levels: **single request** and **conversation overview**;
- status bar shows the last call, toggleable with the conversation total,
  toggleable between token count and cost;
- no permanent activity-bar icon — the detail surface opens only on demand;
- conversation list shows titles only (as VS Code shows them), in three
  provider tabs: Copilot, Codex, Claude;
- one conversation thread view with a chart; clicking a chart point opens the
  request detail (tokens in/out, cached tokens, cost, model, tool calls,
  context composition where the local files allow).

## Why these three

1. **Copilot Cost Tracker** — the only surveyed product with real per-turn
   economics (cache %, context resend, cost per turn). It is the analytical
   benchmark to beat.
2. **Agent Dashboard** — the only surveyed product claiming all three target
   providers plus live status and per-session tokens/cost. It is the provider-
   coverage benchmark.
3. **Claude Code Token Monitor** — the closest existing shape to our restricted
   UX: session selector, per-turn tokens/cost/cache, "Show Last Message Cost".
   It is what our Phase 1 would look like if we stopped early — and only did
   Claude.

Runners-up excluded from the short list: **AI Insights** (right providers,
but aggregate/time-window views only — exactly what we exclude), **Claude Code
and Codex Assist** and **Codex History Viewer** (history browsers without
per-request economics).

## Comparison table

`●` claimed in listing · `◐` partial · `—` absent · **Us** = restricted scope

| Capability | Us (target) | Copilot Cost Tracker | Agent Dashboard | Claude Code Token Monitor |
|---|---:|---:|---:|---:|
| Status bar shows last call | ● | ◐ (session/period cost) | ◐ (agent states) | ● ("Show Last Message Cost") |
| Last call ↔ conversation total toggle | ● | — | — | ◐ (cumulative shown alongside) |
| Token ↔ $ unit toggle | ● | — | — | — |
| No permanent sidebar icon / opens on demand | ● | — (dashboard-first) | — (dashboard-first) | ◐ |
| Copilot + Codex + Claude tabs | ● | — (Copilot only) | ● | — (Claude only) |
| Conversation list, titles only | ● | ◐ (recent sessions) | ● | ● (session selector) |
| Per-conversation chart of requests | ● | ◐ (aggregate charts, not thread-scoped) | — | — |
| Click chart point → request detail | ● | ◐ (turn explorer, table-style) | — | ◐ (expandable rows) |
| Per-request in/out/cached/cost/model | ● | ● | ◐ | ● |
| Tool-call detail per request | ● | ◐ (counts) | ◐ (calls listed) | — |
| No day/month/folder aggregation views | ● | — (dates, budgets, grades) | — (fleet views) | ◐ |

**Reading:** no competitor covers the restricted scope. Each owns one column
block: Copilot Cost Tracker owns per-turn economics (single provider,
dashboard-first), Agent Dashboard owns provider breadth (thin per-request
data), Claude Code Token Monitor owns the minimal per-turn UX (single
provider, no chart, no comparison). The empty intersection — three providers ×
per-request economics × conversation-scoped chart × zero aggregation clutter —
is our product.

## Details

### 1. Copilot Cost Tracker

- Marketplace: https://marketplace.visualstudio.com/items?itemName=Hoxlegion.copilot-cost-tracker (~300 installs)
- **What it does that we also do:** turn-level explorer; LLM and tool calls per
  turn; cache percentage per turn; cost per turn; context growth ("Context
  Tax").
- **What it does that we deliberately don't:** Dashboard / Activity / Models /
  Efficiency / Budget tabs; date filters; efficiency grades; behavioral alert
  taxonomy. That is the aggregation-first clutter our scope excludes.
- **What we do that it doesn't:** Codex and Claude Code as equal providers;
  conversation-scoped chart as the navigation surface; status bar centered on
  the last call rather than billing-period cost; no permanent dashboard.
- **Threat level: highest.** If it added Claude/Codex adapters it would
  overlap heavily. Our defense is the narrower, calmer UX and true
  three-provider parity.
- **Borrow:** its `github.copilot.chat.otel.dbSpanExporter.enabled` telemetry
  lead is the most promising path to Copilot per-turn data (survey §9.1).

### 2. Agent Dashboard

- Marketplace: https://marketplace.visualstudio.com/items?itemName=AmiSchreiber.agent-dashboard (~143 installs)
- **What it does that we also do:** Copilot + Codex + Claude Code; per-session
  model, token usage, estimated cost; conversation history with prompts,
  responses, tool calls.
- **What it does that we deliberately don't:** multi-agent control room —
  remote control, mobile access, cross-machine monitoring, process control.
- **What we do that it doesn't:** per-request cached/uncached breakdown; a
  request-level chart inside one conversation; unit toggling in the status
  bar; request detail as the terminal drill-down.
- **Threat level: medium.** Proves cross-provider observation is viable, but
  its center of gravity (orchestration) points away from ours (forensics of
  one conversation).
- **Borrow:** evidence that the three local data sources can be normalized
  into one session list.

### 3. Claude Code Token Monitor

- Marketplace: https://marketplace.visualstudio.com/items?itemName=Miku3w3.claude-code-token-monitor (~17 installs)
- **What it does that we also do:** current session title; per-turn tokens,
  cost, cache hit/miss and rate; cumulative session total; session selector;
  last-message cost surfaced directly.
- **What it does that we deliberately don't:** nothing significant — it is
  already minimal. Its limitation is coverage, not clutter.
- **What we do that it doesn't:** Copilot and Codex; the chart as the thread
  view; click-through from chart point to request detail; tool-call
  breakdown; token ↔ $ toggle.
- **Threat level: low alone, high as a template.** It validates that the
  Claude Code JSONL files carry everything Phase 1 needs. We must ship a
  visibly richer thread view than its numeric rows, or we are a duplicate
  with extra tabs.
- **Borrow:** its per-turn field set is a good minimum checklist for our
  request-detail card.
