#!/usr/bin/env node
"use strict";

// The repo-local half of jig's session guards.
//
// jig ships its own hooks.json wiring PostToolUse[Edit|Write] to the same
// runner, but that only fires for someone who has the plugin installed and
// enabled. `.claude/settings.json` points here instead, so a clone of kondo
// gets the guards from the repository rather than from a personal machine's
// plugin list. Where both are wired the guards simply run twice; that inflates
// the `fired` count /jig:review reports and changes no decision, since the only
// latch jig reads off the ledger is a standing false positive.
//
// The runner itself is never written down. `${CLAUDE_PLUGIN_ROOT}` is
// substituted only for plugin-owned hooks, and the runner's installed home is a
// version-pinned cache directory that moves on every plugin upgrade — so it is
// resolved at call time, newest version wins, and a machine with no jig at all
// gets a silent exit rather than a broken session.
//
// .cjs, not .js: kondo's package.json sets "type": "module", and the runner it
// loads is CommonJS.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PLUGINS_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"), "plugins");

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

function newer(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

// A marketplace checkout is a git working tree updated in place, so it carries
// no version in its path and is preferred. The cache is the fallback for a
// machine holding the installed copy but not the checkout; there the version is
// read off the directory listing, never off a string committed to this file.
function findRunner() {
  const marketplaces = path.join(PLUGINS_DIR, "marketplaces");
  for (const name of subdirs(marketplaces)) {
    const file = path.join(marketplaces, name, "jig", "hooks", "runner.js");
    if (fs.existsSync(file)) return file;
  }
  const cache = path.join(PLUGINS_DIR, "cache");
  let best = null;
  for (const name of subdirs(cache)) {
    const versions = path.join(cache, name, "jig");
    for (const v of subdirs(versions)) {
      const file = path.join(versions, v, "hooks", "runner.js");
      if (fs.existsSync(file) && (!best || newer(v, best.version))) best = { version: v, file };
    }
  }
  return best ? best.file : null;
}

try {
  const runner = findRunner();
  // Required rather than spawned: runner.js guards on `require.main` and exports
  // main, so the guards run in this process, reading this process's stdin and
  // writing the host's verdict to this process's stdout.
  if (runner) require(runner).main([process.argv[2] || "PostToolUse"]);
} catch (err) {
  // Same contract as the runner's own: a guard shim must never take the tool
  // call with it.
  process.stderr.write("jig: session-guards shim failed open (" + err.message + ")\n");
}
process.exitCode = 0;
