#!/bin/sh
# jig:owned — generated from jig's pre-commit shim template. Git does not read
# this file until it is told to: run `jig plan --wire-commit` to have jig
# propose that as an approved, reversible change, or set core.hooksPath at
# .jig/hooks yourself. jig writes no file inside .git/.
#
# If node is not on PATH in the hook's environment (fnm/nvm/volta), the check
# is skipped rather than blocking the commit — the CI workflow is the floor
# that runs regardless. That trade is deliberate and disclosed in
# .jig/activation.md.
command -v node >/dev/null 2>&1 || exit 0
node .jig/checks/run.mjs || exit 1
