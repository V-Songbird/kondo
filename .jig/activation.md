<!-- jig:owned — generated from jig's activation template. Edit this file and
jig reports it as drifted rather than overwriting your edit. -->

# Commit-time checks are running

**Nothing here is a task.** The checks run on this machine every time you
commit, and they run in CI too. This file says what is running and how to turn
it off again.

Git is pointed at the hook jig wrote:

```
core.hooksPath = .jig/hooks
```

Every commit runs `.jig/checks/run.mjs` first. A finding stops the commit and
prints what it found.

## What this cost you

`core.hooksPath` moves **every** hook, not just `pre-commit`. Anything that was
sitting in `.git/hooks` no longer runs.

It applies to your clone only. A teammate who wants the same thing asks
`/jig:jig` to wire the commit lane in theirs.

## Turning it off

```sh
git config --unset core.hooksPath
```

Or ask `/jig:jig` to revert, which puts the setting back exactly as it was
along with everything else jig wrote.

## One thing that can go wrong

A git hook does not read your shell's startup files. If node reaches your
terminal through fnm, nvm, volta, or asdf, the hook may not find node at all.

The hook jig wrote handles this: when it cannot find node, it lets the commit
through rather than blocking it, and CI still catches the problem. That is why
CI is the floor and this is the earlier catch, not the only one.

## Running the checks by hand

Any time, commit or no commit:

```sh
node .jig/checks/run.mjs
```

It exits 0 when it finds nothing and 1 when it finds something. It writes no
files and changes nothing.
