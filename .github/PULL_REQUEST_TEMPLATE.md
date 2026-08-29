## What

<!-- One or two sentences: what changes for a user or contributor. -->

## Checklist

- [ ] Tests cover the change; `npm test`, `npm run typecheck`, `npm run lint` green.
- [ ] No disk I/O in `src/`; no free-form paths across the seam (ADR-0008).
- [ ] Privacy boundary intact (ADR-0002); no network.
- [ ] Seam changes follow CONTRIBUTING.md "Changing the seam".
- [ ] UI changes keyboard-reachable; color never the only signal.
- [ ] Docs updated per docs/README.md routing (ADR / domain.md / foundations / plan).
- [ ] CHANGELOG entry if user-visible.
