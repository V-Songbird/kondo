// Binds a release run to main's reviewed candidate (docs/release.md, "Tag
// provenance"). Run in the repository checkout; it reads GITHUB_EVENT_NAME,
// GITHUB_REF and GITHUB_SHA as GitHub Actions sets them.
//
// The candidate is the tip of origin/main, fetched now. On a tag push the tag,
// fetched from origin, must peel to the run's commit and that commit must be
// the candidate; anything else exits 1 naming both commits. A workflow_dispatch
// rehearsal reports the same comparison and exits 0. No ref already in the
// checkout is trusted, and a shallow checkout is deepened by the fetch.
import { execFileSync } from 'node:child_process'

const { GITHUB_EVENT_NAME: event, GITHUB_REF: ref = '', GITHUB_SHA: sha = '' } = process.env
const main = 'refs/remotes/origin/main'

class Unestablished extends Error {}

function git(...args) {
  try {
    return { status: 0, out: execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
  } catch (error) {
    if (typeof error.status !== 'number') throw error
    return { status: error.status, out: String(error.stderr).trim() }
  }
}

function fetch(source, destination) {
  const shallow = git('rev-parse', '--is-shallow-repository').out === 'true'
  const result = git('fetch', '--quiet', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin', `+${source}:${destination}`)
  if (result.status !== 0) throw new Unestablished(`could not fetch ${source} from origin (${result.out})`)
}

function commitOf(name) {
  const result = git('rev-parse', '--verify', '--quiet', `${name}^{commit}`)
  if (result.status !== 0) throw new Unestablished(`${name} does not resolve to a commit`)
  return result.out
}

// How `commit` stands against the candidate, worded to follow "commit <sha>".
function relation(commit, candidate) {
  if (commit === candidate) return "is origin/main's tip"
  const ancestor = git('merge-base', '--is-ancestor', commit, candidate)
  if (ancestor.status > 1) throw new Unestablished(`could not compare ${commit} with ${candidate} (${ancestor.out})`)
  return ancestor.status === 0 ? 'is on origin/main but is not its tip' : 'is not reachable from origin/main'
}

function verify() {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Unestablished(`GITHUB_SHA "${sha}" is not a full object name`)
  if (event === 'workflow_dispatch') {
    fetch('refs/heads/main', main)
    const commit = commitOf(sha)
    const candidate = commitOf(main)
    const standing = relation(commit, candidate)
    const verdict = commit === candidate ? 'pass' : 'be rejected'
    console.log(`Rehearsal commit ${commit} ${standing}, candidate commit ${candidate}: a tag on it would ${verdict}. Rehearsals never publish.`)
    return 0
  }
  if (event !== 'push') throw new Unestablished(`event "${event}" is neither push nor workflow_dispatch`)
  const tag = ref.slice('refs/tags/'.length)
  if (!ref.startsWith('refs/tags/v') || git('check-ref-format', ref).status !== 0) throw new Unestablished(`${ref} is not a v* tag`)
  fetch('refs/heads/main', main)
  fetch(ref, ref)
  const candidate = commitOf(main)
  const tagged = commitOf(ref)
  const run = commitOf(sha)
  if (tagged !== run) {
    console.error(`Release tag ${tag} rejected: origin's tag points at commit ${tagged}, not this run's commit ${run}; candidate commit ${candidate} is origin/main's tip.`)
    return 1
  }
  const standing = relation(tagged, candidate)
  if (tagged !== candidate) {
    console.error(`Release tag ${tag} rejected: tag commit ${tagged} ${standing}; candidate commit ${candidate} is origin/main's tip.`)
    return 1
  }
  console.log(`Release tag ${tag}: tag commit ${tagged} ${standing}, candidate commit ${candidate}. Provenance established.`)
  return 0
}

try {
  process.exitCode = verify()
} catch (error) {
  if (!(error instanceof Unestablished)) throw error
  console.error(`Release provenance cannot be established for ${ref || '(no ref)'} at run commit ${sha || '(none)'}: ${error.message}`)
  process.exitCode = 1
}
