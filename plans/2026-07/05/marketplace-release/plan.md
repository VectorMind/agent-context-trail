# Marketplace Release Packaging

## Problem Summary

The extension already packages locally (`npm run package` -> `vsce package` ->
`agent-context-trail.vsix` at the repo root), but it is not marketplace-ready:
no icon, no gallery banner, no changelog, `private: true`, no
`homepage`/`bugs` links, and the README is developer-facing rather than the
page a marketplace visitor should see. The maintainer also asked whether a
separate repo is needed and which README/icon the marketplace uses.

Reference design: `C:\dev\MicroWebStacks\astro-huge-doc\packages\vscode-extension`
(Markdown Site Preview) - window-frame icon with indigo->violet gradient,
dark body, cyan accent; user-facing README with a hero screenshot; CHANGELOG
per release.

## Goal And Objectives

- Make `vsce package` produce a marketplace-presentable VSIX from this repo
  as-is (no repo split).
- Marketplace metadata: icon, gallery banner, homepage, bugs, `private: false`.
- Marketplace-facing `README.md` (hero screenshot placeholder, features,
  commands, privacy) with developer docs moved to `DEVELOPMENT.md`.
- `CHANGELOG.md` for the Marketplace "Changelog" tab.
- Five icon candidates in `images/icon-variants/` sharing the astro-huge-doc
  design language, plus a rendered `icon.png` from the recommended one so
  packaging works before the maintainer picks.

## Scope And Non-Goals

- No `vsce publish` and no publisher/PAT setup in this packet; only local
  packaging is verified.
- No screenshot creation - the maintainer will add `images/screenshot.png`.
- No repo restructuring: the extension stays at the repo root (standard
  single-extension layout; `repository.directory` is only needed in monorepos
  like astro-huge-doc).

## Specification Checkpoint (before work)

Reviewed `specification/product-scope.md`, `provider-and-cost.md`,
`surfaces-and-privacy.md`:

- README claims must match the durable contracts: local-first / no telemetry
  (surfaces-and-privacy), status bar shows last-request + conversation-total
  USD only, panel opens on demand (no activity-bar icon), never fabricate
  missing provider data, USD-only cost with confidence labels.
- Marketplace metadata (publisher id, icon, banner color, keywords) is
  packaging detail, not a durable contract - it stays in this packet.
- No planned behavior conflicts with any existing specification. No new
  specification topics anticipated from packaging work.

## Phases

1. Icon candidates (5 SVGs) + rendered `icon.png` for the recommended one.
2. `package.json` marketplace fields; `.vscodeignore` update.
3. `README.md` rewrite; `DEVELOPMENT.md`; `CHANGELOG.md`.
4. Package verification (`vsce ls` + `npm run package`).

## Exit Criteria

- VSIX builds cleanly and contains only runtime files, README, CHANGELOG,
  LICENSE, icon, config.
- Maintainer has a side-by-side icon comparison to pick from.
- Open questions answered in writing: which README/icon the marketplace shows,
  whether a separate repo is needed, where packaging output lands.
