# Changelog

## 1.0.1 — 2026-11-24
- New icon: the little owl redrawn as 56×56 pixel art (white V brows, throat collar, spotted crown and wings), with a hand-tuned 16 px version for the toolbar.
- New README hero and demo images, plus refreshed store images.

## 1.0.0 — 2026-11-22
- First release, named Glaux, with a pixel Little Owl icon (Athene noctua glaux).
- WebGL2 pipeline: Catmull-Rom upscale with anti-ringing, then RCAS-style contrast-adaptive sharpening with a compression guard.
- Native buttons in the YouTube control bar, and a frosted toggle centered at the top of any video. Same material as YouTube's controls: rgba(0,0,0,.3) with blur(16px).
- Draggable before/after split, controllable by keyboard.
- Frosted popup over a live, blurred snapshot of the page (can be switched to a solid background): sharpness and presets, auto-enhance, per-site toggle, max output (1080p/1440p/4K).
- Shortcuts: Alt+Shift+R (toggle) and Alt+Shift+C (compare).
- English and Brazilian Portuguese.
- Chromium and Firefox (140+) from one codebase. `pack.sh` builds a zip for each store.
