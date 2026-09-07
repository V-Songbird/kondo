# Plan: Bundle third-party notices

Status: **done** — accepted by the owner; shipped with commit trailer `Foreman: 083`.

The six IBM Plex font faces referenced by `src/index.css` are bundled by Vite,
but their accompanying `src/assets/fonts/OFL.txt` has no packaging rule.

## Scope and decisions

- Add root `THIRD-PARTY-NOTICES.md` identifying IBM Plex Sans/Mono and Electron,
  grounded in the bundled OFL and installed Electron license text.
- Use `build.extraResources` in `package.json` to copy the original OFL bytes
  to `licenses/IBM-Plex/OFL.txt` and the notice to `THIRD-PARTY-NOTICES.md`,
  relative to the packaged resources directory on every target.
- Include Electron's full MIT notice in the attribution document so it remains
  available independently of platform-specific runtime license handling.
- Link the notice from README's License section, register it in the documentation
  map, and record the packaging change in the changelog and release procedure.
- Add a reusable artifact verifier that checks the actual packaged notice and
  OFL bytes against the source files. Run it against the Windows build.

## Seam changes and exclusions

None. Preserve font/license source bytes, target architectures, release smoke
gates, and the existing Vite configuration. No application/store behavior,
installer execution, publishing, tags, pushes, or merges are part of this task.
macOS and Linux artifact verification requires their respective build hosts.

## Acceptance checklist

Complete these five checks in order:

- [x] `npm test`: 432 passed across 36 files; five existing Windows file-symlink
  cases skipped with EPERM. Rerun after resolving fnm sandbox initialization.
- [x] `npm run typecheck`: strict TypeScript passes.
- [x] `npm run lint`: lint passes.
- [x] `npm run package`: Windows x64 NSIS build exited 0 with `--publish never`;
  packaged OFL and attribution match their source bytes; README link resolves
  and attribution matches the bundled font and installed Electron notices.
- [x] `git diff --check`: the full task-owned diff against baseline `5550216`
  passes, with architectures and smoke gates preserved. An unrelated concurrent
  `AGENTS.md` edit initially failed the repository-wide check; it was temporarily
  stashed for finalization and is preserved separately from this task.

## Observed verification

- `node scripts/verify-packaged-notices.mjs release/win-unpacked/resources`
  passed: OFL is 4,456 identical bytes; third-party notice is 2,033 identical
  bytes. OFL SHA-256 is
  `7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da`.
- An isolated temporary fixture confirmed the verifier accepts matching files
  and fails for corrupted OFL bytes and a missing third-party notice.
- Electron's full MIT block matches `node_modules/electron/dist/LICENSE`
  after newline normalization. IBM's copyright matches the original OFL.
- Comparison with baseline `5550216` confirmed that `extraResources` is the
  only package configuration change. Vite configuration, font license source,
  target architectures, and release workflow remain unchanged.
- The build produced `release/Kondo Setup 0.5.0.exe`; inspection used its
  `win-unpacked/resources` input tree. No installer was executed and no app
  was launched. macOS/Linux artifacts were not built or inspected.
- The owner accepted the implementation and authorized merging to `main` and
  deleting the working branch. Local checkpoints are consolidated into the
  accepted task commit, with the unrelated `AGENTS.md` edit kept outside it.

## Done when

Windows packaged resources contain the exact original OFL and third-party
notice, README links to the notice, checks pass, and other platform verification
limits are explicit. The owner has accepted the implementation and these limits.
