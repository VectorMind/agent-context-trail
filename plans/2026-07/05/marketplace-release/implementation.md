# Implementation - Marketplace Release Packaging

[######] Done - implemented and validated; all packaging assets in place.
Publish itself deliberately out of scope (needs the maintainer's Marketplace
publisher + PAT).

## Files Changed

- `package.json` - added `icon: "icon.png"`, `galleryBanner`
  (#1E1B4B dark, matching the reference family), `homepage`, `bugs`,
  `private: false`, keywords `ai` + `agent`.
- `README.md` - rewritten marketplace-facing: hero screenshot slot
  (`images/screenshot.png`, absolute raw.githubusercontent URL), features,
  provider depth table, getting started, privacy, cost-estimation section.
  Developer content moved out.
- `DEVELOPMENT.md` (new) - build/package/install-local instructions from the
  old README, plus publish steps (publisher + PAT + `vsce publish`) and
  marketplace-asset notes. Excluded from the VSIX.
- `CHANGELOG.md` (new) - 0.0.1 section; feeds the Marketplace Changelog tab.
- `icon.png` (new) - 256x256 render of candidate A.
- `images/icon-variants/icon-{a-window-bars,b-trail-nodes,c-bubble-spark,
  d-stacked-context,e-terminal-trail}.{svg,png}` (new) - five candidates in
  the astro-huge-doc design language (indigo->violet gradient, #181818 body,
  #22D3EE accent, transparent canvas). PNGs rendered with
  `npx sharp-cli ... resize 256 256`.
- `.vscodeignore` - added `DEVELOPMENT.md`, `images/**`, `icon*.svg`.

## Decisions

- **No repo split.** A single-extension repo at the root is the standard
  marketplace layout; `repository.directory` (used by astro-huge-doc) is only
  needed for monorepos. The marketplace README is the `README.md` next to
  `package.json` (repo root here); the icon is whatever the `icon` field
  points to inside the VSIX.
- Candidate A (window + rising token bars) rendered as the default `icon.png`
  so packaging works now; maintainer picks from the comparison artifact and
  can re-render any variant with the sharp-cli one-liner in DEVELOPMENT.md.
- README image uses an absolute raw URL (same pattern as the reference
  extension) so the marketplace page works regardless of vsce rewriting;
  requires `images/screenshot.png` committed and pushed.
- `config/tokens-cost.yaml` stays in the VSIX (runtime rate table).

## Round 2 - Free-Shape Icons (maintainer feedback)

Maintainer feedback on round 1: the window frame said "website" (right for
the reference extension, wrong here - this is a panel), and the product story
is charts/metrics, so B and D are the good directions; try variants without a
bounding badge/square. Added six free-shape candidates (SVG + 256px PNG each)
in `images/icon-variants/`: `icon-f-trail-free` (B unframed),
`icon-g-trail-dotted` (footsteps path), `icon-h-bars-free` (rising request
bars), `icon-i-bars-trend` (bars + cyan cost trendline), `icon-j-stacked-free`
(D unframed), `icon-k-step-trail` (staircase step-chart). Frameless marks use
the indigo->violet gradient and cyan as the ink itself (no white, no #181818
body) so they read on both light and dark marketplace backgrounds.
Maintainer picked **I (bars + cost trail)**; `icon.png` re-rendered from
`icon-i-bars-trend.svg` at 256x256 and the VSIX repackaged with it.

## Round 3 - Screenshot Border

Maintainer supplied `images/panel-screenshot.png` (raw panel capture, no
border). Added the same diagonal indigo→violet gradient frame and rounded
corners used by the reference extension's screenshot
(`astro-huge-doc/packages/vscode-extension/images/markdown-site-preview.png`):
sampled its border color (`#6366F1` top-left → `#7C3AED` bottom-right, 135°
diagonal, matching the icon gradient exactly), ~6px border and ~14px corner
radius at its 2160px width, scaled proportionally to a 5px border / 10px
corner radius for this repo's 1485x1111 screenshot. Built with ImageMagick
(gradient background + rounded-rect alpha masks for both the outer frame and
the inset screenshot); the recipe is now in `DEVELOPMENT.md` under
"Marketplace assets" so it can be regenerated whenever the panel UI changes.
Output saved as `images/screenshot.png` (the path the README already
references); `images/panel-screenshot.png` kept as the unbordered source.
Also removed a now-stale "add a screenshot" HTML comment from the README.

## Readiness Check (2026-07-05)

Full audit before first `vsce publish`:

- `npm run typecheck` - clean.
- `npm run package` - clean VSIX, 10 files, 51.6 KB; `vsce ls` contents match
  the intended set exactly (README, package.json, LICENSE, icon.png,
  CHANGELOG.md, dist/*.js, config/tokens-cost.yaml).
- GitHub repo `VectorMind/agent-context-trail` confirmed public and reachable
  (`api.github.com` returns `"private": false`), so the README's
  raw.githubusercontent.com screenshot/icon links will resolve once pushed.
- `npx vsce ls-publishers` - empty; `npx vsce verify-pat vectormind` - fails
  (no PAT configured). **Publisher login has not been done yet** - this is
  the one remaining blocker and it requires the maintainer's own Azure DevOps
  PAT, which nobody else can generate.
- Git working tree has this packet's changes plus unrelated in-flight edits
  from other packets (codex-parity, provider-and-cost spec, several `src/`
  files) still uncommitted - not touched here; committing/staging is the
  maintainer's call per repo convention.

## Follow-Ups

- Maintainer: `npx vsce login vectormind` (create the publisher + PAT first
  if not already done, see DEVELOPMENT.md), then `npx vsce publish`.
- Commit and push before publishing, so the pushed `main` matches what
  `vsce publish` packages, and so README/screenshot links resolve on GitHub.

## Specification Checkpoint (close)

Re-reviewed `specification/*.md` after the work: README claims were checked
against product-scope (observe-only, no aggregation above conversation),
surfaces-and-privacy (status bar figures, on-demand panel, local-first/no
telemetry), and provider-and-cost (provider depth table, confidence labels,
BYOT estimates, never-fabricate). No contract changes needed; no new durable
topics emerged - marketplace metadata remains packaging detail owned by this
packet. No candidate specification topics proposed.
