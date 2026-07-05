# Market Survey — Prompt-by-Prompt Context History for AI Coding Agents

**Survey date:** 2026-07-04  
**Market:** Visual Studio Marketplace  
**Product under investigation:** a local-first VS Code extension for GitHub Copilot, OpenAI Codex, and Claude Code that focuses on the current/last chat, thread-by-thread navigation, and the history of context/cache/cost across successive prompt iterations.

> This is a search-based market survey, not a claim of exhaustive coverage. Marketplace listings change quickly, search indexing is imperfect, and install counts are volatile. Feature assessments below are based on what the Marketplace listings explicitly claim as of the survey date.

---

# 1. Product concept being compared

The target product is not primarily a token dashboard or a chat archive.

Its core sequence is:

```text
Current / last relevant chat
        ↓
One selected thread
        ↓
Prompt iteration 1
        ↓
Prompt iteration 2
        ↓
Prompt iteration 3
        ↓
How the same conversation context changed, was cached, and cost money
```

The intended user questions are:

1. What is my current or most recent agent chat doing?
2. Does it need my attention?
3. What were the prompt iterations in this thread?
4. What changed between one prompt iteration and the next?
5. How much context was carried forward?
6. How much was cached versus new?
7. What did that iteration cost?
8. Which user behavior caused savings or waste?

The differentiator under test is therefore:

> **The history and lineage of the same conversation context across successive prompts.**

---

# 2. Executive summary

The market is crowded in three adjacent categories:

1. **Usage dashboards** — total tokens, cost, models, time ranges, budgets.
2. **History browsers** — browse and search past sessions and messages.
3. **Agent monitors** — running, waiting, tool use, last messages, multi-agent control.

The pieces of the target idea exist, but they are usually separated.

The closest product found is **Copilot Cost Tracker**. It explicitly includes a per-turn explorer, cache percentage, a “Context Tax” visualization showing how much conversation history each turn resends, context growth, cache savings, and behavioral alerts such as micro-turn bloat and raw-paste detection. This is direct overlap with the context-economics and education idea.

However, its center of gravity is still a Copilot-focused analytics dashboard with cost, budgets, charts, grades, date filters, and aggregate optimization views. It does not appear to center the experience on the last chat, one thread at a time, with consecutive prompt iterations as the main product surface.

Other close products each cover one part well:

- **Agent Dashboard** comes closest to the full provider set plus live status, session history, tools, and token/cost monitoring.
- **Terminal Sessions** comes closest to live status plus last user/assistant messages.
- **Claude Code Token Monitor** comes closest to per-turn token/cost/cache metrics inside a real session history, but only for Claude Code.
- **AI Insights** comes closest to exactly the desired provider coverage: Copilot + Claude Code + Codex.
- **Claude Code and Codex Assist**, **Chat Wizard**, and **Codex History Viewer** are strong history browsers, but their focus is finding and revisiting conversations rather than explaining the economic evolution of one context.
- **LedgerLM** is strong on cache breakdowns and cache-break analysis, but it is dashboard-first and does not support Codex in the surveyed listing.

## Main conclusion

I did **not** find a Marketplace listing that clearly combines all of the following:

1. last/current chat as the default focus
2. live agent attention state
3. GitHub Copilot + Codex + Claude Code
4. thread-by-thread navigation
5. prompt iterations inside the selected thread
6. per-iteration token/cache/cost data
7. explicit comparison between consecutive iterations
8. educational explanations anchored to the exact prompt transition that caused savings or waste

That combination remains a credible product gap.

---

# 3. Search methodology

Searches were run using multiple keyword families rather than one product name.

## 3.1 Token, usage, and cost

Representative queries:

```text
VS Code AI token cost usage
token tracker AI coding agent
Claude Code usage tokens cost
Codex usage cost
Copilot usage token cost
AI cost tracker VS Code
per-turn token cost
last message cost
```

## 3.2 Chat and session history

Representative queries:

```text
AI chat history VS Code
coding agent conversation history
prompt history AI agent
session history Claude Codex Copilot
chat timeline
conversation timeline
thread browser AI coding
```

## 3.3 Context and cache

Representative queries:

```text
context usage AI coding agent
context history VS Code
cache efficiency Claude Code
cache hit prompt history
context growth per turn
context tax AI chat
cache break AI usage
```

## 3.4 Live agent status

Representative queries:

```text
AI agent status bar
agent waiting for input VS Code
Claude Codex session status
agent monitor sidebar
last assistant message status bar
current agent session monitor
```

## 3.5 Cross-provider coverage

Representative queries:

```text
Copilot Claude Codex VS Code extension
multi-provider AI usage tracker
unified AI chat history
Claude Code Codex Copilot analytics
```

## 3.6 Exclusions

The survey deprioritized:

- extensions that merely count tokens in the current text file
- generic LLM chat clients
- prompt-template managers
- AI coding assistants whose analytics are only about their own newly created chat UI
- quota-only monitors without conversation history
- organization-level employee monitoring products

---

# 4. Closest competitors

## 4.1 Copilot Cost Tracker

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=Hoxlegion.copilot-cost-tracker  
**Observed installs:** 300

### Why it is the closest analytical competitor

The Marketplace listing explicitly claims:

- live status bar
- recent sessions
- turn-level explorer
- LLM calls and tool calls per turn
- cache percentage per turn
- “Context Tax” showing how much conversation history each turn resends
- average context growth curve
- cache savings
- context growth charts
- heavy-context warnings
- behavioral alerts:
  - micro-turn bloat
  - raw paste
  - premium-model misallocation
  - agent sprawl / massive-context turns
- cost per turn
- efficiency scoring

This is the strongest overlap with the target product's central thesis.

### Where it differs

Its information architecture is analytics-first:

```text
Dashboard
Activity
Models
Efficiency
Budget
```

Its status bar emphasizes:

```text
session cost
billing-period cost
active context weight
```

The target product instead wants:

```text
current chat state
selected thread
successive prompt iterations
what changed between iteration N and N+1
```

It is also focused on Copilot telemetry rather than presenting Copilot, Codex, and Claude Code as equal first-class providers.

### Competitive implication

Do not position the product merely as:

> Understand context growth and cache efficiency.

That space is already occupied.

A stronger position is:

> **See the lineage of one conversation context, prompt by prompt, across the coding agents you already use.**

The product should compare adjacent prompt iterations directly rather than lead with grades, charts, and aggregate date ranges.

---

## 4.2 Agent Dashboard

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=AmiSchreiber.agent-dashboard  
**Observed installs:** 143

### Why it is close

The listing explicitly claims support for:

- GitHub Copilot
- Claude Code
- OpenAI Codex
- live agent status
- model
- token usage
- estimated cost
- full conversation history
- user prompts
- assistant responses
- tool calls
- modified files
- real-time token breakdown
- live activity feed

It is the closest surveyed product to the target provider coverage plus live-monitoring architecture.

### Where it differs

Its core concept is a multi-agent control room:

- remote control
- mobile access
- cross-machine monitoring
- process control
- multiple agents at once

The target product is narrower:

> Understand one current/recent conversation and the economics of its prompt sequence.

### Competitive implication

Agent Dashboard proves that cross-provider live observation is a viable Marketplace category.

The target should avoid competing on:

- remote control
- mobile access
- “all agents at once”
- orchestration

Instead, it should be deliberately calmer and more forensic.

---

## 4.3 Claude Code Token Monitor

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=Miku3w3.claude-code-token-monitor  
**Observed installs:** 17

### Why it is close

The listing explicitly claims:

- current session title
- per-turn AI working time
- per-turn tokens
- per-turn cost
- cache hit and miss
- cache hit rate
- cumulative total
- session selector
- full message history
- “Show Last Message Cost”

This is the closest single-provider example of the desired per-prompt economics.

### Where it differs

It is Claude Code only.

The listing does not center on:

- evolution of the same context across turns
- adjacent-turn comparison
- thread-splitting decisions
- behavior education
- Copilot and Codex

### Competitive implication

The target product needs a stronger iteration view than a numeric row.

Each iteration should answer:

```text
What was inherited?
What was newly added?
What was cached?
What changed from the previous prompt?
What behavior explains the change?
```

---

## 4.4 Terminal Sessions

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=visul.terminal-sessions  
**Observed installs:** 68

### Why it is close

The listing claims a sidebar with:

- working/tool/waiting state
- context-window percentage
- cost
- last user message
- last assistant message
- conversation browsing
- session resume

It uses hooks plus transcript tailing for agent awareness.

This is very close to the planned status-bar and side-panel awareness layer.

### Where it differs

Its core product is persistent terminal infrastructure based on tmux.

Its conversation monitoring supports Claude Code, Codex, Antigravity, and Grok, but not GitHub Copilot in the surveyed listing.

It does not claim prompt-by-prompt cache/cost lineage.

### Competitive implication

The planned extension should make its status surface visibly different:

```text
Claude needs input
Codex working
Copilot done
```

rather than:

```text
$4.25
35K context
```

Clicking the status should open the exact thread and prompt iteration that produced the state.

---

## 4.5 AI Insights — Token Tracker

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=thewalking-dev.ai-insights  
**Observed installs:** 815

### Why it is close

The listing supports exactly the target providers:

- GitHub Copilot
- Claude Code
- Codex

It also includes:

- status-bar usage
- local session-log reading
- input/output/cache data where available
- model cost estimation
- provider breakdown
- charts
- diagnostics

### Where it differs

Its core views are totals and time windows:

- current day
- 30 days
- provider totals
- model totals
- daily usage
- projected yearly cost

It does not claim a thread-first prompt-iteration history.

### Important technical warning

Its listing says Copilot local session data does not expose a reliable separate cache-read/cache-write breakdown in the sources it uses, so Copilot cache metrics are shown as unavailable/zero.

This conflicts with the much richer Copilot cache/context claims made by Copilot Cost Tracker, which reads Copilot telemetry from a different source.

That discrepancy should become a dedicated technical investigation.

---

## 4.6 Claude Code and Codex Assist — History & Diff Viewer

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=agsoft.claude-history-viewer  
**Observed installs:** 8,483

### Why it is close

The listing claims:

- Claude Code
- Codex
- GitHub Copilot
- unified session list
- conversation history
- search
- usage analytics
- token trends
- cost
- live auto-refresh
- project detection
- resume and fork flows

It has the strongest install count among the independent history-focused competitors surveyed.

### Where it differs

Its core user problem is:

> Find, inspect, organize, resume, and convert historical sessions.

The target product's core problem is:

> Understand how one active/recent context evolved from prompt to prompt.

The distinction between **conversation archive** and **context lineage** should remain explicit.

---

## 4.7 Chat Wizard

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=Veverke.chatwizard  
**Observed installs:** 141

### Why it is close

The listing claims:

- unified AI chat history
- GitHub Copilot and Claude Code support
- full-text search
- prompt library
- token analytics
- chronological timeline
- topic drift
- live indexing
- session archive
- export
- MCP access to history

### Where it differs

It optimizes for retrieval and reuse of old conversations across many tools.

Its timeline is primarily historical activity navigation, not a per-thread economic sequence of context/cache transitions.

The surveyed listing does not list Codex among its supported sources.

### Competitive implication

Avoid making search, export, prompt libraries, and historical archiving the MVP center.

Those are mature adjacent features and can easily bury the unique idea.

---

## 4.8 LedgerLM

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=TatsatP.ledgerlm

### Why it is close

The listing claims:

- Claude Code
- GitHub Copilot
- fresh input
- cached read
- cache write
- output
- cache efficiency
- cache breaks
- latest session
- all sessions
- live tracking
- local SQLite
- cost confidence labels

It is one of the strongest surveyed products on honest cache semantics.

### Where it differs

Its structure is dashboard-first:

```text
Overview
Sessions
Models
Agents & Tools
```

The surveyed listing supports Claude Code, Copilot, and Gemini CLI, not Codex.

It does not claim a prompt-sequence view showing how the same thread's context changed between adjacent user prompts.

### Competitive implication

The target product should borrow the idea of data-confidence labels.

Examples:

```text
Provider reported
Exact from local log
Estimated
Unavailable
```

Never turn missing cache data into `0`.

---

## 4.9 TokenScope

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=hooni.tokenscope  
**Observed installs:** 228

### Why it is close

The listing claims:

- Claude Code
- Codex
- local log reading
- status bar
- workspace totals
- session browsing
- input/output/cache-write/cache-read/reasoning tokens
- estimated cost

### Where it differs

The key questions are project totals:

```text
How many tokens today?
Which model uses most?
How much does this project cost?
```

It does not claim prompt-iteration lineage or live attention state.

---

## 4.10 Coding Agent Trajectory Viewer

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=wuwendyy.trajectory-viewer  
**Observed installs:** 40

### Why it is close

The listing claims:

- Claude Code
- Codex
- past session browsing
- conversation timeline
- user prompts
- assistant messages
- tool calls
- tool results
- thinking blocks
- saved project context
- API request/response capture for Claude Code

It is the closest surveyed product to the word **trajectory** in the exact conversation-history sense.

### Where it differs

It is primarily a debugging/research viewer.

It does not claim:

- cost per iteration
- cache evolution
- adjacent-turn economics
- user behavior education
- Copilot

### Competitive implication

“Trajectory” is already being used for agent execution history.

For naming and positioning, words such as **lineage** may better emphasize inherited context across prompts.

---

## 4.11 Codex History Viewer

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=hiztam.codex-history-viewer  
**Observed installs:** 4,264

### Why it is close

The listing claims:

- Codex
- Claude Code
- project views
- chat-like history
- prompt and response search
- tool cards
- diffs
- turn boundaries
- turn summaries
- running state in live mode
- resume and handoff

### Where it differs

It is a sophisticated history manager.

It does not claim prompt-level token/cache/cost evolution.

### Competitive implication

History browsing itself is not enough differentiation.

The iteration view must make invisible context economics visible.

---

## 4.12 Official GitHub Copilot Chat

**Marketplace:** https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat  
**Observed installs:** 76,255,686

This is not a direct independent competitor, but it changes the baseline expectation.

The current listing claims:

- multiple parallel agent sessions
- central session view
- session status
- switching between active work
- reviewing file changes
- resuming sessions
- working with providers such as Claude and Codex
- handoffs between agent types with context preserved

### Competitive implication

“See your agent sessions in one place” is no longer enough as a product promise.

The extension needs to own a different question:

> **What happened to the context of this conversation from one prompt to the next?**

---

# 5. Feature comparison matrix

Legend:

- `●` explicitly claimed in the Marketplace listing
- `◐` partial or adjacent capability
- `—` not found in the surveyed listing

| Extension | Live agent attention state | Thread/session history | Prompt/turn sequence | Per-turn token or cost | Cache/context evolution | Copilot + Codex + Claude | Behavioral guidance |
|---|---:|---:|---:|---:|---:|---:|---:|
| Copilot Cost Tracker | — | ● | ● | ● | ● | — | ● |
| Agent Dashboard | ● | ● | ● | ◐ | ◐ | ● | — |
| Claude Code Token Monitor | ◐ | ● | ◐ | ● | ◐ | — | — |
| Terminal Sessions | ● | ● | ◐ | ◐ | — | — | — |
| AI Insights | ◐ | — | — | — | ◐ | ● | — |
| Claude Code and Codex Assist | ◐ | ● | ◐ | ◐ | — | ● | — |
| Chat Wizard | ◐ | ● | ● | ◐ | — | — | — |
| LedgerLM | ◐ | ● | — | — | ● | — | ◐ |
| TokenScope | ◐ | ● | — | — | ◐ | — | — |
| Coding Agent Trajectory Viewer | — | ● | ● | — | ◐ | — | — |
| Codex History Viewer | ◐ | ● | ● | — | — | — | — |
| GitHub Copilot Chat | ● | ● | ● | — | — | ◐ | — |

## Reading the matrix

No single surveyed product owns the full column set.

The closest combinations are:

```text
Copilot Cost Tracker
= prompt economics + context/cache education

Agent Dashboard
= cross-provider live state + conversations + tokens

Terminal Sessions
= live state + last messages

Claude Code Token Monitor
= per-turn metrics + session history

AI Insights
= exact three-provider usage coverage

History viewers
= thread/session navigation
```

The proposed product should combine those ideas around one narrower center:

```text
Last chat
  → selected thread
    → prompt iterations
      → context/cache/cost transition between each iteration
```

---

# 6. The strongest competitive threat

The strongest threat to the original differentiation is **Copilot Cost Tracker**.

Its Marketplace listing already uses concepts very close to the planned product:

- context resend per turn
- context growth
- cache percentage
- cost per turn
- cache savings
- micro-turn bloat
- raw-paste detection
- context-heavy turn alerts
- optimization guidance

Therefore, the product should not claim:

> Nobody shows per-turn context cost.

That would be false based on this survey.

A defensible claim is narrower:

> **Most tools aggregate usage or archive conversations. This extension follows the same conversation context across successive prompts, across multiple coding agents, and explains the transition from one prompt iteration to the next.**

That is the gap the survey still supports.

---

# 7. Product positioning after the survey

## 7.1 Avoid generic category language

Avoid leading with:

- token tracker
- AI insights
- usage analytics
- cost dashboard
- chat history
- session monitor

Those categories are crowded.

## 7.2 Lead with context history

Better category language:

- context lineage
- prompt-by-prompt context history
- conversation context evolution
- context trail
- prompt iteration history
- turn-to-turn context changes

A strong one-line description:

> **See how one agent conversation's context evolves, prompt by prompt.**

A fuller version:

> **Follow the last coding-agent chat prompt by prompt and see what context was carried, cached, added, and paid for.**

## 7.3 Make adjacent-turn comparison the signature UI

A normal token tracker shows:

```text
Prompt 7
Input: 62K
Cached: 55K
Output: 2K
Cost: $0.18
```

The target product should show:

```text
Prompt 6 → Prompt 7

Context carried forward   +48K
New context                +7K
Cache reuse                88%
Output                     +2K
Cost                       $0.18

Why it changed:
You stayed on the same task and reused most of the previous context.
```

Or:

```text
Prompt 8 → Prompt 9

Context carried forward   +72K
New context               +31K
Cache reuse                24%
Cost                       $0.84

Likely cause:
The conversation changed topic while retaining a large earlier thread.
A new thread may have avoided carrying unrelated context.
```

This transition view is more distinctive than another dashboard.

---

# 8. UX implications

## 8.1 Status bar

Competitors commonly use the status bar for:

- token totals
- cost
- context percentage
- quota

The proposed product should use it primarily for **attention state**:

```text
Codex working
Claude needs input
Copilot done
```

Secondary tooltip information can include:

```text
Thread: Fix auth regression
Iteration: 7
Last turn: $0.18
Cache reuse: 88%
```

Clicking should open the exact active/recent thread.

## 8.2 Side panel

Do not start with:

```text
Overview
Models
Budgets
Charts
30 days
```

Start with:

```text
Current / recent thread
        ↓
Prompt iterations
        ↓
Selected transition
```

Suggested structure:

```text
┌ Current thread ─────────────────────┐
│ Codex · working                     │
│ Fix auth regression                 │
│ 7 prompt iterations                 │
└─────────────────────────────────────┘

#7 Can you fix the failing test?
   62K input · 88% cached · $0.18

   ↑ +7K new context since #6
   ✓ same task, strong cache reuse

#6 Refactor this to use the helper
   55K input · 81% cached · $0.14

#5 ...
```

## 8.3 Education

Avoid a global “you are inefficient” score as the primary teaching mechanism.

Prefer explanations attached to a concrete transition:

```text
Between prompt 4 and prompt 5...
```

This is more causal and less judgmental.

---

# 9. Technical leads discovered from competitor listings

These are investigation leads, not yet validated implementation decisions.

## 9.1 GitHub Copilot sources mentioned by surveyed extensions

Different extensions claim to read different local sources:

- `workspaceStorage/*/chatSessions/`
- Copilot debug JSONL logs
- `agent-traces.db`
- OpenTelemetry span export
- VS Code chat session JSONL
- proposed Chat Sessions API

One especially important setting mentioned by Copilot Cost Tracker is:

```json
"github.copilot.chat.otel.dbSpanExporter.enabled": true
```

Its listing claims this creates telemetry data rich enough for:

- turn-level discovery
- cache percentage
- context weight
- cost/credit attribution

This should be investigated early.

## 9.2 Copilot cache-data conflict

There is a significant discrepancy between listings:

- **AI Insights** says the Copilot local sources it uses do not expose useful separate cache-read/cache-write counts.
- **Copilot Cost Tracker** claims per-turn cache percentage and context economics using a different telemetry path.

This may mean:

1. the data sources have different fidelity
2. some Copilot modes expose richer data than others
3. cache percentage is inferred rather than directly reported
4. data formats changed recently
5. the two extensions define “cache” differently

Do not design the Copilot adapter until this is resolved.

## 9.3 Claude Code

Surveyed extensions repeatedly use:

```text
~/.claude/projects/**/*.jsonl
```

Listings claim these logs can contain:

- messages
- input tokens
- output tokens
- cache read
- cache creation
- model
- timestamps

Claude appears to be the easiest provider for an initial per-iteration prototype.

## 9.4 Codex

Surveyed extensions repeatedly use:

```text
~/.codex/sessions/
```

and describe usage snapshots in rollout JSONL files.

Codex plus Claude Code appears to be a practical first pair for thread and iteration reconstruction.

---

# 10. Recommended MVP after the survey

## Phase 1 — Prove context lineage with one provider

Start with Claude Code because the surveyed ecosystem repeatedly claims rich per-message usage and cache data.

Build only:

1. last/current thread
2. prompt iteration list
3. adjacent-iteration comparison
4. cached vs new input
5. cost
6. one or two causal explanations

No charts.

No daily totals.

No global dashboard.

## Phase 2 — Add live state

Add:

```text
working
needs input
needs approval
done
failed
```

Make the status bar open the exact thread.

## Phase 3 — Add Codex

Normalize:

- thread
- prompt iteration
- usage
- cache
- cost confidence
- live state

Do not force unavailable fields to zero.

## Phase 4 — Resolve Copilot telemetry

Prototype and compare:

- chatSessions storage
- debug logs
- OTel / `agent-traces.db`
- extension APIs
- Chat Sessions API availability

Only after this should the cross-provider data model be frozen.

---

# 11. Suggested differentiation statement

## Internal product thesis

> Most AI coding analytics tools answer “how much did I use?” and most history tools answer “what did I say?”. This product answers “how did the same conversation context evolve from one prompt to the next, and what did that behavior do to cache reuse and cost?”

## Marketplace-style description

> Follow your latest Copilot, Codex, and Claude Code conversations prompt by prompt. See how context grows, what gets reused from cache, what each iteration costs, and which conversation habits save or waste tokens.

## Short tagline

> **Your agent context, prompt by prompt.**

---

# 12. Naming implications

The survey reinforces that generic words are crowded:

```text
Token
Usage
Cost
Insights
Dashboard
History
Monitor
Tracker
```

Words that better match the remaining gap:

```text
Lineage
Trail
Evolution
Flow
Sequence
Thread
Turn
Context
```

Of the names discussed so far:

## Context Lens

Still a strong brand, but broad.

Possible subtitle:

> **Context Lens — Follow agent context prompt by prompt.**

## Context Lineage

More directly communicates inherited context across successive prompts.

Possible subtitle:

> **Context Lineage — See how each prompt inherits, grows, and reuses context.**

A naming direction worth exploring is a short brand name with a precise Marketplace subtitle rather than forcing the entire concept into the name.

---

# 13. Watch list

These products should be rechecked periodically because they are closest to the target space:

1. Copilot Cost Tracker
2. Agent Dashboard
3. Claude Code Token Monitor
4. Terminal Sessions
5. AI Insights
6. Claude Code and Codex Assist
7. LedgerLM
8. Coding Agent Trajectory Viewer
9. Codex History Viewer
10. GitHub Copilot Chat

The most important changes to watch for are:

- cross-provider additions
- per-turn cache/context views
- adjacent-turn comparisons
- live attention-state indicators
- prompt-level educational recommendations

---

# 14. Final assessment

The market is more active and closer to the concept than expected.

The original broad idea:

> status bar + side panel + tokens + cost + history

is **not differentiated enough**.

The refined idea still appears differentiated:

> **A last-chat-first, cross-provider conversation viewer that treats prompt iterations as a sequence of inherited context and explains the cache/cost transition between adjacent prompts.**

That should remain the center of the product.

Everything else is secondary.
