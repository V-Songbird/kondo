# JetBrains MCP tools

<!-- assay-ignore-start -->
WebStorm has this project open and serves it over its MCP server as `mcp__webstorm__*` tools:
reads reflect unsaved editor buffers, searches skip `node_modules` and `.next`, and
`get_file_problems` returns live TypeScript inspection results without a `tsc` cold start. The
`jetbrains-router` plugin's `PreToolUse` hook denies a native call it should have caught, so
reaching for `Read` or `Grep` first only costs a round-trip. Full tool map with parameter names:
`jetbrains-router/skills/router/references/tool-map.md` in the `slag` repo.
<!-- assay-ignore-end -->

- Before the first file operation, call `mcp__webstorm__get_project_modules` with `projectPath=D:/Projects/Personal/SoftwareDevelopment/kondo` — if it reports no open project, use native tools for the rest of the session.
- When reading, searching, or editing a `.ts` or `.tsx` file here, use `mcp__webstorm__read_file`, `search_regex`, `search_file`, or `replace_text_in_file` instead of native `Read`, `Grep`, `Glob`, or `Edit`.
- When the path is markdown, JSON, JSONL, a dotfile, or under `docs/`, use native `Read` and `Grep` instead of `mcp__webstorm__*` — that covers every knot file in `src/content/knots/`.
- Always pass `replaceAll=false` to `mcp__webstorm__replace_text_in_file` — it defaults to `true` and rewrites every match in the file.
- To check one file for type errors, call `mcp__webstorm__get_file_problems` — e.g. `get_file_problems(filePath="src/lib/rope/sim.ts")` — instead of running `npm run typecheck`.
