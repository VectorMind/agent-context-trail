# Agent Context Trail

See how one agent conversation's context evolves, prompt by prompt: tokens,
cache reuse, and cost — for Claude Code, Codex, and GitHub Copilot.

This is a local-first VS Code extension. It never uploads transcripts,
prompts, or telemetry anywhere. Everything is read from the same local
session files the CLIs already write.

## Status

Phase 1 (current): Claude Code data + status bar only.

- Status bar shows **last call | conversation total** cost, in AIC (AI
  Credit, 1 AIC = $0.01) or USD — click the tooltip link to toggle the unit.
- Click the status bar item for a plain-text conversation summary (token
  detail, per-request breakdown) in the "Agent Context Trail" output channel.
- No side panel yet — see `plans/2026-07-06-initial-design/plan.md` for the
  phased roadmap (chart panel, Codex, Copilot).

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
