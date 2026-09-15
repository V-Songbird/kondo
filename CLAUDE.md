# kondo

Read [AGENTS.md](AGENTS.md) — it is the operating manual for this repo and
applies to you in full. Start any store-adapter work from
[docs/domain.md](docs/domain.md).

Quick commands: `npm run dev` · `npm run guards` · `npm test` · `npm run typecheck` · `npm run lint`.

One warning worth repeating: this app reads and will eventually mutate real
`~/.claude` data. Never point mutating code at a real store while developing —
build fixture trees with the helpers in `test/helpers.ts`.
