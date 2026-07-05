# Agent Context Trail

See how one agent conversation's context evolves, prompt by prompt: tokens,
cache reuse, and cost — for Claude Code, Codex, and GitHub Copilot.

This is a local-first VS Code extension. It never uploads transcripts,
prompts, or telemetry anywhere. Everything is read from the same local
session files the CLIs already write.

## Status

Phase 1 & 2 (current): Claude Code data, status bar, and the conversation
panel.

- Status bar shows **last call | conversation total** cost in USD.
- Click the status bar item (or run `Agent Context Trail: Open Conversation
  Panel`) to open the panel: a conversation list (titles only, tabbed by
  provider — only Claude is populated so far), a token/cost chart for the
  selected conversation, and a per-request detail card on click.
- `Agent Context Trail: Show Conversation Summary (Text)` still prints the
  same detail as plain text in the "Agent Context Trail" output channel.
- Codex and GitHub Copilot are not implemented yet — see
  `plans/2026-07-06-initial-design/plan.md` for the phased roadmap.

## Development

```powershell
npm install
npm run build          # bundle src/extension.ts -> dist/extension.js
npm run watch           # rebuild on change
npm run typecheck       # tsc --noEmit
```

Fast dev loop (no packaging): open this folder in VS Code and press `F5`, or

```powershell
code --extensionDevelopmentPath . C:\path\to\any-workspace
```

## Package and install locally

```powershell
npm run package          # builds a production bundle + agent-context-trail.vsix
npm run install:local    # code --install-extension ... --force
npm run reinstall        # both of the above
```

Then run **Developer: Reload Window** in VS Code. To remove:

```powershell
code --uninstall-extension vectormind.agent-context-trail
```

One-time prerequisite: `@vscode/vsce` is a devDependency, so `npm install`
is enough; a global install (`npm i -g @vscode/vsce`) also works.

## Cost estimation

Cost is estimated from `config/tokens-cost.yaml`, which mirrors the official
Anthropic pricing page (URL and retrieval date recorded in the file itself).
When a provider log reports cost directly, that value is used instead and
labeled accordingly. See `plans/2026-07-06-initial-design/plan.md` (DD-005)
for the reasoning.
