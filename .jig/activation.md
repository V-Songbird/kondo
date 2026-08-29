<!-- jig:owned — generated from jig's activation template. Edit this file and
jig reports it as drifted rather than overwriting your edit. -->

# Catching mistakes at commit time

Your checks already run in CI, and CI stops a bad change before it merges.
Nothing below is needed to stay covered.

What is missing is the *earlier* catch: the same checks running on your own
machine the moment you commit, so a mistake never travels as far as a pull
request. That is the whole difference. It is convenience, not safety.

Git can run a script before every commit. jig wrote one for you at
`.jig/hooks/pre-commit`, but git will not use it until it is told to — and
telling it is the one step jig leaves to you, because that switch lives inside
`.git/`, which jig never touches.

## The short way

Let jig propose it as a normal, reviewable change:

```sh
jig plan --wire-commit
```

You approve it by name like anything else, and `jig revert` puts the setting
back exactly as it was.

## The manual way

One command, run once in this repository:

```sh
git config core.hooksPath .jig/hooks
```

This tells git to look in `.jig/hooks` instead of its usual place. Two things
worth knowing before you run it:

- It moves **every** hook, not just `pre-commit`. If you already have scripts
  in `.git/hooks`, they stop running.
- It applies to your clone only. A teammate who wants the same thing runs the
  same command.

To undo it: `git config --unset core.hooksPath`.

## If you already have a pre-commit hook

Don't repoint git — that would switch your own hook off. Add jig's line to the
hook you already have instead.

**If it is a shell script:**

```sh
node .jig/checks/run.mjs || exit 1
```

**If it is a node script (`#!/usr/bin/env node`):**

```js
require("child_process").execFileSync(process.execPath, [".jig/checks/run.mjs"], { stdio: "inherit" });
```

**If you use husky**, the same shell line goes in `.husky/pre-commit`.

## One thing that can go wrong

A git hook does not read your shell's startup files. If node reaches your
terminal through fnm, nvm, volta, or asdf, the hook may not find node at all.

The hook jig wrote handles this: when it cannot find node, it lets the commit
through rather than blocking it, and CI still catches the problem. A hook you
write yourself should do the same, or give node an absolute path.

## Trying it first

You can run the checks by hand any time, wired or not:

```sh
node .jig/checks/run.mjs
```

It exits 0 when it finds nothing and 1 when it finds something. It writes no
files and changes nothing.
