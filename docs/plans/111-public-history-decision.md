# Decision package: Public Git history

Status: **decision package ready — owner choice and publication acceptance pending**

Recommend a **separate public repository with a new root commit**, prepared from
the final reviewed source tree. Keep the existing repository and its complete
history private. This retains the shared contributor setup while avoiding the
private records and metadata in the source ancestry. Public blame and bisect
would begin at the new root; the owner must accept that tradeoff.

The current tree is **not yet an approved publication surface**: two locations
below retain personal project context. This package proposes the choice and its
conditions; it does not create a public root, sanitize history, tag, push, change
visibility, or accept task 111. The coordinating session obtains the owner's
choice and maintains the local roadmap. [ADR-0013](../adr/0013-keep-working-records-local.md)
remains the accepted policy for local working records.

## Scope and baseline

The audit is pinned to the following objects, not to a moving branch name.

| Surface | Observed scope |
|---|---|
| Preliminary source commit | `6da90dab507d0630dad9f58ef420c20942d8016d` |
| Source tree | `ac0c690ec2d73868e6d23b35405606cc123117f1` |
| Source ancestry | 220 commits; 2,598 reachable objects |
| Source files | 212 distinct blobs, all mode `100644`; no symlinks or gitlinks |
| Local ref census, 2026-09-08 09:15:14 UTC | 51 refs: 9 local branches, 7 cached remote refs, 35 Codex refs; 38 distinct root OIDs |
| Frozen census object closure | 227 commits, 1,090 trees, 1,331 blobs; no annotated-tag objects |
| Cached `origin/main` | `ea9929710f16fbeedf769c7c2888ae72ded3ed23`, with 202 commits in its ancestry |

The [baseline manifest](111-public-history-baseline.manifest) lists every source
path, mode and blob OID. Its SHA-256 over UTF-8 with LF line endings is
`2815fb66c7350a77db54fcca6bd421f279ba881ce7cae8a65fe829cb04dbacbb`.
It inventories the preliminary tree, including the two unresolved files; it is
not an allowlist approving their present contents. This decision package itself
is a later documentation change and is not part of that 212-file tree.

The [evidence record](111-public-history-evidence.json) freezes the root OIDs,
counts, detector definitions, redacted locations and binary exclusions. Twenty-seven
roots are direct trees from local tooling. Three blob versions occur only under
those trees, including one additional local roadmap version; all were included
in the content scan. Traversing commit history alone would miss them.

No fetch or external service was used. Cached remote refs do not establish
current server state. Local main still named the source commit at the resumed
review. Five transient Codex refs differed from the frozen census after the
pause; the original local-branch and cached-remote OIDs still matched, and all
frozen root objects remained readable. This task did not alter those transient
refs. The task branch is the only branch advanced for its documentation commit.

## Private-record evidence

Enumerating commit trees and the direct tree roots finds 26 distinct historical
paths across the six families below. None of these families has a path in the
preliminary source tree. Counts are per family; a commit can occur in several
rows. Blob counts include direct-tree-only versions.

| Family | Historical paths | Distinct blobs | Source-ancestor commits containing the family |
|---|---:|---:|---:|
| `.claude/memory/` | 10 | 14 | 57 |
| `.claude/rules/jetbrains-mcp.md` | 1 | 3 | 163 |
| `.idea/` | 4 | 4 | 168 |
| `.foreman/` | 2 | 53 | 176 |
| `ROADMAP.jsonl` and backup family | 1 | 122 | 176 |
| Local Jig planning/runtime records | 8 | 16 | 174 |

All six also occur in the cached remote's ancestry. Representative commits and
blob identifiers appear in the evidence record without copying working-record
contents or private filenames beyond the policy's named locations. This confirms
the limit documented by [plan 082](082-private-local-publication.md): ignoring and
untracking files protects later trees, not the ancestors transmitted with them.

Removing whole `.claude/` or `.jig/` directories would also remove required shared
tooling. A filtered-history option must use the specific local-record families,
check renamed/copied contents, and review surviving files and commit metadata.
The existing source repository, queue, backups and local evidence remain intact.

## Current content and metadata requiring a choice

Locations and line numbers here refer to the pinned source objects. No private
values are reproduced.

| ID | Evidence | Classification and proposed treatment |
|---|---|---|
| P1 | `docs/domain.md:390–393`, blob `5af449ded9fdedc5864070d103430b5241874a76` | A personal corpus observation names a real local project path at line 392. Generalize the explanation and remove the personal example/observation details before publication unless the owner explicitly approves them. Preserve the domain rule about memory-only projects. |
| P2 | `test/library-catalog.test.ts:99`, blob `fa4f2b5a7d94c563490e1fa7be329ac36e8e3f7e` | A synthetic fixture reuses a known private repository identifier. Substitute a neutral fixture identifier while preserving the test behavior. It is contextual disclosure, not a credential. |
| P3 | Commit objects `9dbf903c3f5e683e8029ea3cc5955ff07749aca3` (lines 6, 8), `fea91472655b4da1bcc9daa6832fe170517ec069` (14, 21), `2e47f0d37fdb81e31b67aca2e721bd0c258cd30e` (11) | Three source ancestors mention the private repository in their messages. A path-only history filter cannot remove this context. A new public root would not inherit these messages; a filtered history must review and generalize them. Lines count from `git cat-file commit` output. |
| P4 | Author/committer headers in the frozen 227 commits | Three distinct identity names and three email addresses occur. These historical addresses differ from the approved security contact. The owner chooses the public commit identity and, if retaining history, which attribution metadata to publish or normalize. Retain required licensing and attribution. |

The private marker in P2/P3 appears at 1,310 locations across distinct scanned
blobs and commit objects, mostly in excluded working records; five locations
are in the three messages above. A locally derived marker from P1 appears at
81 locations in historical text blobs. These are literal-match counts, not
counts of secrets or distinct incidents. The private search terms are omitted
from shared artifacts; their source locations allow an authorized reviewer to
derive them locally.

The path examples in `docs/domain.md:333–334` and `docs/glossary.md:60` are
synthetic, as are the remaining reviewed current path matches in tests, code
comments and fixture instructions. They are not additional personal-path
findings. The retained `.gitattributes` reference to ignored memory is a merge
rule, not memory content.

## Secret review and its limits

The local scan read all 1,324 non-NUL text blobs in the frozen closure, plus
commit metadata/messages. It matched known private-key headers; GitHub, provider,
AWS, npm, GitLab, SendGrid and Stripe token shapes; JWT shapes; credential-bearing
URLs; long Bearer values; and a broad quoted credential-assignment pattern.
The exact expressions are in the evidence record.

- Known credential-format rules returned **zero matches**, including the extended
  token/Bearer rule. No credential was tested, and no credential exposure was
  established by this audit.
- The broad assignment rule returned 76 occurrences across blob versions,
  representing seven distinct matched strings. Review traced them to two
  dependency-version declarations and five fixture patterns: transient listener
  tokens, invented protected-file/API-key values, preservation fixtures and an
  invalid review-token case. Eleven occurrences remain in the preliminary tree.
- Path/email rules are privacy-review aids: 512 path matches and 28 email matches
  across text blob versions, versus 30 and 7 in the preliminary tree. Commit
  objects contain another 590 email-shaped matches including message attribution;
  that number is not a distinct-identity count. Current document email matches
  are the approved security contact; the lockfile match is dependency metadata.
- No credential/archive/database filename matched the recorded filename rule.
  Seven binary blobs (one PNG icon and six WOFF2 fonts, 140,426 bytes total) were
  inventoried but excluded from text analysis. Embedded metadata, compressed
  content, steganography and unfamiliar encodings were not analyzed.

A regex match is a candidate, not proof of a real secret; zero matches do not
certify universal absence. This was a bounded local review, not a provider-backed
secret audit or an exhaustive line-by-line review of every historical record.
It excludes reflog-only/unreachable objects, external object stores, Git LFS
payloads, current server-only/hidden refs, issues, PRs, Actions logs/artifacts,
release assets and caches. No live Claude store or external credentials were
read. If later review establishes a real credential, stop publication and have
its owner decide revocation/rotation and exposure response; deleting history
alone would not invalidate it. There is no identified credential to rotate here.

## Alternatives and recommendation

| Choice | What a public clone receives | Consequences |
|---|---|---|
| **A — New root in a separate public repository (recommended)** | Only the final reviewed tree, with a reviewed initial message and identity; later public history grows normally | Preserves the private source without rewriting it. Smallest initial history to audit; setup does not require old commits. Earlier public blame/bisect is unavailable. Keep a private source-SHA → public-SHA/tree mapping and explicit process for later exports. Never merge private ancestry into the public line. |
| **B — Sanitized history in a separate, isolated copy** | The explicitly selected, fully reviewed branch/tag closure after removing local-record families and generalizing surviving private content/metadata | Retains more public evolution and attribution. Much larger review surface: renamed/copied contents, messages, identities and every selected ref. Commit IDs change; historical signatures would need treatment if present. Historical links and old commits may become unusable. Verify the final tree against the same approved manifest. |
| **C — Keep everything private for now** | No new public source | Preserves current operation while the owner postpones the history/identity decision. Does not satisfy the publication objective. |

Publishing the existing repository's ancestry unchanged is not a viable fourth
choice under ADR-0013. A shallow clone, squash commit with an existing parent,
or deleting the files at the tip is not evidence of a clean public object
closure. Making the existing remote public would also expose server surfaces
this local scan did not inspect.

A wins because no inspected build or test command depends on ancestral commits,
while B must remove both private file history and private prose. For either
route, the public destination is separately chosen: do not rename, replace or
change visibility of the private source implicitly. If its repository name
differs, review repository links and package metadata before freezing the final
candidate; preserve the approved reporting contact and maintenance policy.

## Shared setup that must survive

Preserve source, tests, build configuration, `.nvmrc`, `package.json`,
`package-lock.json`, workflows, assets, licenses and contributor documents. The
lockfile has 568 entries including its root: 561 resolve through the npm public
registry and six bundled entries omit individual resolution/integrity fields.
No linked, local-path or Git-resolved dependency was found. This is evidence of
declared portability, not a claim of bit-identical installers or offline setup
from an empty machine.

Retain all 19 shared Claude/Jig files in the manifest. In particular,
`test/e2e/smoke.mjs` imports `.claude/skills/run-kondo/cdp.mjs` and launches
`fixture.mjs`; `npm run guards` and CI call `.jig/checks/run.mjs`. The repository
check runner uses Node's standard library and does not need Foreman or Jig
installed. Foreman remains optional and its private queue is not cloned.

Cloning the files does not establish every optional hook's activation:

- `.jig/hooks/session-guards.cjs` looks for an external installed plugin runner
  and skips if absent. Shared settings dispatch `PostToolUse`, whereas four
  configured guards declare `PreToolUse`. Actual interception was not proved.
- `.jig/hooks/pre-commit` is mode `100644`; Unix execution after opting into
  `core.hooksPath` is unverified. The activation document describes a configured
  local clone, not a guarantee for every new clone. Follow CONTRIBUTING.md and
  run the checks explicitly.

These setup findings were returned to the coordinator for deduplication, as was
the fixture-run guide's broad Electron process-by-name shutdown instruction.
They were not executed or repaired in this decision task. No Electron instance
was launched for this package.

## Owner decision and future acceptance conditions

The concrete proposal is **A**, with P1/P2 generalized and an explicitly chosen
public identity/destination. The owner can instead choose B or defer with C.
Choosing a strategy is distinct from accepting a final public candidate.

After an explicit owner choice authorizes preparation:

1. Preserve the source repository, its refs and local records. Prepare the chosen
   result in a separate destination with no shared Git object store or alternates.
   For A, export the reviewed tree, not the working directory or its `.git`; do
   not create an orphan branch in the source repository. For B, operate only on
   an isolated copy and retain a private old/new mapping.
2. Resolve P1/P2 and the public metadata decision. Retain shared tooling and
   license notices. Freeze the resulting source SHA and manifest; this baseline
   manifest must be replaced by a newly reviewed candidate manifest.
3. Verify the candidate's paths, modes and blobs against that approved manifest,
   account for every deliberate difference, and scan the full closure of the
   exact refs proposed for publication. For A, verify one initial root with no
   source ancestors. Do not transfer private backup, remote-tracking, tool,
   notes or replace refs. Do not use a mirror/all-ref push as an export shortcut.
4. Review the public commit message/identity and the target's current server
   surfaces. Re-run local setup checks and the hosted Windows/macOS/Linux
   `verify` and `smoke` checks on the exact candidate SHA. Old hosted runs cannot
   validate a new root or rewritten commit.
5. Task 114's final publication review must repeat the privacy/secret audit on
   that SHA, including any later documentation, binaries and target changes.
   Record the SHA, manifest, selected refs and run links before owner acceptance.
   Apply [release gates](../release.md) separately, including installer rehearsal.

No destination, new root or rewritten SHA exists from this task. No archive,
rewrite, remote operation, permission change or publication command was run.
The security contact and latest-stable-only policy accepted in task 112 remain
unchanged. The owner still decides the strategy, metadata and final acceptance.

## Reproduce the bounded scan without exposing values

Run the following JavaScript with Node from the source repository root (for
example, save it outside the repository and run `node <file>.mjs`). It uses only
Git reads and the checked-in evidence. It requires the frozen source objects;
a future clean public repository intentionally will not contain those ancestors.
No lazy fetch is allowed. It verifies the manifest and prints only aggregate
counts; a missing object is an error, not an empty successful scan.

```js
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

const evidence = JSON.parse(readFileSync('docs/plans/111-public-history-evidence.json'))
const git = (args, input) => execFileSync('git', ['--no-replace-objects', ...args], {
  input: input === undefined ? undefined : Buffer.from(input),
  maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }
})
const manifest = readFileSync('docs/plans/111-public-history-baseline.manifest', 'utf8')
  .replace(/\r\n/g, '\n')
assert.equal(git(['ls-tree', '-r', evidence.sourceCommit]).toString(), manifest)
assert.equal(createHash('sha256').update(manifest).digest('hex'), evidence.manifestSha256)
const ids = git(['rev-list', '--objects', '--no-object-names', '--stdin'],
  evidence.frozenRootOids.join('\n') + '\n')
const data = git(['cat-file', '--batch'], ids)
const types = {}, matches = { blob: {}, commit: {}, tag: {} }
let binary = 0, cursor = 0
while (cursor < data.length) {
  const end = data.indexOf(10, cursor)
  const [oid, type, sizeText] = data.subarray(cursor, end).toString().split(' ')
  const size = Number(sizeText)
  assert(Number.isFinite(size), `Unreadable object ${oid}`)
  cursor = end + 1
  const body = data.subarray(cursor, cursor + size)
  cursor += size + 1
  types[type] = (types[type] || 0) + 1
  if (!(type in matches)) continue
  if (body.includes(0)) { if (type === 'blob') binary++; continue }
  for (const rule of evidence.textDetectors) {
    const count = [...body.toString('utf8').matchAll(new RegExp(rule.source, rule.flags))].length
    if (count) matches[type][rule.category] = (matches[type][rule.category] || 0) + count
  }
}
assert.deepEqual(types, evidence.objectCounts)
assert.equal(binary, evidence.binaryExclusions.length)
console.log(JSON.stringify({ manifest: 'matches', types, binary, matches }, null, 2))
```

For path-family counts, enumerate each frozen commit with `git ls-tree -r -z`
and each direct tree root the same way, then apply `privatePathDetectors` from
the evidence record. Deduplicate paths and blob OIDs within each family; count
commit presence once per family. The private-marker follow-up is separate from
the generic scan above and requires locally deriving the withheld terms from
P1/P2. Do not copy matched source text or those terms into reports.

## Observed verification

Local checks were repeated on 2026-09-09 (local date; 2026-09-10 UTC) using Node
22.22.2 and the unchanged source baseline plus this documentation work:

- `npm test -- --maxWorkers=2 --minWorkers=2`: 41 files passed, 676 tests passed,
  14 existing fixture-symlink cases skipped because Windows returned `EPERM`.
  These skipped cases do not establish symlink behavior on this machine.
- `npm run typecheck`, `npm run lint`, `npm run guards`: passed. The two staged
  pairing guards had no applicable changes before staging.
- `node .jig/checks/run.mjs --selftest`: all six checks caught their fixtures.
- The earlier `npm ci --offline --ignore-scripts --no-audit --no-fund` succeeded
  using an existing package cache. Dependency lifecycle scripts, a clean-machine
  install, Electron UI, packaging and hosted checks were not exercised here.
- Running the reproduction snippet matched the 212-file manifest and SHA-256,
  all object counts, seven binary exclusions and every reported generic regex
  count. No known-format credential rule matched.
- The three new artifacts passed relative-link, source-location/OID and known
  private-marker checks. Neither withheld project marker nor the personal path
  was copied into them. `git diff --check` passed.

The final changed-file and commit evidence is recorded in the task handoff.
None of these local results accepts a release or the public-history choice.
