# JetBrains MCP tools

<!-- assay-ignore-start -->
WebStorm has this project open and serves it over its MCP server as `mcp__webstorm__*` tools:
reads reflect unsaved editor buffers, searches skip `node_modules` and `out`, and
`get_file_problems` returns live TypeScript inspection results without a `tsc` cold start. The
`jetbrains-router` plugin's `PreToolUse` hook denies a native call it should have caught, so
reaching for `Read` or `Grep` first only costs a round-trip. Full tool map with parameter names:
`jetbrains-router/skills/router/references/tool-map.md` in the `slag` repo. Verified against WebStorm 2026.2 (build WS-262), whose MCP server has no `replace_text_in_file`.
<!-- assay-ignore-end -->

- Before the first file operation, call `mcp__webstorm__get_project_modules` — it takes no arguments. If it errors or reports no open project, use native tools for the rest of the session.
- When reading or searching a `.ts` or `.tsx` file here, use `mcp__webstorm__read_file`, `search_regex`, or `search_file` instead of native `Read`, `Grep`, or `Glob`.
- When the path is markdown, JSON, JSONL, a dotfile, or under `docs/`, use native `Read` and `Grep` instead of `mcp__webstorm__*`.
- To edit a `.ts` or `.tsx` file here, use `mcp__webstorm__apply_patch` with `input=` a unified git diff instead of native `Edit`; to create one, use `create_new_file` with `pathInProject=` and `text=` instead of native `Write`.
- To check one file for type errors, call `mcp__webstorm__get_file_problems` — e.g. `get_file_problems(filePath="shared/contract.ts")` — instead of running `npm run typecheck`.
