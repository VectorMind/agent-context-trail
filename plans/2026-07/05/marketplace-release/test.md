# Test Proof - Marketplace Release Packaging

## Commands Run

- `npx vsce ls --no-dependencies` - expected: only runtime + marketplace
  files. Actual: `README.md`, `package.json`, `LICENSE`, `icon.png`,
  `CHANGELOG.md`, `dist/webview.js`, `dist/extension.js`,
  `config/tokens-cost.yaml`. No plans/, specification/, src/, images/,
  DEVELOPMENT.md, WORKFLOW.md, AGENTS.md. Pass.
- `npm run package` (esbuild production + `vsce package --no-dependencies`) -
  expected: clean VSIX. Actual: `DONE Packaged: agent-context-trail.vsix
  (10 files, 51.9 KB)`; icon.png 5.83 KB included. Pass.
- `npx sharp-cli -i images/icon-variants/*.svg -o *.png resize 256 256` -
  all five variants + root `icon.png` rendered; visually inspected each PNG
  (window-bars, trail-nodes, bubble-spark, stacked-context, terminal-trail
  all render as designed, transparent background). Pass.

## Documents Reviewed

- README claims cross-checked against `specification/product-scope.md`,
  `surfaces-and-privacy.md`, `provider-and-cost.md` (see implementation.md
  checkpoint).
- Reference extension reviewed for parity:
  `astro-huge-doc/packages/vscode-extension` package.json, README,
  CHANGELOG, .vscodeignore, icon.svg.

## Known Gaps

- `images/screenshot.png` does not exist yet; the marketplace hero image will
  404 until the maintainer commits and pushes it.
- `vsce publish` not run (out of scope); publisher `vectormind` not yet
  verified to exist on the marketplace.
- VSIX not re-installed into VS Code in this packet (packaging only; the
  bundle is the same `npm run build` output as the dev loop).

## Environment

- Windows 11, npm/npx with `sharp-cli` 5.2.0 via `npx --yes`;
  `@vscode/vsce` from devDependencies.
