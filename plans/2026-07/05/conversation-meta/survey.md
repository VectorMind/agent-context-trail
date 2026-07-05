# Survey â€” Request-Level Metadata Across Providers

**Survey date:** 2026-07-05
**Question:** beyond input/output/cache tokens and estimated cost, what
metadata exists to enrich a single request's detail (tools, subagents,
latency, model, context composition), what do competing extensions claim to
show, and which of Claude Code / Codex / Copilot actually exposes what?

**Method:** two sources, weighted toward the second:

1. Marketplace/listing claims â€” the entries in
   `plans/2026-07/06/initial-design/survey.md` re-read for request-level
   detail, plus fresh web checks (2026-07-05).
2. **Ground truth on this machine** â€” key-path inventories generated over
   real local logs with a scratchpad walker script: 12 recent Claude Code
   session files (3 168 lines across 3 workspaces), one Codex VS Code rollout
   (411 lines), and the largest local Copilot Chat session (30 MB, 19
   requests). Field names below are verbatim from those files, with
   occurrence counts checked; claims from listings are marked as claims.

---

## 1. What competitors show and claim at request level

The earlier market survey established the category landscape; re-reading it
plus fresh checks for the specific request-detail features:

- **Copilot Cost Tracker** claims per-turn LLM calls **and tool calls**,
  cache percentage, "Context Tax" (history resent per turn), and behavioral
  alerts. No per-tool latency or subagent claims.
- **Claude Code Token Monitor** claims **per-turn AI working time** (the
  latency angle), per-turn tokens/cost, cache hit rate.
- **Agent Dashboard** claims tool calls, modified files, live activity feed
  across Copilot/Codex/Claude.
- **Coding Agent Trajectory Viewer** claims tool calls, tool results,
  thinking blocks â€” a debugging viewer, no economics.
- **Argus** (open source, promoted via HackerNoon) claims live token
  **attribution**: where tokens go per session including **skills, subagents,
  plugins, and MCP servers**, and flags retry loops as they happen.
- **agent-flow** (GitHub) renders Claude Code orchestration as a live node
  graph: agents, branching, real-time tool calls, via hooks.
- **Claude Code's own VS Code extension** now ships a usage dialog with
  attribution tables (skills/subagents/plugins/MCP) and a live context-window
  percentage; the CLI's `/context` shows the categorized breakdown (system
  prompt, system tools, MCP tools, agents, memory files, messages, free
  space) â€” the screenshot the maintainer provided is exactly this surface.

Takeaways: per-turn tokens/cost/cache are table stakes; **tool-level detail
(identity, inputs/outputs, latency) and subagent attribution are claimed by
few and shallowly**; nobody surveyed draws a model-switch timeline or aligns
timing/model lanes with a per-request economic chart. The `/context`-style
composition view exists only live (official tooling), never as history.

Sources: [HackerNoon on Argus](https://hackernoon.com/this-free-vs-code-extension-shows-where-your-claude-code-tokens-are-going),
[agent-flow](https://github.com/patoles/agent-flow),
[Claude Code context docs](https://code.claude.com/docs/en/context-window),
[VS Code subagents docs](https://code.visualstudio.com/docs/agents/subagents),
plus the listings archived in `plans/2026-07/06/initial-design/survey.md`.

---

## 2. Claude Code â€” ground truth (`~/.claude/projects/<slug>/<session>.jsonl`)

One line per event. Line types seen: `assistant`, `user`, `ai-title`,
`last-prompt`, `file-history-snapshot`, `attachment`, `queue-operation`,
`mode`, `custom-title`, `system`.

### 2.1 Every line (both roles)

`uuid`, `parentUuid` (thread DAG), `logicalParentUuid` (after compaction),
`sessionId`, `timestamp` (ISO, ms precision), `isSidechain`, `userType`,
`cwd`, `gitBranch`, `version` (CLI version), `promptId` (groups a user
prompt's turn), `requestId` (assistant lines), `slug`.

### 2.2 Per assistant line (= one API call)

- `message.model` â€” **per call**, so model switches inside a conversation are
  fully reconstructable.
- `message.usage`: `input_tokens`, `output_tokens`,
  `cache_read_input_tokens`, `cache_creation_input_tokens`,
  `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`
  (TTL split), `service_tier`, **`speed`** (fast mode!), `inference_geo`,
  `server_tool_use.web_search_requests` / `web_fetch_requests`,
  `iterations[]` (per-iteration usage of a single logical call).
- **`message.diagnostics.cache_miss_reason`** â€” `type`
  (`tools_changed`, `previous_message_not_found`, â€¦) plus
  `cache_missed_input_tokens`. This directly answers "input and cache is
  unclear": when a cache break happens, the log says *why* and *how many
  tokens it cost*. Nobody surveyed shows this.
- `message.stop_reason` (`tool_use` / `end_turn`), `message.id`.
- Content blocks: `text`, `thinking` (full text + signature), `tool_use`
  (`id`, `name`, **full `input`**).

### 2.3 Per tool result (user lines)

`tool_result` blocks (`tool_use_id`, content, `is_error`) plus a structured
**`toolUseResult`** sidecar per tool: Bash/PowerShell `stdout`/`stderr`/
`interrupted`; Read `file` + `numLines`; Edit `oldString`/`newString`/
`structuredPatch`/`userModified`; Grep `mode`/`numFiles`/`matches`/
`durationMs`; **Agent `agentId`/`status`/`prompt`/`resolvedModel`**;
AskUserQuestion `answers`. Explicit `durationMs` exists only for some tools â€”
but **per-tool latency is always derivable**: `timestamp(tool_result line) âˆ’
timestamp(assistant tool_use line)`. Tool input/output *sizes* come free from
the stored content.

### 2.4 Subagents

Full transcripts under `<sessionId>/subagents/agent-<id>.jsonl`
(`isSidechain: true`), same schema (own usage, tools, models), joined to the
parent via `toolUseResult.agentId`. Subagent token/cost attribution is
therefore exact, not estimated.

### 2.5 Session-level extras

`ai-title`/`custom-title` (titles), `last-prompt` + `leafUuid`,
`file-history-snapshot` (per-file backup versions â€” the "files touched"
timeline), `queue-operation` (queued prompts), `mode` records,
`system` records with `subtype: compact_boundary` â€” **compaction moments are
marked**, which a context-growth chart needs.

### 2.6 What is NOT in the log

The `/context`-style category breakdown (system prompt X, system tools Y,
memory files, skills, messages) is computed live by the CLI and **never
persisted**. Per-request context occupancy is still derivable:
`cache_read + cache_creation + input_tokens` â‰ˆ what the model saw; carried
context = `cache_read`, new = `cache_creation + input`. The share coming from
file reads vs user prompt is estimable from stored content sizes (chars/4
heuristic) â€” an estimate, and must be labeled as such.

---

## 3. Codex â€” ground truth (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`)

Plus `~/.codex/session_index.jsonl` (id, `thread_name`, `updated_at`) â€” titles
and recency come cheap. Line types: `session_meta`, `turn_context`,
`response_item`, `event_msg`.

- **`session_meta`**: cwd, `originator` (`codex_vscode`), `cli_version`,
  git `branch`/`commit_hash`/`repository_url`, timezone.
- **`turn_context` (per turn)**: `model` (e.g. `gpt-5.4`), reasoning
  `effort`, `approval_policy`, sandbox/permission profile,
  `model_context_window`, personality, collaboration mode.
- **`event_msg: token_count`**: `info.last_token_usage` and cumulative
  `total_token_usage`, each with `input_tokens`, **`cached_input_tokens`**,
  `output_tokens`, **`reasoning_output_tokens`**, `total_tokens`; plus
  `model_context_window` â€” context occupancy is **explicit**, not derived.
- **`rate_limits` per turn**: plan type, primary/secondary windows,
  `used_percent`, reset times. Codex has no USD price (subscription); the
  honest "cost" figure is rate-limit consumption.
- **Turn timing**: `duration_ms` and **`time_to_first_token_ms`** per task,
  `started_at`/`completed_at`; MCP tool calls carry their own
  `duration.secs/nanos`; shell outputs embed "Exit code / Wall time".
- Tools: `function_call` (name, full arguments, `call_id`) +
  `function_call_output`; MCP `invocation.server/tool/arguments` +
  `result.Ok` (isError, structuredContent); web search actions; `apply_patch`
  **unified diffs per file**.
- Reasoning content is `encrypted_content` (opaque), though its token count
  is reported. `turn_id` stitches every item to its turn.
- Multi-agent: `multi_agent_version: v1` flag present; no sidechain
  transcripts observed in the sample.

---

## 4. Copilot â€” ground truth (VS Code `workspaceStorage/*/chatSessions/*.json`)

One JSON per session (recent VS Code builds also write a `.jsonl` variant):
`sessionId`, `creationDate`, `lastMessageDate`, `customTitle`, selected model
metadata (incl. `maxInputTokens`/`maxOutputTokens`), then `requests[]`:

- Per request: prompt text + `variableData` (attached context references),
  `timestamp`, `modelId` (e.g. `copilot/gpt-5.2`),
  **`result.details` = "GPT-5.2 â€¢ 1x"** â€” model + **premium-request
  multiplier**, Copilot's only native cost signal;
  **`result.timings.firstProgress` / `totalElapsed`** (explicit latency,
  better than Claude's derived one); `errorDetails`
  (`Canceled`, `responseIsIncomplete`).
- `result.metadata.toolCallRounds[]`: round id, response text, `toolCalls`,
  and **`thinking.tokens`** â€” the *only* token number in the file.
- `response[]` parts typed by `kind` (`thinking`,
  `toolInvocationSerialized`, `mcpServersStarting`, â€¦) with
  `toolId`/`toolCallId`; `editedFileEvents[]` (files changed, URIs);
  `codeBlocks` with language.
- **No input/output/cache token usage at all.** Confirms AI Insights'
  marketplace warning. The richer path claimed by Copilot Cost Tracker
  (`github.copilot.chat.otel.dbSpanExporter.enabled` â†’ OTel spans /
  `agent-traces.db`) stays an open investigation lead â€” do not design the
  Copilot adapter around chatSessions alone.
- `~/.copilot` (Copilot CLI) exists here too: SQLite `data.db` + `logs/` â€”
  unexplored, separate lead.

---

## 5. Capability Ã— provider table

`â—` in the local log, verbatim field Â· `â—` derivable/estimable (label it) Â·
`â€”` not available in the surveyed source.

| Capability | Claude Code | Codex | Copilot Chat |
|---|---|---|---|
| Input tokens per request | â— `usage.input_tokens` | â— `last_token_usage.input_tokens` | â€” |
| Output tokens | â— | â— | â€” |
| Cache read | â— `cache_read_input_tokens` | â— `cached_input_tokens` | â€” |
| Cache write (+TTL split 5m/1h) | â— | â€” | â€” |
| **Cache-miss reason + size** | â— `diagnostics.cache_miss_reason` | â€” | â€” |
| Reasoning/thinking tokens | â— (thinking text stored; count not split) | â— `reasoning_output_tokens` | â— `thinking.tokens` per round |
| Cost (USD) | â— estimated from pricing | â€” (â— rate-limit `used_percent` instead) | â€” (â— premium multiplier instead) |
| Model per request / switches | â— per API call | â— per turn | â— per request |
| Request wall time | â— derived from timestamps | â— `duration_ms` | â— `timings.totalElapsed` |
| Time to first token | â— | â— `time_to_first_token_ms` | â— `timings.firstProgress` |
| Tool call count | â— | â— | â— |
| Tool identity + full inputs | â— `tool_use.name/input` | â— `function_call` | â— serialized invocation |
| Tool outputs (full) | â— + structured `toolUseResult` | â— output text / MCP structured | â— `toolCallResults` |
| Per-tool latency | â— derived (+ `durationMs` for some) | â— MCP `duration`; shell wall time | â— per round at best |
| Tool errors | â— `is_error` | â— `isError` + exit codes | â— request-level only |
| **Subagents (own transcript, usage)** | â— `subagents/agent-*.jsonl` + `agentId` | â— `multi_agent v1` flag, none observed | â€” (VS Code subagents: lead) |
| Files edited / diffs | â— `structuredPatch` + file-history snapshots | â— unified diffs | â— `editedFileEvents` |
| Context occupancy per request | â— `cache_read+creation+input` | â— total + `model_context_window` | â€” (only model max known) |
| Context composition (system prompt / tools / files / messages) | â€” live-only (`/context`), never logged; â— estimable from stored content | â€” | â€” |
| Compaction boundaries | â— `compact_boundary` | â— | â€” |
| Web search/fetch usage | â— `server_tool_use` counts | â— search actions | â— |
| Interruption / cancel | â— `interrupted`, `stop_reason` | â— task lifecycle | â— `errorDetails` |
| Quota / rate limits | â€” | â— per turn | â€” |
| Fast mode / service tier / reasoning effort | â— `speed`, `service_tier` | â— `effort` | â€” |
| Git context | â— `gitBranch` per line | â— branch+commit at start | â€” |
| Session title | â— `aiTitle`/`customTitle` | â— `session_index` | â— `customTitle` |

Reading: **Claude is deepest on cache semantics, tools, and subagents; Codex
is deepest on timing, reasoning tokens, and explicit context occupancy;
Copilot chatSessions has structure (tools, timings, edits, multiplier) but no
token economics** â€” its OTel path is the make-or-break investigation.
Per the LedgerLM lesson in the earlier survey: absent fields display as
"unavailable", never `0`.

---

## 6. Answers to the maintainer's specific questions

**"Input and cache is unclear â€” prompt vs system prompt vs file inputs?"**
Not exposed as numbers by any provider log. What we *can* do honestly, on
Claude: (1) split carried (`cache_read`) vs new (`cache_creation + input`)
per request â€” exact; (2) explain cache breaks with `cache_miss_reason` â€”
exact and unique to us; (3) attribute the *new* part to user prompt vs tool/
file results by measuring the stored content â€” estimate, labeled. The
`/context` category view (screenshot) is CLI-live, not in the logs; its
historical analog is the derived occupancy line above.

**"Context as a side thing / section, cumulative over rounds?"**
Yes as a derived per-request series inside one conversation: context
occupancy â‰ˆ `cache_read + cache_creation + input` per request, drawn as a
step/area lane over the request axis, with compaction boundaries marked
(Claude) and `model_context_window` as ceiling (Codex exact; Claude by model
lookup). This respects product-scope (stays within one conversation).

**"Tool calls and tool stats in a chart"** â€” counts, identity, in/out sizes,
error flags all available (Claude/Codex â—); latency derivable. Chart
candidate: per-request tool-call bars (stacked by tool name) aligned under
the token chart + a per-conversation tool summary table (calls, output
volume, errors, median latency per tool).

**"Model + timeline state chart aligned with the others"** â€” model per
request is â— on all three. Candidate: two thin lanes sharing the thread
chart's request axis: a categorical model lane (color per model, switch
marked) and a duration lane (wall time per request; gap-to-previous-request
in the tooltip). Keeps one axis per plot; alignment gives the "when did the
model switch and how long between requests" reading at a glance.

---

## 7. Environment

Windows 11; Claude Code 2.1.x logs, Codex CLI 0.142.5 rollout, Copilot Chat
0.35.2 session; walker scripts and raw inventories in the session scratchpad
(disposable, not committed).


