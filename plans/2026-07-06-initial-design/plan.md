# Plan — Initial Design: Restricted Scope, Rendering Stack, Chart Stack

Packet: `plans/2026-07-06-initial-design`
Inputs: [agent-chat-observer-handoff.md](agent-chat-observer-handoff.md),
[survey.md](survey.md), [survey-short-list.md](survey-short-list.md), a review
of `C:\dev\MicroWebStacks\astro-huge-doc` (existing VS Code extension built on
an Astro SSR engine), and a local data-source investigation on the
maintainer's machine (2026-07-04, section 5).

Status: **design accepted, ready for Phase 1 implementation.**

## 1. Problem summary

The handoff describes a broad product. This packet restricts it to a shippable
core and settles the stack decisions that block everything else:

1. Do we need Astro SSR (as used by the astro-huge-doc extension)? → No.
2. What renders the conversation chart? → plain SVG.
3. Which data comes from disk and which would need hooks? → section 5.

## 2. Restricted scope

Two levels of data only. Nothing above the conversation is ever aggregated.

- **Request** (one user prompt iteration): tokens in, tokens out, cached
  tokens (read/write where the provider distinguishes), total cost, model,
  duration, tool calls (count; per-tool tokens in/out where the local files
  allow), and context composition where derivable.
- **Conversation**: title (as VS Code / the CLI shows it), provider, ordered
  list of requests, running totals of the same fields.

Cost is shown in **USD only** (the AI-Credit unit explored early in this
packet was dropped post-Phase-2 — see the decision log, §8). Token counts
appear only in the panel, never in the status bar — the formula from tokens
to cost is too involved to compress into a status item.

### Non-goals (explicit exclusions)

- No day / week / month aggregation views.
- No folder, project, or workspace aggregation.
- No budgets, grades, efficiency scores, streaks, or dashboards.
- No permanent activity-bar icon.
- No replacement chat UI; observe and explain only.
- No cloud sync, telemetry, or upload of any kind (handoff §14 stands).

## 3. UX definition

### Status bar (always present, the only permanent surface)

- Shows **both numbers side by side**: last call and conversation total in
  USD, e.g. `$0.18 | $2.40`. No unit toggle — see decision log §8.
- No token display in the status bar.
- The **click** on the item opens the panel; the tooltip is informational
  only (title, both cost figures, a link to open the panel).

### Main surface: WebviewPanel (editor tab), opened on demand

Opened by the status-bar click or a command. No permanent icon anywhere.

```text
┌─────────────────┬──────────────────────────────────────────┐
│ Conversations   │ Thread view: <conversation title>        │
│ [Copilot][Codex]│                                          │
│ [Claude]        │  chart: one point/bar per request        │
│                 │  (in / cached / out stacked, cost line)  │
│ ▸ Fix auth bug  │                                          │
│ ▸ Refactor db   │  ── click a point ──────────────────────│
│ ▸ Add tests     │  Request #7 detail:                      │
│   ...           │  model, in/out/cached tokens, cost,      │
│ (collapsible ◀) │  duration, tool calls, context makeup    │
└─────────────────┴──────────────────────────────────────────┘
```

- Left: conversation list, **titles only**, three provider tabs (Copilot,
  Codex, Claude). Collapsible to give the thread view full width.
- Right: single-conversation thread view — the chart — plus a request-detail
  card when a chart point is selected.
- Providers with missing fields show `unavailable`, never `0`
  (survey §4.8 lesson).

## 4. Design decisions

### DD-001 — Astro SSR: **No.** (accepted)

The astro-huge-doc extension spawns a Node child process running an Astro SSR
server, manages ports, stages/installs an engine package from npm on first
use, and points a webview (or external browser) at `localhost`. That is the
right machinery for its problem: rendering arbitrarily large multi-repo
markdown sites with ISR caching, shiki highlighting, and a Kroki diagram
pipeline.

This product has none of those needs:

| Concern | astro-huge-doc | this extension |
|---|---|---|
| Content volume | unbounded markdown sites | a list, a chart, a card |
| Data source | collected DB / JSON dataset | local JSONL files read by the extension host |
| Rendering | SSR + hydration + caching | one small client-side view |
| Runtime | child Node server + port mgmt | none needed |

What SSR would cost us: child-process lifecycle and port conflicts, slower
first paint, a heavier VSIX or npm install on first use, and — worst — a
localhost HTTP server serving conversation transcripts, which weakens the
local-first privacy posture.

**Decision:** plain VS Code webview. The extension host (Node side) reads and
parses the provider files and owns the data model; the webview receives a
ready view model via `postMessage` and renders it. One HTML file, one
esbuild-bundled JS/CSS pair, vanilla TypeScript (Preact only if templating
gets noisy). VS Code theme variables (`--vscode-*`) for all styling.

### DD-002 — Chart stack: **plain SVG.** (accepted)

For our workload (one conversation ≈ 10–300 requests, stacked bars/points,
click-to-select, VS Code theming):

| | Plotly | ECharts | plain SVG |
|---|---|---|---|
| Bundle added to webview | ~3.5 MB | ~1 MB (~400 KB tree-shaken) | ~0 (a few KB of our code) |
| Click-a-point → app event | via its event layer | via its event layer | native — each `<rect>` is a DOM node |
| Match VS Code theme | fight its theming | fight its theming | `fill: var(--vscode-charts-blue)` |
| Custom marks (stacked in/cached/out + cost overlay + selection) | config wrestling | config wrestling | just draw it |
| Zoom/pan/WebGL/large-data | yes (unneeded) | yes (unneeded) | no (unneeded) |

**Decision:** one small internal SVG chart module (`chart.ts`) rendering from
the view model: stacked bar per request (cached input / new input / output),
optional cost line, hover tooltip, click-to-select emitting the request id.
Revisit (tree-shaken ECharts) only if chart types multiply beyond what ~500
lines of SVG code covers. uPlot considered and rejected: canvas rendering
makes per-point hit targets and CSS-variable theming harder for no benefit at
this size.

### DD-003 — Main surface: **WebviewPanel (editor tab).** (accepted)

No permanent sidebar icon; wide layout fits list + chart + detail. The webview
bundle stays host-agnostic so it could mount in a WebviewView later if a
compact companion view is ever wanted.

### DD-004 — Provider strategy: **Claude = pilot, full features. Codex =
best effort. Copilot = only what comes easily, not a priority.** (accepted)

Cache visibility is required, but we do not get stuck on any vendor: each
provider exposes what it exposes, the UI labels the rest `unavailable`.
Claude Code is the reference implementation that must reach the full feature
set. Codex follows with whatever its rollout files provide (verified rich —
see section 5). Copilot ships only if its session files yield data without
heroics; the OTel/telemetry spike is deferred.

### DD-005 — Cost model: **pricing YAML + response-reported cost when
available.** (accepted)

- A versioned `config/tokens-cost.yaml` config file in the repo holds per-model rates
  (input / cached-read / cache-write / output per MTok), each entry carrying
  a `source:` URL pointing at the official vendor pricing page
  (docs.claude.com pricing, openai.com/api/pricing, GitHub Copilot docs) and
  a `retrieved:` date.
- When the provider response/log reports cost directly, that value wins and
  is labeled `provider reported`; computed values are labeled `estimated`.
- The file is expected to improve gradually; wrong-but-labeled beats
  invisible.

## 5. Data source findings (verified on this machine, 2026-07-04)

Investigation result for OP-005. Key conclusion first:

> **For the restricted scope (tokens, cache, cost, titles, tool calls),
> everything needed comes from disk. Hooks are not required for the MVP.**
> Hooks would only add live *attention states* (working / needs input /
> needs approval). Those events are transient — they are not written to the
> history files — so if we ever want them in history, the extension must
> capture them at event time and persist them in its own local storage
> (`globalStorage`). That is a later, optional layer.

### 5.1 Claude Code — disk, complete ✅

`~/.claude/projects/<workspace-slug>/<sessionId>.jsonl`, one file per
conversation, appended live (file watching gives near-real-time updates).

Verified record types and what we take from them:

| Record type | Use |
|---|---|
| `assistant` | `message.usage`: `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `output_tokens`, cache TTL split (`ephemeral_5m/1h`), per-iteration array; `message.model`; tool_use blocks in content → tool-call detail |
| `user` | prompt text, request boundaries; tool_result blocks |
| `ai-title` | **conversation title** as VS Code shows it (`aiTitle` field) |
| `attachment`, `file-history-snapshot`, `queue-operation` | context composition hints (later phases) |

No cost field observed in current format → cost is estimated via
`config/tokens-cost.yaml` (DD-005). Workspace slug encodes the project path → workspace
filtering is trivial.

### 5.2 Codex — disk, near-complete ✅

Two sources:

- `~/.codex/session_index.jsonl` — one line per conversation:
  `id`, `thread_name` (**title**), `updated_at`. This is the conversation
  list.
- `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl` — the
  transcript. Verified record types: `session_meta`, `turn_context`,
  `response_item`, `event_msg`. The `event_msg`/`token_count` payload gives
  per-turn and cumulative usage: `input_tokens`, `cached_input_tokens`,
  `output_tokens`, `reasoning_output_tokens`, `total_tokens`, plus
  `model_context_window` and rate-limit/plan info.

No cache-write split (only `cached_input_tokens`) and no cost → estimate via
`config/tokens-cost.yaml`, label the missing split `unavailable`.

### 5.3 Copilot — disk gives structure, usage uncertain ⚠️

`%APPDATA%\Code\User\workspaceStorage\<hash>\chatSessions\<sessionId>.jsonl`
(the `<hash>` maps to a workspace via the adjacent `workspace.json`). Verified
format: version-3 session objects with `sessionId`, `creationDate`,
`requests[]`, selected model, mode (agent/ask). Titles and request structure
are readable; token/cache/cost fields were not present in the sampled data.

Per DD-004: ship structure + titles if cheap; leave usage `unavailable` until
the OTel `dbSpanExporter` / `agent-traces.db` spike (deferred, low priority).

### 5.4 Disk vs hooks summary

| Data | Claude | Codex | Copilot | Source kind |
|---|---|---|---|---|
| Conversation titles | disk (`ai-title`) | disk (`session_index.jsonl`) | disk (`chatSessions`) | JSONL |
| Request boundaries / prompts | disk | disk | disk | JSONL |
| Tokens in/out | disk | disk | ⚠️ spike | JSONL |
| Cache read/write | disk (both) | disk (read only) | ⚠️ spike | JSONL |
| Model | disk | disk | disk | JSONL |
| Tool calls | disk | disk | partial | JSONL |
| Cost | estimated (config/tokens-cost.yaml) | estimated | ⚠️ | derived |
| Live attention state | hooks only | hooks only | none | **transient → own local storage if ever kept** |

## 6. Phases

Little by little, each phase shippable:

- **Phase 1 — Scaffold + Claude data + status bar.** Extension scaffold
  (esbuild, `vsce` packaging); Claude JSONL parser → request/conversation
  model; `config/tokens-cost.yaml` v1 with official source URLs; status bar
  item `last | total` in USD. *Proof: values match a real session; packaged
  VSIX installs locally (section 7).*
- **Phase 2 — Panel.** WebviewPanel with conversation list (three tabs, only
  Claude populated), collapsible list, SVG thread chart, request-detail card
  on point click, tool-call counts.
- **Phase 3 — Codex adapter.** `session_index.jsonl` + rollout files;
  unavailable fields labeled, not zeroed.
- **Phase 4 — Copilot (easy parts only).** Titles + structure from
  `chatSessions` if cheap. Usage spike deferred.
- **Phase 5 — Polish.** Live file watching, context-composition breakdown,
  confidence labels (`provider reported` / `derived` / `estimated` /
  `unavailable`), per-tool token attribution where derivable.

## 7. Packaging and local install

Same working model as astro-huge-doc (`vsce package` + `code
--install-extension`), wired as npm scripts from day one.

Planned `package.json` scripts:

```jsonc
{
  "scripts": {
    "build": "esbuild …",                                   // bundle host + webview
    "package": "npm run build && vsce package --no-dependencies -o agent-context-trail.vsix",
    "install:local": "code --install-extension agent-context-trail.vsix --force",
    "reinstall": "npm run package && npm run install:local"
  }
}
```

Day-to-day commands:

```powershell
# fast dev loop — no packaging, live host, Ctrl+R to reload:
code --extensionDevelopmentPath <repo>\<ext-dir> C:\path\to\any-workspace
# (or press F5 in VS Code with the standard launch.json)

# test the real installed artifact:
npm run reinstall          # package VSIX + force-install into VS Code
# then: Developer: Reload Window

# remove:
code --uninstall-extension <publisher>.agent-context-trail
```

One-time prerequisite: `npm i -g @vscode/vsce` (or use `npx vsce`).

## 8. Decision log (former open points)

- **OP-001 — closed, later superseded.** Originally: AIC = AI Credit = $/100,
  status bar shows cost only (AIC or $), tokens live in the panel
  exclusively. **Superseded post-Phase-2**: the AIC unit was dropped
  entirely — cost is USD only, everywhere (status bar, panel, output
  channel). Tokens still live in the panel exclusively.
- **OP-002 — closed, later superseded.** Originally: status bar shows both
  numbers (last call | conversation total) with an AIC ↔ $ toggle.
  **Superseded post-Phase-2**: still shows both numbers, but with no unit
  toggle — there is only one unit (USD) to toggle between.
- **OP-003 — closed.** Main surface is a WebviewPanel (editor tab).
- **OP-004 — closed.** Cache visibility required, but per-vendor best effort:
  Claude = full-feature pilot/reference, Codex = best effort, Copilot = only
  what comes easily, not a priority.
- **OP-005 — closed.** Local investigation done (section 5). Restricted scope
  is fully served from disk JSONL; hooks only ever needed for transient
  attention states, which would require the extension's own local storage.
- **OP-006 — closed.** `config/tokens-cost.yaml` config with official vendor pricing
  URLs and retrieval dates; provider-reported cost wins when present;
  gradual improvement expected.

## 9. Specification Checkpoint

Per `WORKFLOW.md`'s Specification Checkpoint: at the start of this packet,
`specification/` was empty, so there was no existing durable contract to
violate. By the close of Phase 2 (plus the post-Phase-2 AIC removal), this
packet had settled rules stable enough to bind future phases rather than
remaining one-phase implementation detail — the two-level data scope, the
provider-honesty rule, the cost-confidence model, the status-bar/panel
division of responsibility, and the provider-tier non-goals. Those are now
captured in direct files under `specification/`. See
`implementation.md`'s matching checkpoint entry for the full assessment.
Future phases (Codex adapter, live updates, Copilot) should check that
spec before diverging from it, and refresh it if a phase deliberately
changes one of these rules.

## 10. Exit criteria

- ~~DD decisions accepted~~ — done 2026-07-04.
- Phase 1 implemented and validated against at least one real Claude Code
  session (`implementation.md` + `test.md`).
- Packaged VSIX installs and shows correct status-bar values on this machine.
- ~~Specification Checkpoint recorded~~ — done; see §9 and
  `specification/*.md`.
