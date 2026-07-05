# Development

Developer notes for Agent Context Trail. The user-facing page is
[README.md](README.md); this file is excluded from the packaged VSIX.

## Build

```powershell
npm install
npm run build          # bundle src/extension.ts -> dist/extension.js
npm run watch          # rebuild on change
npm run typecheck      # tsc --noEmit
```

Fast dev loop (no packaging): open this folder in VS Code and press `F5`, or

```powershell
code --extensionDevelopmentPath . C:\path\to\any-workspace
```

## Package and install locally

```powershell
npm run package          # production bundle + agent-context-trail.vsix (repo root)
npm run install:local    # code --install-extension ... --force
npm run reinstall        # both of the above
```

Then run **Developer: Reload Window** in VS Code. To remove:

```powershell
code --uninstall-extension vectormind.agent-context-trail
```

`@vscode/vsce` is a devDependency, so `npm install` is enough.

## Publish to the Marketplace

One-time setup: create the `vectormind` publisher on
[marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage)
and a Personal Access Token (Azure DevOps, scope **Marketplace > Manage**).

```powershell
npx vsce login vectormind      # paste the PAT once
npm run package                # sanity-check the VSIX first
npx vsce publish               # publishes the version in package.json
```

Before each release: bump `version` in `package.json`, add a dated section to
`CHANGELOG.md`, and check the VSIX contents with `npx vsce ls`.

## Marketplace assets

- `icon.png` — the extension icon (`icon` field in `package.json`), rendered
  at 256x256 from `images/icon-variants/icon-i-bars-trend.svg`.
- `images/icon-variants/` — candidate icons kept for comparison; excluded
  from the VSIX.
- `images/screenshot.png` — the README hero image, bordered (see below). The
  README references it by absolute `raw.githubusercontent.com` URL, so it
  must be committed and pushed for the marketplace page to show it.
- `images/panel-screenshot.png` — the raw, unbordered source screenshot.
  Replace this file when the panel UI changes, then regenerate
  `screenshot.png` from it.

Regenerate the icon PNG from a variant:

```powershell
npx --yes sharp-cli -i images/icon-variants/icon-i-bars-trend.svg -o icon.png resize 256 256
```

Regenerate the bordered `screenshot.png` from `panel-screenshot.png` (adds
the same diagonal indigo→violet frame and rounded corners as the icon, in the
same style as the Markdown Site Preview reference screenshot). Requires
ImageMagick (`magick`):

```powershell
$src = "images/panel-screenshot.png"
$out = "images/screenshot.png"
$border = 5
$radius = 10
$size = magick identify -format "%w %h" $src
$w, $h = $size -split " "
$w2 = [int]$w + $border * 2
$h2 = [int]$h + $border * 2
$innerRadius = [Math]::Max(0, $radius - $border)

magick -size "${w2}x${h2}" -define gradient:angle=135 gradient:"#6366F1-#7C3AED" bg_grad.png
magick -size "${w2}x${h2}" xc:none -fill white -draw "roundrectangle 0,0,$($w2-1),$($h2-1),$radius,$radius" mask_outer.png
magick bg_grad.png mask_outer.png -alpha off -compose CopyOpacity -composite bg_rounded.png
magick -size "${w}x${h}" xc:none -fill white -draw "roundrectangle 0,0,$($w-1),$($h-1),$innerRadius,$innerRadius" mask_inner.png
magick $src mask_inner.png -alpha off -compose CopyOpacity -composite shot_rounded.png
magick bg_rounded.png shot_rounded.png -geometry "+${border}+${border}" -compose Over -composite $out
Remove-Item bg_grad.png, mask_outer.png, bg_rounded.png, mask_inner.png, shot_rounded.png
```

## Repository workflow

Spec-driven, dated plan packets — see [WORKFLOW.md](WORKFLOW.md). Durable
contracts live in `specification/`; time-bounded work in `plans/`. Cost rates
live in `config/tokens-cost.yaml` (shipped in the VSIX).
