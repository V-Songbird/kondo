---
name: kondo-fixture-run-recipe
description: "How to launch and drive kondo safely against a fixture store, with no real ~/.claude at risk"
metadata: 
  node_type: memory
  type: project
  originSessionId: db259e54-6826-406d-9b54-639c85a0e482
  modified: 2026-08-29T10:20:46.852Z
---

Kondo can be run and driven end to end without touching a real store, so a
UI change is always checkable — see [[verify-ui-yourself]].

`createLocator` in `electron/main/workspace/locator.ts` reads three env
overrides: `KONDO_STORE_ROOT`, `KONDO_DESKTOP_STORE_ROOT` and
`KONDO_DATA_ROOT`. Set all three at a synthetic tree, `npm run build`, then
`./node_modules/.bin/electron . --remote-debugging-port=9222`.

Drive it over CDP with no new dependency: Node 22 ships a global
`WebSocket`, so `Runtime.evaluate` and `Page.captureScreenshot` need no
Playwright. Fetch the target from `http://127.0.0.1:9222/json/list`.

Two fixture gotchas, both learned on 2026-08-29: a project only becomes a
move destination if its path round-trips Claude Code's flattening, so use a
path with no hyphens; and it needs both a transcript directory under
`projects/` and a real `.claude` directory to verify.
