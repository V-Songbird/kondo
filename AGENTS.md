### Task Execution & Autonomy

- For implementation or fix requests, carry the authorized work through implementation and relevant verification. Do not stop at a proposed plan when you can proceed.
- Make reasonable assumptions for routine, reversible decisions. Ask a focused question when missing information materially affects correctness, scope, or authorization.
- Continue with authorized read-only actions, local worktrees, branch edits, and appropriate tests without repeatedly asking.
- Before requesting approval, finish the preparation that is already authorized and present a concrete, reviewable result.
- Respect required approval gates. Ask before destructive, irreversible, or otherwise unauthorized actions.
- Avoid boilerplate warnings about hypothetical risks. Explain concrete blockers or material risks when relevant.

### Instruction Conflicts

- Explicit user instructions take precedence over conflicting skill guidelines, subject to higher-priority instructions and actual permission boundaries.
- If a skill causes a pause or deviation, identify the file and relevant rule, and explain whether it is an explicit requirement or your interpretation. Continue any unaffected authorized work.

### Style & Output

- Lead with the result. Use plain language, active voice, and concise paragraphs. Include technical details that help assess the work.
- Use lists when they improve readability; avoid repetitive transitions and stock phrases such as "it's worth noting", "delve", "leverage", and "Bottom line".
- Report what changed, what was verified, and any remaining uncertainty.

### Verification

- Match verification to the scope and impact of the change. Complete required checks; expand testing when a concrete unresolved concern justifies it.

# Operating manual

For every engineer working in this repo, human or AI agent. Short on purpose;
each rule links to the document that carries the detail.

## Read first

1. [docs/README.md](docs/README.md) — the documentation map and routing rule.
2. [docs/domain.md](docs/domain.md) — before touching any store adapter.
3. [docs/foundations.md](docs/foundations.md) — before moving code across the
   process seam.
4. [docs/adr/README.md](docs/adr/README.md) — the decision index; read the
   ADRs a change touches before structural work.
5. [docs/status.md](docs/status.md) — where work stands, before picking any up.

## Hard rules

- **Never run mutating code against real stores during development.** Point
  everything at fixtures (the `test/helpers.ts` builders make temp-dir
  trees). The locator accepts injected roots for exactly this. Reading your own real store from the
  running app is fine; tests may not even do that
  ([docs/testing.md](docs/testing.md)).
- **The renderer never touches disk.** All I/O lives in `electron/main`
  behind the typed bridge. Adding `fs` anywhere under `src/` is a bug.
- **Respect the privacy boundary.** No code path opens project files outside
  `.claude` directories, except the named `<project>/.mcp.json` (ADR-0002).
  No network calls anywhere (SECURITY.md).
- **Settings writes stay refused.** Every plan with a `write` or `splice`
  step, and every historical Undo containing one, refuses before effects on
  every platform (098, ADR-0010). Do not add a bypass; re-enabling needs
  native concurrency and recovery evidence.
- **Docs move with code.** Learned a store fact → update domain.md (with a
  ✅/◇ marker). Made a lasting decision → add an ADR. Planned a feature →
  plan file first; shipped it → fold what stays true into lasting docs and
  delete the plan. A PR that leaves a doc wrong is incomplete. Two
  paired-change guards read the staged index (`npm run guards`, or the
  opt-in pre-commit hook): a `shared/contract.ts` change needs a `docs/adr/`
  edit, and an `electron/main/workspace/` change needs a `docs/domain.md` edit
  ([docs/testing.md](docs/testing.md#the-guards)).
- **Adapters degrade, never die.** Unknown files, malformed JSON, unreadable
  entries produce itemized errors alongside partial data (ADR-0005).

## Workflow

- `npm run dev` to run; `npm run guards`, `npm test`, `npm run typecheck` and
  `npm run lint` before calling anything done. All four must pass.
- Check UI changes in the built app against a synthetic fixture with
  `.claude/skills/run-kondo/`, and read [DESIGN.md](DESIGN.md) before changing
  the look.
- TypeScript is strict everywhere. No `any` at the seam.
- Conventions, review bar, and PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md).
