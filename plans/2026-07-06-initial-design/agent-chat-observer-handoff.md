# Agent Chat Observer — Product & Engineering Handoff

> Living handoff document for a VS Code extension focused on recent AI coding-agent conversations, prompt-by-prompt token usage, cache behavior, cost, and user education.

## 1. Working title

**Agent Chat Observer**

Alternative names to revisit later:

- Agent Thread Lens
- Prompt Ledger
- Token Trace
- Agent Usage Lens
- Context Lens

The name is provisional. The product direction matters more than branding at this stage.

---

## 2. Product goal

Build a VS Code extension that helps developers understand the **last active AI coding chat**, browse **chat threads one by one**, and inspect the economics of each prompt iteration.

The extension should support:

- GitHub Copilot
- OpenAI Codex
- Claude Code

The primary purpose is **not** to become a general analytics dashboard.

The product should answer:

1. What is my current or most recent agent chat doing?
2. Does it need my attention?
3. What happened in this thread, prompt by prompt?
4. How did context, cache reuse, input tokens, output tokens, and cost evolve across the thread?
5. Which user behaviors caused token waste or savings?
6. How can the user change prompting and thread-management habits to use less context and get more value from caching?

The extension should teach users through their own real sessions rather than generic token-optimization advice.

---

## 3. Product principles

### 3.1 Focus on the last chat first

The default experience should center on the **currently active or most recently updated chat thread**.

The user should not land on a giant dashboard.

The extension should make the current thread state obvious:

- active
- waiting for approval
- waiting for user input
- completed
- failed
- idle

The user should understand the state without opening the side panel.

### 3.2 Threads before statistics

The primary navigation unit is a **chat thread**.

Within a thread, the primary analytical unit is a **prompt iteration**.

Statistics are secondary and should exist only to explain what happened across those iterations.

### 3.3 Educate through causality

Avoid vague messages such as:

> You used many tokens.

Prefer explanations such as:

> This prompt reused 82% of the previous context from cache.

> Starting a new thread here may have avoided resending 48k tokens of unrelated history.

> The last three prompts each added little new context but caused the same large conversation history to be processed again.

The extension should help users connect behavior to consequences.

### 3.4 No analytics clutter

Avoid:

- vanity charts
- daily streaks
- leaderboards
- productivity scoring
- generic AI-usage dashboards
- excessive historical aggregation
- charts that do not change a user decision

Prioritize:

- current state
- thread structure
- iteration sequence
- cache behavior
- token flow
- cost
- actionable explanations

### 3.5 Provider differences must remain visible

Copilot, Codex, and Claude Code will not necessarily expose the same event types, token details, cache metrics, pricing data, or transcript structure.

Normalize what can be normalized while preserving provider-specific fields.

Do not invent precision where a source does not provide it.

---

# 4. Core user experience

The extension has two main surfaces:

1. **Status bar**
2. **Side panel**

---

# 5. Status bar

## 5.1 Purpose

The status bar answers:

> What is the state of my most relevant AI agent chat right now?

It should stay compact.

Examples:

```text
$(sync~spin) Codex working
$(question) Claude needs input
$(check) Copilot done
$(error) Codex failed
```

Optional compact duration:

```text
$(sync~spin) Codex 42s
```

## 5.2 Which thread should appear

Priority order:

1. active thread in the current VS Code workspace
2. thread waiting for user action in the current workspace
3. most recently updated thread in the current workspace
4. most recently updated thread across all known workspaces

Workspace matching should use normalized project identity, not simply the newest log file globally.

Potential signals:

- working directory
- workspace folder
- repository root
- git remote
- provider session metadata

## 5.3 Click behavior

Clicking the status bar should open the side panel focused on the same thread.

Possible secondary command:

**Agent Chat Observer: Switch Active Thread**

This can open a Quick Pick of recent sessions.

```text
Codex    ● working       vscode-extension
Claude   ? needs input   backend
Copilot  ✓ done          docs
```

## 5.4 Minimal state model

```ts
type ThreadStatus =
  | "working"
  | "needs-input"
  | "needs-approval"
  | "done"
  | "failed"
  | "idle"
  | "unknown";
```

---

# 6. Side panel

## 6.1 Purpose

The side panel is not a metrics dashboard.

It is a **thread browser and prompt-iteration inspector**.

Mental model:

```text
Recent threads
    ↓
Selected thread
    ↓
Prompt iterations
    ↓
Per-iteration token, cache, and cost behavior
```

## 6.2 Suggested layout

### Header

Show:

- provider
- thread/session name if available
- workspace/repository
- thread status
- start time
- last activity time

Optional summary:

```text
12 iterations · $1.84 estimated · 71% cached input
```

Only show fields that are actually available or clearly labeled as estimates.

### Recent thread selector

Keep this compact.

```text
Recent
────────────────────────
● Codex    current repo
? Claude   backend
✓ Copilot  docs
```

The extension should not begin with an all-time history screen.

### Prompt iteration timeline

Each user prompt becomes one iteration.

```text
#12  "Can you fix the failing test?"
     8.2k input
     6.7k cached
     1.5k new input
     1.1k output
     $0.08

#11  "Refactor this to use the existing helper"
     42.4k input
     39.1k cached
     3.3k new input
     2.4k output
     $0.14
```

Each iteration should be expandable.

Expanded content can include:

- full or truncated user prompt
- assistant response summary
- tool calls
- files touched
- input tokens
- cached input tokens
- uncached/new input tokens
- output tokens
- reasoning tokens when available
- provider-reported cost when available
- estimated cost when provider cost is unavailable
- duration
- model
- provider
- timestamp

## 6.3 Thread trend summary

A small thread-level explanation should sit above the iteration list.

Examples:

> Cache reuse improved after iteration 3 and remained above 80%.

> Context grew from 12k to 96k tokens across this thread.

> The final four prompts reused a large context window for small incremental requests.

> The thread appears to mix two unrelated tasks; splitting earlier may have reduced repeated context.

Prefer text over charts.

---

# 7. The core analytical unit: Prompt Iteration

A prompt iteration begins when the user submits a prompt and ends when the agent reaches a terminal or waiting state.

Possible end states:

- completed
- waiting for user input
- waiting for approval
- failed
- cancelled
- interrupted

A single prompt iteration may contain:

- one user prompt
- several assistant reasoning steps
- tool calls
- shell commands
- file reads
- file writes
- approvals
- retries
- one or more assistant messages

The extension should group these into one coherent unit.

## 7.1 Proposed iteration model

```ts
interface PromptIteration {
  id: string;
  threadId: string;

  provider: "copilot" | "codex" | "claude";
  model?: string;

  startedAt: string;
  endedAt?: string;
  status:
    | "running"
    | "needs-input"
    | "needs-approval"
    | "completed"
    | "failed"
    | "cancelled";

  userPrompt?: string;
  assistantFinalMessage?: string;

  usage: {
    inputTokens?: number;
    cachedInputTokens?: number;
    uncachedInputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };

  cost: {
    providerReportedUsd?: number;
    estimatedUsd?: number;
    pricingSource?: string;
  };

  context: {
    contextWindowTokens?: number;
    contextGrowthTokens?: number;
    cacheHitRatio?: number;
  };

  activity: {
    toolCallCount?: number;
    filesRead?: string[];
    filesWritten?: string[];
    commandsRun?: string[];
  };

  rawRefs?: {
    transcriptPath?: string;
    eventIds?: string[];
  };
}
```

---

# 8. Thread model

```ts
interface AgentThread {
  id: string;
  provider: "copilot" | "codex" | "claude";

  workspaceId?: string;
  workspacePath?: string;
  repositoryRoot?: string;

  title?: string;
  sessionId?: string;

  startedAt: string;
  updatedAt: string;

  status: ThreadStatus;

  iterations: PromptIteration[];

  totals: {
    inputTokens?: number;
    cachedInputTokens?: number;
    uncachedInputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  };
}
```

---

# 9. User education model

The educational layer is a key differentiator.

The goal is not to shame the user for token use. The goal is to make invisible agent economics understandable.

## 9.1 Initial insight categories

### Cache reuse

Examples:

- high reuse: existing context is being reused effectively
- low reuse: repeated prompts may be rebuilding context
- cache drop: something changed and previously reusable context stopped being reused

### Context growth

Examples:

- context is growing steadily
- context jumped sharply after a large file or tool output
- many small prompts are carrying a large accumulated thread

### Thread splitting

Examples:

- likely unrelated topic shift
- old context appears irrelevant to recent prompts
- repeated large context for a new task

This must be conservative. Use “may” or “appears” when an inference is uncertain.

### Prompt behavior

Potential future examples:

- large repeated pasted context
- repeated restatement of unchanged requirements
- many tiny follow-up prompts
- broad initial prompts that trigger excessive exploration
- asking the agent to reread material that is already present

### Cost awareness

Explain:

- cached input can be cheaper than uncached input when the provider supports discounted cached pricing
- output may be more expensive than input depending on provider/model
- long threads can remain economical when cache reuse is high
- long threads can become expensive when cache reuse is poor

Provider pricing and cache semantics must be sourced and versioned. Do not bake prices directly into UI logic.

---

# 10. Provider integration architecture

Use a provider adapter layer.

```ts
interface AgentProviderAdapter {
  id: "copilot" | "codex" | "claude";

  discoverThreads(): Promise<AgentThreadRef[]>;

  watchEvents(
    onEvent: (event: NormalizedAgentEvent) => void
  ): vscode.Disposable;

  loadThread(threadId: string): Promise<AgentThread>;

  capabilities(): ProviderCapabilities;
}
```

## 10.1 Capability model

```ts
interface ProviderCapabilities {
  liveStatus: boolean;
  transcriptAccess: boolean;

  inputTokens: boolean;
  cachedInputTokens: boolean;
  outputTokens: boolean;
  reasoningTokens: boolean;

  providerReportedCost: boolean;
  modelIdentity: boolean;

  toolCalls: boolean;
  fileActivity: boolean;
}
```

The UI should adapt to capabilities.

```text
Cached input: unavailable from provider
```

is better than:

```text
Cached input: 0
```

---

# 11. Provider strategy

## 11.1 Codex

Preferred integration order:

1. provider lifecycle hooks or supported events
2. provider-exposed transcript/session path
3. raw transcript parsing as fallback

Use hooks for:

- working state
- waiting state
- approval state
- completion
- session identity
- workspace identity

Use transcript parsing only for details not available through event payloads.

Treat raw transcript schemas as version-sensitive.

## 11.2 Claude Code

Preferred integration order:

1. lifecycle hooks
2. provider session/transcript metadata
3. transcript parsing when required

Use hooks for live state.

Use transcript content for prompt iterations and usage details where available.

## 11.3 GitHub Copilot

This provider needs the most investigation.

Questions to resolve:

- Is there a supported API, event stream, extension API, or exported conversation source for agent chat sessions?
- Can the extension observe Copilot Chat threads from another extension?
- Are token usage and cache metrics exposed?
- Are session logs available locally?
- Are there different paths for Copilot Chat, Agent mode, coding agent, and CLI?
- What is accessible without relying on private VS Code APIs?

The initial architecture must not assume Copilot can expose the same detail as Codex or Claude Code.

Possible support levels:

```text
Level 1 — status only
Level 2 — thread and prompt structure
Level 3 — token usage
Level 4 — cache usage
Level 5 — cost
```

The extension should support partial provider capability cleanly.

---

# 12. Event normalization

All providers should emit internal events.

```ts
type NormalizedAgentEvent =
  | {
      type: "thread.started";
      provider: ProviderId;
      threadId: string;
      at: string;
    }
  | {
      type: "prompt.submitted";
      provider: ProviderId;
      threadId: string;
      iterationId: string;
      text?: string;
      at: string;
    }
  | {
      type: "agent.working";
      threadId: string;
      iterationId?: string;
      at: string;
    }
  | {
      type: "agent.needs_input";
      threadId: string;
      iterationId?: string;
      at: string;
    }
  | {
      type: "agent.needs_approval";
      threadId: string;
      iterationId?: string;
      at: string;
    }
  | {
      type: "usage.updated";
      threadId: string;
      iterationId: string;
      usage: Partial<PromptIteration["usage"]>;
      at: string;
    }
  | {
      type: "iteration.completed";
      threadId: string;
      iterationId: string;
      at: string;
    };
```

The rest of the extension should not know provider-specific event formats.

---

# 13. Local storage

Initial preference:

**SQLite or another small embedded database** if durable historical queries become important.

Alternative for MVP:

**JSON files per thread** if the dataset stays small.

Suggested split:

```text
~/.agent-chat-observer/
  index.json
  threads/
    <provider>-<thread-id>.json
  raw/
    <provider>/
```

Do not copy full raw transcripts unnecessarily.

Store only normalized data by default.

Potential future setting:

```text
agentChatObserver.retainRawEvents
```

Default:

```text
false
```

---

# 14. Privacy and trust

This extension will observe sensitive developer conversations.

Initial principles:

- local-first
- no telemetry by default
- no remote analytics backend
- no transcript upload
- no prompt upload
- no file-content upload
- clear source labels for estimated data
- clear retention setting
- ability to delete local history

Potential status indicator:

```text
Local only
```

The extension should never quietly send prompts or code to a separate analytics service.

---

# 15. Side panel implementation direction

Recommended UI:

- VS Code Webview View
- React or lightweight web UI
- provider-independent view model
- VS Code theme variables
- no custom design system initially

Potential tree:

```text
src/
  extension.ts

  status/
    statusBarController.ts

  providers/
    providerAdapter.ts
    codex/
    claude/
    copilot/

  domain/
    thread.ts
    iteration.ts
    events.ts
    usage.ts
    insights.ts

  storage/
    threadStore.ts

  panel/
    panelProvider.ts
    webview/

  pricing/
    pricingRegistry.ts

  workspace/
    workspaceMatcher.ts
```

---

# 16. MVP proposal

## Phase 1 — Status bar + one provider

Start with one provider that exposes reliable local lifecycle information.

Deliver:

- detect active/recent thread
- workspace matching
- status bar state
- click to open panel
- recent thread list
- prompt iteration list
- basic token fields when available

No charts.

No advanced insights.

No cross-provider normalization beyond what the architecture needs.

## Phase 2 — Cache and cost

Deliver:

- cached input
- uncached input
- cache hit ratio
- cost calculation
- per-iteration comparison
- thread summary explanation

Core example:

```text
Iteration 7
Input            62.4k
Cached           54.9k
New               7.5k
Output            2.1k
Estimated cost   $0.18
```

## Phase 3 — Three-provider support

Add:

- Codex
- Claude Code
- GitHub Copilot

Providers may have different capability levels. The UI should make this honest and obvious.

## Phase 4 — Behavioral insights

Add conservative rules for:

- context growth
- cache improvement
- cache regression
- probable topic shift
- repeated high-cost low-change prompts
- possible thread-splitting opportunity

Keep rules explainable.

Avoid opaque AI coaching scores.

---

# 17. What makes this extension different

Many AI-usage extensions focus on:

- total tokens
- total cost
- model usage
- daily or monthly history

This product should focus on:

> How did this specific conversation evolve, one prompt at a time, and what did my behavior do to token reuse and cost?

The important view is not:

```text
You spent $14.82 this week.
```

The important view is:

```text
Prompt 4 introduced a large context increase.

Prompts 5–8 reused most of it efficiently.

Prompt 9 changed topic and caused low cache reuse.

Starting a separate thread around prompt 9 may have reduced repeated context.
```

That is the core product thesis.

---

# 18. Open questions

These should be resolved incrementally.

## Product

- Should the default panel show only the current workspace?
- How many recent threads should be visible?
- Should completed threads disappear from the main list after a period?
- Should the extension show full prompt text by default?
- Should assistant responses be shown, summarized, or hidden by default?
- How much historical data should be retained?

## Metrics

- What exactly counts as one prompt iteration for each provider?
- How should retries be represented?
- How should tool-only continuations be grouped?
- How should context-window size be distinguished from input-token usage?
- How should cache hit ratio be defined when a provider reports multiple cache categories?

## Cost

- provider-reported cost vs local estimate
- model pricing versioning
- regional pricing
- enterprise pricing
- subscription plans where marginal cost is not directly visible

## GitHub Copilot

- What supported session data is accessible?
- Can another VS Code extension observe agent chat lifecycle?
- Can prompt iterations be reconstructed?
- Are token and cache metrics exposed anywhere?
- What is possible without private APIs?

## UX

- timeline vs stacked cards
- whether to show miniature token bars
- whether “needs input” should trigger a notification
- how much educational text is useful before it becomes annoying

---

# 19. Non-goals for the first versions

Do not build:

- cloud account sync
- team dashboards
- organization admin reporting
- employee monitoring
- prompt scoring
- coding productivity scoring
- benchmark comparisons between developers
- generic model leaderboards
- automatic prompt rewriting
- a replacement chat UI

The extension observes and explains.

It should not become another agent.

---

# 20. Immediate next design decisions

The next useful additions to this handoff are:

1. exact side-panel wireframe
2. exact prompt-iteration grouping rules
3. provider capability matrix
4. source discovery for Codex, Claude Code, and GitHub Copilot
5. first normalized event schema
6. first cost/cache calculation rules

---

# 21. Current one-sentence definition

**A local-first VS Code extension that shows the state of the current coding-agent chat and explains each conversation thread prompt by prompt, with special focus on context growth, cache reuse, token cost, and the user behaviors that create savings or waste.**
