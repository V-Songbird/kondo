# kondo

Read [AGENTS.md](AGENTS.md) — it is the operating manual for this repo and
applies to you in full. Start any store-adapter work from
[docs/domain.md](docs/domain.md).

Quick commands: `npm run dev` · `npm run guards` · `npm test` · `npm run typecheck` · `npm run lint`.

Open work is listed under "Now" in [ROADMAP.md](ROADMAP.md), and every plan's
status is in [docs/plans/README.md](docs/plans/README.md). Maintainers who use
Foreman also keep a local `ROADMAP.jsonl` queue that clones do not receive
([ADR-0013](docs/adr/0013-keep-working-records-local.md)).

One warning worth repeating: this app reads and mutates real `~/.claude` data
(moves, trash and Undo; settings writes stay refused). Never point mutating
code at a real store while developing — build fixture trees with the helpers
in `test/helpers.ts`.
