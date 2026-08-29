#!/usr/bin/env node
// jig:owned — generated from jig's check-driver template. Edit this file and
// jig reports it as drifted rather than overwriting your edit.
//
// Nothing here knows what jig is. No imports outside node's own standard
// library, no config to find, no plugin to install: any teammate, any CI, any
// machine with node can run this file. That is the whole point of it — it is
// the floor that keeps working after the agent host is gone.
//
//   node .jig/checks/run.mjs                 walk the project and check it
//   node .jig/checks/run.mjs <path> [...]    check exactly these paths
//   node .jig/checks/run.mjs --selftest      seed one violation per check and
//                                            prove each check catches its own
//   node .jig/checks/run.mjs --json          machine-readable report
//
// Exit code is 1 when anything was found and 0 when nothing was. A selftest
// exits 1 when a check failed to catch its own seeded violation.
//
// A check declares one of two detector kinds. A pattern detector is a regular
// expression over the files a glob names. A paired-change detector names two
// path sets and reports a staged change that touched the first and nothing in
// the second — the doc left behind by the module, the migration left behind by
// the schema. It reads the git index, so it has something to say at commit time
// and reports itself skipped anywhere nothing is staged.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The project root is two levels up from `.jig/checks/`. Resolved from this
// file rather than from the working directory, so the driver behaves the same
// whether it is run from the repository root or from a git hook.
const ROOT = path.resolve(HERE, "..", "..");

// Directories a source check has no business walking into. Deliberately a
// short fixed list rather than a .gitignore parser: reading ignore rules
// properly means a dependency, and a check that silently skipped a tracked
// file would be worse than one that reads a few extra.
const SKIP_DIRS = new Set([
  ".git", ".jig", "node_modules", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".venv", "venv", "vendor", "target",
]);

// A ceiling, so a check driver pointed at a monorepo by accident stops instead
// of reading for ten minutes.
const MAX_FILES = 20000;

// ---------------------------------------------------------------------------
// Globs
// ---------------------------------------------------------------------------

// Enough glob for the catalogue's own path patterns: `**` crosses directory
// separators, `*` does not, `?` is one character, `{a,b}` is an alternation.
// Anything else is a literal. Without the alternation a path set like
// `**/*.{ts,tsx}` matches nothing at all, which is a silent zero-coverage
// failure rather than a loud one.
function globToRegExp(glob) {
  let out = "";
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += glob[i + 2] === "/" ? 2 : 1;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (c === "{") {
      depth++;
      out += "(?:";
    } else if (c === "}" && depth) {
      depth--;
      out += ")";
    } else if (c === "," && depth) {
      out += "|";
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp("^" + out + ")".repeat(depth) + "$", "i");
}

function matchesAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

// ---------------------------------------------------------------------------
// Comment and string blanking
// ---------------------------------------------------------------------------
//
// Every blanked region keeps its length and its newlines, so a match's line
// number is still the line number in the file the user will open. This is the
// single place false positives are most likely to live, which is why the
// catalogue's near-miss fixtures aim straight at it.

// Comment syntax is language data, so the edition that knows the language
// declares it per extension and hands the map down as `opts.commentSyntax`.
// This table is only the floor for a file no edition claimed — without it a
// `.py` or `.ps1` file would be read with JavaScript comment rules and every
// commented-out line would come back as live code.
const DEFAULT_COMMENT_SYNTAX = {
  ".py": "hash", ".pyi": "hash", ".rb": "hash", ".ps1": "hash", ".psm1": "hash",
  ".pl": "hash", ".pm": "hash", ".r": "hash", ".sh": "hash", ".bash": "hash",
  ".zsh": "hash", ".yml": "hash", ".yaml": "hash", ".toml": "hash",
};

function commentStyle(rel, syntax) {
  const ext = path.extname(rel).toLowerCase();
  if (syntax && typeof syntax[ext] === "string") return syntax[ext];
  if (/^(?:Dockerfile|Makefile|makefile|GNUmakefile)(?:\.|$)/.test(path.basename(rel))) return "hash";
  return DEFAULT_COMMENT_SYNTAX[ext] || "slash";
}

// A `/` opens a regular expression only where a value may start. After a name,
// a number, or a closing bracket it is division. The known miss is `if (x)
// /re/.test(s)`, where the regex body stays visible to the patterns — a rare
// shape, and one that can only ever add a finding, never hide one.
function regexCanStart(prev) {
  return prev === "" || !/[)\]}\w$]/.test(prev);
}

// Both `stripComments` and `stripStrings` default to true: blanking more is the
// fewer-false-positives direction, so an edition that says nothing gets the
// safe reading. `strings` is the driver's older spelling of `stripStrings`.
//
// Comments and string literals are RECOGNISED unconditionally and only ERASED
// when asked. That separation is the whole fix for the third fault: with string
// bodies left visible, a scanner that stopped tracking them read the `//` in a
// URL as a comment and blanked the rest of the line, and the `/*` in a glob as
// a block comment and blanked the rest of the file.
function blankRegions(text, rel, opts) {
  const o = opts || {};
  const style = commentStyle(rel, o.commentSyntax);
  const stripComments = o.stripComments !== false;
  const stripStrings = o.stripStrings !== undefined ? o.stripStrings !== false : o.strings !== false;
  const out = text.split("");
  const erase = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const toLineEnd = (from) => {
    let j = from;
    while (j < text.length && text[j] !== "\n") j++;
    return j;
  };

  // A literal that never closes is not a literal: reading it as one is how a
  // lone apostrophe used to blank everything after it.
  const closedAt = (i, q, oneLine) => {
    let j = i + 1;
    while (j < text.length) {
      const d = text[j];
      if (d === "\\") { j += 2; continue; }
      if (d === q) return { body: i + 1, bodyEnd: j, end: j + 1 };
      if (d === "\n" && oneLine) return null;
      j++;
    }
    return null;
  };
  // Rust raw strings: `r"…"`, `r#"…"#`, `br##"…"##`. No escapes inside, and the
  // hash count picks the terminator, so a `"` in the body cannot end it early.
  const RAW = /(?:br|r)(#*)"/y;
  const literalAt = (i) => {
    const q = text[i];
    if (style === "hash") {
      if (q !== '"' && q !== "'") return null;
      // Python triple quotes span lines; consuming one whole is what keeps the
      // scanner in step with the rest of the file.
      if (text[i + 1] === q && text[i + 2] === q) {
        const close = text.indexOf(q + q + q, i + 3);
        return close === -1 ? null : { body: i + 3, bodyEnd: close, end: close + 3 };
      }
      return closedAt(i, q, true);
    }
    if (q === "r" || q === "b") {
      if (/[\w$]/.test(text[i - 1] || "")) return null;
      RAW.lastIndex = i;
      const m = RAW.exec(text);
      if (!m || m.index !== i) return null;
      const term = '"' + m[1];
      const body = i + m[0].length;
      const close = text.indexOf(term, body);
      return close === -1 ? null : { body, bodyEnd: close, end: close + term.length };
    }
    if (q === '"' || q === "'") return closedAt(i, q, true);
    // Template literals and Go raw strings both span lines.
    if (q === "`") return closedAt(i, q, false);
    return null;
  };

  let prev = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (style === "hash" && c === "#") {
      const end = toLineEnd(i);
      if (stripComments) erase(i, end);
      i = end;
      continue;
    }
    if (style === "slash" && c === "/" && text[i + 1] === "/") {
      const end = toLineEnd(i);
      if (stripComments) erase(i, end);
      i = end;
      continue;
    }
    if (style === "slash" && c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      if (stripComments) erase(i, end);
      i = end;
      continue;
    }
    const lit = literalAt(i);
    if (lit) {
      if (stripStrings) erase(lit.body, lit.bodyEnd);
      prev = text[lit.end - 1];
      i = lit.end;
      continue;
    }
    if (style === "slash" && c === "/" && regexCanStart(prev)) {
      let j = i + 1;
      let charClass = false;
      while (j < text.length) {
        const d = text[j];
        if (d === "\\") { j += 2; continue; }
        if (d === "\n") break;
        if (d === "[") charClass = true;
        else if (d === "]") charClass = false;
        else if (d === "/" && !charClass) { j++; break; }
        j++;
      }
      erase(i + 1, Math.max(i + 1, j - 1));
      prev = "/";
      i = j;
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
}

// ---------------------------------------------------------------------------
// The context every check module is handed
// ---------------------------------------------------------------------------

function walk(root, only) {
  if (only && only.length) {
    return only
      .map((p) => path.relative(root, path.resolve(root, p)).split(path.sep).join("/"))
      .filter((rel) => rel && !rel.startsWith("..") && fs.existsSync(path.join(root, rel)));
  }
  const found = [];
  const stack = ["."];
  while (stack.length && found.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const rel = dir === "." ? entry.name : dir + "/" + entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(rel);
      } else if (entry.isFile()) {
        found.push(rel);
      }
    }
  }
  return found;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function makeContext(root, only) {
  const all = walk(root, only);
  const cache = new Map();
  return {
    root,
    files(globs) {
      return all.filter((rel) => matchesAny(rel, globs));
    },
    read(rel) {
      if (!cache.has(rel)) {
        try {
          cache.set(rel, fs.readFileSync(path.join(root, rel), "utf-8").replace(/^﻿/, ""));
        } catch {
          cache.set(rel, null);
        }
      }
      return cache.get(rel);
    },
    clean(rel, text, opts) {
      return blankRegions(text, rel, opts || {});
    },
    lineOf,
    // The pattern-over-source loop, written once. Every source check is the
    // same handful of decisions — which files, which patterns, whether string
    // literals count, whether a match may span lines — so each check module
    // states those and nothing else.
    //
    // `perLine` matters more than it looks. A pattern like `curl [^|]* | sh`
    // has a negated character class in it, and a negated class happily crosses
    // a newline: run it over a whole file and a curl on line 3 pairs up with an
    // unrelated pipe on line 40. Anything describing one shell command asks for
    // one line at a time.
    scan(classId, globs, patterns, opts) {
      const options = opts || {};
      const out = [];
      for (const rel of this.files(globs)) {
        const text = this.read(rel);
        if (text === null) continue;
        const source = blankRegions(text, rel, options);
        if (options.perLine) {
          source.split("\n").forEach((line, i) => {
            for (const p of patterns) if (new RegExp(p).test(line)) out.push(this.finding(classId, rel, i + 1, p));
          });
          continue;
        }
        for (const p of patterns) {
          for (const m of source.matchAll(new RegExp(p, "g"))) {
            out.push(this.finding(classId, rel, lineOf(text, m.index), p));
          }
        }
      }
      return out;
    },
    // Findings name a file and a line and the pattern that fired. The text
    // that matched is deliberately never carried out of here — a report is a
    // record of which check spoke, not a copy of somebody's source.
    finding(classId, rel, line, pattern, note) {
      return { classId, path: rel, line, pattern, note: note || null };
    },
    git(args) {
      const run = spawnSync("git", args, { cwd: root, encoding: "utf-8", windowsHide: true });
      if (run.error || run.status !== 0) return { ok: false, stdout: "" };
      return { ok: true, stdout: run.stdout };
    },
    // The staged change set, and what a paired-change detector reads.
    //
    // Staged and nothing else. A base ref would have to be guessed, and a
    // guessed base makes the same check say different things on a branch, on a
    // merge, and on a shallow CI clone — three answers is worse than one honest
    // limit. Nothing staged returns null, which the caller reports as a skip
    // rather than a pass: a class nobody could evaluate is not a class that
    // came back clean.
    changed() {
      const run = this.git(["diff", "--cached", "--name-only"]);
      if (!run.ok) return null;
      const list = run.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      return list.length ? list : null;
    },
  };
}

// ---------------------------------------------------------------------------
// Loading the checks
// ---------------------------------------------------------------------------

async function loadChecks() {
  let names;
  try {
    names = fs.readdirSync(HERE).filter((f) => f.endsWith(".check.mjs")).sort();
  } catch {
    names = [];
  }
  const checks = [];
  for (const name of names) {
    try {
      const mod = await import(pathToFileURL(path.join(HERE, name)).href);
      if (typeof mod.id === "string" && Array.isArray(mod.detectors)) checks.push(mod);
    } catch (err) {
      // A check that will not load is reported and skipped. One broken module
      // must not take the others down with it.
      checks.push({ id: name, broken: err.message });
    }
  }
  return checks;
}

// A check module declares detectors, not a function. Only the ones this driver
// runs are its own — a detector belonging to a session guard or to CI names a
// different runner and is skipped here rather than run in the wrong place.
function driverDetectors(mod) {
  return mod.detectors.filter((det) => det && det.runner === "checks" &&
    det.params && Array.isArray(det.params.patterns) && det.params.patterns.length);
}

function scanWith(ctx, mod, det) {
  const p = det.params;
  return ctx.scan(mod.id, p.paths || [], p.patterns, p);
}

// The second detector kind, and the only one that is not a regular expression
// over source. A pattern detector asks what is inside one file. A paired-change
// detector asks what moved together, which is a question no pattern can reach:
// the doc that has to follow the module, the migration that has to follow the
// schema, the fixture that has to follow the format. `paths` names the files
// whose change obliges something matching `pairedWith` to change with them.
function pairedDetectors(mod) {
  return mod.detectors.filter((det) => det && det.runner === "checks" && det.params &&
    Array.isArray(det.params.pairedWith) && det.params.pairedWith.length &&
    Array.isArray(det.params.paths) && det.params.paths.length);
}

// The finding names the file that moved without its pair, at line 1. The
// mistake is the absence of another file, so there is no line in this one to
// point at, and pretending otherwise would send somebody to an innocent line.
function pairedFindings(ctx, mod, det, changed) {
  const p = det.params;
  const touched = changed.filter((rel) => matchesAny(rel, p.paths));
  if (!touched.length) return [];
  if (changed.some((rel) => matchesAny(rel, p.pairedWith))) return [];
  const note = "changed with nothing matching " + p.pairedWith.join(" or ");
  return touched.map((rel) => ctx.finding(mod.id, rel, 1, "paired:" + p.pairedWith.join(","), note));
}

// The fixture pair is stored inline, so the driver has to invent the path it
// would have lived under. That path has to satisfy the detector's own globs, or
// ctx.scan filters the fixture straight back out and every precise check reports
// a miss it never had. So the first glob is walked segment by segment and each
// wildcard is replaced with a literal: `**` between directories collapses to
// nothing, a `*` directory becomes one named directory, a `{a,b}` alternation
// takes its first branch, and the final segment's `*` becomes `fixture`. A glob
// ending `*.js` therefore still yields `fixture.js`, the same name and so the
// same language admission read it as.
function concreteSegment(glob, star) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      out += star;
      while (glob[i + 1] === "*") i++;
    } else if (c === "?") {
      out += "x";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      const body = end === -1 ? glob.slice(i + 1) : glob.slice(i + 1, end);
      out += body.split(",")[0];
      i = end === -1 ? glob.length : end;
    } else {
      out += c;
    }
  }
  return out;
}

function fixturePath(det) {
  const glob = (det.params.paths || [])[0] || "fixture.txt";
  const segments = glob.split("/");
  const base = concreteSegment(segments.pop(), "fixture");
  const dirs = segments
    .filter((seg) => seg !== "**" && seg !== "")
    .map((seg) => concreteSegment(seg, "fx"));
  return [...dirs, base].join("/");
}

// ---------------------------------------------------------------------------
// The two runs
// ---------------------------------------------------------------------------

async function runChecks(root, only) {
  const ctx = makeContext(root, only);
  const findings = [];
  const skipped = [];
  const broken = [];
  // Read once, for every paired detector in the run. Asking git per check would
  // spawn a process per module to learn the same fact.
  let changed;
  for (const mod of await loadChecks()) {
    if (mod.broken) { broken.push({ id: mod.id, why: mod.broken }); continue; }
    const mine = driverDetectors(mod);
    const paired = pairedDetectors(mod);
    if (!mine.length && !paired.length) {
      skipped.push({ id: mod.id, why: "no detector this driver runs — it is watched elsewhere", command: null });
      continue;
    }
    try {
      for (const det of mine) findings.push(...scanWith(ctx, mod, det));
      if (paired.length) {
        if (changed === undefined) changed = ctx.changed();
        if (changed === null) {
          skipped.push({
            id: mod.id,
            why: "nothing is staged, so there is no change set to read — this class is watched at commit time",
            command: null,
          });
        } else {
          for (const det of paired) findings.push(...pairedFindings(ctx, mod, det, changed));
        }
      }
    } catch (err) {
      broken.push({ id: mod.id, why: err.message });
    }
  }
  findings.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
  return { findings, skipped, broken };
}

// The witnessed catch, without jig. Every check carries the pair that admitted
// it, so the driver can re-run that same admission here, in a throwaway
// directory, with nothing installed. Both halves count: a check that misses its
// own violation is broken, and one that fires on its own near miss is a check
// that will cry wolf on somebody's real code.
async function runSelftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jig-selftest-"));
  const results = [];
  try {
    for (const mod of await loadChecks()) {
      if (mod.broken) { results.push({ id: mod.id, caught: false, why: mod.broken }); continue; }
      const mine = driverDetectors(mod);
      const paired = pairedDetectors(mod);
      const pair = mod.fixtures;
      if ((!mine.length && !paired.length) || !pair ||
          typeof pair.violation !== "string" || typeof pair.nearMiss !== "string") {
        results.push({ id: mod.id, caught: null, why: "carries no fixture pair this driver can run", command: null });
        continue;
      }
      let hits = 0;
      let nearMissHits = 0;
      let failed = null;
      let seeded = null;
      for (const det of mine) {
        const name = fixturePath(det);
        if (!seeded) seeded = name;
        const full = path.join(dir, ...name.split("/"));
        try {
          fs.mkdirSync(path.dirname(full), { recursive: true });
          fs.writeFileSync(full, pair.violation);
          hits += scanWith(makeContext(dir, [name]), mod, det).length;
          fs.writeFileSync(full, pair.nearMiss);
          nearMissHits += scanWith(makeContext(dir, [name]), mod, det).length;
        } catch (err) {
          failed = err.message;
        } finally {
          fs.rmSync(full, { force: true });
        }
        if (failed) break;
      }
      // A paired-change fixture is a change set rather than source text: one
      // path per line. Nothing is written to disk for it, because the thing
      // under test is which paths appear together, and a list is already that.
      if (!failed && paired.length) {
        const asSet = (text) => text.split("\n").map((s) => s.trim()).filter(Boolean);
        const bare = makeContext(dir, []);
        for (const det of paired) {
          if (!seeded) seeded = (det.params.paths || []).join(", ") || null;
          hits += pairedFindings(bare, mod, det, asSet(pair.violation)).length;
          nearMissHits += pairedFindings(bare, mod, det, asSet(pair.nearMiss)).length;
        }
      }
      if (failed) { results.push({ id: mod.id, caught: false, why: failed }); continue; }
      const why = hits === 0 ? "the seeded violation did not fire the check"
        : nearMissHits > 0 ? "the check also fired on its own near miss" : null;
      results.push({ id: mod.id, caught: hits > 0 && nearMissHits === 0, seeded, hits, nearMissHits, why });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return results;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(out) {
  const lines = [];
  for (const f of out.findings) lines.push(`${f.path}:${f.line}  ${f.classId}${f.note ? "  (" + f.note + ")" : ""}`);
  for (const s of out.skipped) lines.push(`skipped  ${s.id} — ${s.why}${s.command ? "\n  run it yourself: " + s.command : ""}`);
  for (const b of out.broken) lines.push(`BROKEN   ${b.id} — ${b.why}`);
  lines.push(out.findings.length
    ? `\n${out.findings.length} finding${out.findings.length === 1 ? "" : "s"}.`
    : "\nNo findings.");
  return lines.join("\n");
}

function selftestReport(results) {
  const lines = [];
  for (const r of results) {
    if (r.caught === true) lines.push(`caught   ${r.id} — seeded ${r.seeded}, ${r.hits} hit${r.hits === 1 ? "" : "s"}`);
    else if (r.caught === null) lines.push(`skipped  ${r.id} — ${r.why}${r.command ? "\n  run it yourself: " + r.command : ""}`);
    else lines.push(`MISSED   ${r.id} — ${r.why || "the seeded violation did not fire the check"}`);
  }
  const missed = results.filter((r) => r.caught === false).length;
  lines.push(missed ? `\n${missed} check${missed === 1 ? "" : "s"} did not catch its own violation.` : "\nEvery runnable check caught its own violation.");
  return lines.join("\n");
}

async function main(argv) {
  const json = argv.includes("--json");
  const paths = argv.filter((a) => !a.startsWith("--"));
  if (argv.includes("--selftest")) {
    const results = await runSelftest();
    process.stdout.write((json ? JSON.stringify({ selftest: results }, null, 2) : selftestReport(results)) + "\n");
    return results.some((r) => r.caught === false) ? 1 : 0;
  }
  const out = await runChecks(ROOT, paths);
  process.stdout.write((json ? JSON.stringify(out, null, 2) : report(out)) + "\n");
  return out.findings.length || out.broken.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (err) => {
    // The driver failing is a fact to report, never a reason to stop somebody
    // committing. A crash exits 1 and says why, in one line.
    process.stderr.write("jig checks failed to run: " + err.message + "\n");
    process.exitCode = 1;
  },
);
