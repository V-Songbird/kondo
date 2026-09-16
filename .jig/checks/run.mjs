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
// A check declares one of three detector kinds. A pattern detector is a regular
// expression over the files a glob names. A paired-change detector names two
// path sets and reports a staged change that touched the first and nothing in
// the second — the doc left behind by the module, the migration left behind by
// the schema. It reads the git index, so it has something to say at commit time
// and reports itself skipped anywhere nothing is staged. An anchor detector
// reads a doc that cites source by line — `[scan.ts:109](../path/to/scan.ts)` —
// and opens what the citation names: the target has to be there, the line has to
// be inside it, the link text has to name the file the path names, and a
// backticked identifier written against the anchor has to be near the cited
// line. That is the mistake neither other kind can reach, because the doc is
// still correct about itself and it is the other file that moved.

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

// ---------------------------------------------------------------------------
// The anchor detector
// ---------------------------------------------------------------------------
//
// The third kind, and the only one that opens a file the scanned file merely
// names. A pattern detector asks what is inside one file; a paired-change
// detector asks what moved together. Neither can answer whether `[scan.ts:109]`
// still lands on anything, because that answer lives in the target's own length.
// A doc that cites source by line goes stale every time the code moves and says
// nothing while it does, which is exactly the shape a check is for.
//
// Five questions and no others, so every finding has a reason it can name. The
// looser readings all cost false positives on correct anchors, and a check that
// cries wolf on a correct doc is worse than no check: a symbol is read only
// where a backticked plain identifier touches the anchor, and an anchor with
// nothing against it is asked for existence and range alone.
function anchorDetectors(mod) {
  return mod.detectors.filter((det) => det && det.runner === "checks" && det.params &&
    det.params.kind === "anchor" && Array.isArray(det.params.paths) && det.params.paths.length);
}

// `[text](href)`. The leading group catches an image, which names a picture
// rather than a source location and is left alone.
const DOC_LINK = /(!?)\[([^\]\n]*)\]\(([^)\s]+)\)/g;

// The anchor's grammar, and the filename reading that makes the basename
// comparison safe. `[plan](plans/132-…md)` names no file so nothing is compared;
// `[testing.md](testing.md#the-guards)` names one, and `[scan.ts:109](…)` names
// one with a line. A range carries its far end in the third group.
const ANCHOR_TEXT = /^([\w.-]+\.\w+):(\d+)(?:-(\d+))?$/;
const FILENAME_TEXT = /^([\w.-]+\.\w+)(?::\d+(?:-\d+)?)?$/;

// `, line 1718` and ` and line 228` — a second line in the same breath as the
// anchor it follows, checked against that anchor's target. Tied to the anchor's
// own closing bracket rather than to the paragraph, because a line number
// further off belongs to a file this check would have to guess at.
const CONTINUATION = /^(?:,| and) line (\d+)\b/;

// A cross-reference into the doc's own numbered list.
const FINDING_REF = /\bfinding (\d+)\b/gi;

// The narrow reading of "beside the anchor": a backticked token the anchor
// touches, with horizontal space, at most one line break and at most one opening
// bracket between them. Measured against docs/status.md, the looser readings
// pick up prose — the word two clauses back, or a phrase in quotation marks.
const ADJACENT_SYMBOL = /`([^`\n]+)`[^\S\n]*\n?[^\S\n]*\(?[^\S\n]*$/;

// And only a plain identifier is taken as a symbol. A dotted name, a path or a
// phrase is something the target need not carry literally, so asking for it
// would report a correct anchor.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{2,}$/;

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lines as an editor counts them, whatever the checkout's line endings are: a
// trailing newline closes the last line rather than opening an empty one, and an
// empty file has none at all. `.gitattributes` may hand this check CRLF on
// Windows and LF everywhere else, and both have to give the same number.
function countLines(text) {
  if (!text.length) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
  return text.endsWith("\n") ? n : n + 1;
}

// GitHub's own slug, near enough for a fragment somebody typed by hand.
function headingSlugs(text) {
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*$/gm)) {
    out.add(m[1].replace(/`/g, "").toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-"));
  }
  return out;
}

// A doc that DESCRIBES an anchor is not citing one. Fenced blocks and inline
// code spans are blanked before the links are read — length and newlines kept,
// the way blankRegions keeps them, so every finding still lands on the line the
// reader will open — because a `[text](href)` written to explain the grammar
// names no file and cannot have gone stale. The symbol is still read from the
// original text: a symbol lives in backticks by definition, so reading it from
// the blanked copy would find none anywhere.
function blankMarkdownCode(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let fence = null;
  let i = 0;
  while (i < text.length) {
    const nl = text.indexOf("\n", i);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(i, end);
    const opener = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      blank(i, end);
      if (opener && opener[1][0] === fence[0] && opener[1].length >= fence.length) fence = null;
    } else if (opener) {
      fence = opener[1];
      blank(i, end);
    } else {
      // Inline spans, one line at a time: a run of n backticks closes on the
      // next run of exactly n. A run that never closes is not a span, so it
      // blanks nothing — the same reading blankRegions gives an open quote.
      let j = 0;
      while (j < line.length) {
        if (line[j] !== "`") { j++; continue; }
        let k = j;
        while (line[k] === "`") k++;
        const run = k - j;
        let p = k;
        let closeAt = -1;
        while (p < line.length) {
          if (line[p] !== "`") { p++; continue; }
          let q = p;
          while (line[q] === "`") q++;
          if (q - p === run) { closeAt = q; break; }
          p = q;
        }
        if (closeAt === -1) { j = k; continue; }
        blank(i + j, i + closeAt);
        j = closeAt;
      }
    }
    i = end + 1;
  }
  return out.join("");
}

function symbolNear(body, symbol, from, to, window) {
  const lines = body.split("\n");
  const re = new RegExp("(?:^|[^\\w$])" + escapeRe(symbol) + "(?![\\w$])");
  for (let i = Math.max(1, from - window); i <= Math.min(lines.length, to + window); i++) {
    if (re.test(lines[i - 1].replace(/\r$/, ""))) return true;
  }
  return false;
}

// The items under the doc's own findings heading, so `finding 4` can be held to
// a list that exists. Null where the doc has no such heading: a list nobody
// wrote is not a list the number fell off the end of.
function findingsCount(text, heading) {
  const lines = text.split("\n").map((s) => s.replace(/\r$/, ""));
  const title = new RegExp("^#{1,6}[ \\t]+" + escapeRe(heading) + "[ \\t]*$");
  let at = -1;
  for (let i = 0; i < lines.length; i++) if (title.test(lines[i])) { at = i; break; }
  if (at === -1) return null;
  let count = 0;
  for (let i = at + 1; i < lines.length; i++) {
    if (/^#{1,6}[ \t]/.test(lines[i])) break;
    if (/^\d+\.[ \t]/.test(lines[i])) count++;
  }
  return count;
}

// One finding per citation, and the first reason in a fixed order wins. An
// anchor whose text names the wrong file and whose line is past the end is one
// mistake to a reader, and two lines about it would only bury the fix.
//
// The finding names the DOC and the anchor's own line. The target's line is not
// where anybody has to type: nothing there is wrong. The note carries the target
// and the one number that settles it, and no other text from the doc travels
// into the report — a finding says which check spoke and where, never what
// somebody's prose said.
function docAnchorFindings(ctx, classId, rel, text, window, heading) {
  const out = [];
  const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  const say = (at, pattern, note) => out.push(ctx.finding(classId, rel, lineOf(text, at), pattern, note));
  const source = blankMarkdownCode(text);

  for (const m of source.matchAll(DOC_LINK)) {
    const [whole, image, label, href] = m;
    // A picture, a URL and a bare fragment all name something this check has no
    // way to open, so none of them is claimed.
    if (image === "!" || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    const hash = href.indexOf("#");
    const bare = hash === -1 ? href : href.slice(0, hash);
    const fragment = hash === -1 ? "" : href.slice(hash + 1);
    if (!bare) continue;

    // Resolved against the doc's own directory, forward slashes and all, and
    // dropped the moment it leaves the repository. A link like `../../releases`
    // resolves on the hosting side and nowhere a check can follow.
    const target = path.relative(ctx.root, path.resolve(ctx.root, dir, bare)).split(path.sep).join("/");
    if (!target || target.startsWith("..") || path.isAbsolute(target)) continue;

    const body = ctx.read(target);
    if (body === null) {
      // A directory reads back null too, and a link to one is not a stale
      // anchor. Only an absence is reported.
      if (!fs.existsSync(path.join(ctx.root, ...target.split("/")))) {
        say(m.index, "anchor:target", "no file at " + href);
      }
      continue;
    }

    const named = FILENAME_TEXT.exec(label);
    const base = target.slice(target.lastIndexOf("/") + 1);
    if (named && named[1] !== base) {
      say(m.index, "anchor:basename", "link text says " + named[1] + ", path says " + base);
      continue;
    }
    if (fragment && target.endsWith(".md") && !headingSlugs(body).has(fragment.toLowerCase())) {
      say(m.index, "anchor:fragment", "no heading #" + fragment + " in " + bare);
      continue;
    }

    const anchor = ANCHOR_TEXT.exec(label);
    if (!anchor) continue;
    const total = countLines(body);
    const plural = total === 1 ? " line" : " lines";
    const from = Number(anchor[2]);
    const to = anchor[3] ? Number(anchor[3]) : from;
    if (from < 1 || to < from || to > total) {
      say(m.index, "anchor:line", bare + " has " + total + plural);
      continue;
    }
    const adjacent = ADJACENT_SYMBOL.exec(text.slice(Math.max(0, m.index - 200), m.index));
    const symbol = adjacent && IDENTIFIER.test(adjacent[1]) ? adjacent[1] : null;
    if (symbol && !symbolNear(body, symbol, from, to, window)) {
      say(m.index, "anchor:symbol", symbol + " is not within " + window + " lines of " + from + " in " + bare);
      continue;
    }
    // The continuation is a second citation, so it earns its own finding at its
    // own position rather than being folded into the anchor's.
    const after = m.index + whole.length;
    const continuation = CONTINUATION.exec(source.slice(after, after + 24));
    if (continuation) {
      const line = Number(continuation[1]);
      if (line < 1 || line > total) say(after, "anchor:line", bare + " has " + total + plural);
    }
  }

  const items = heading ? findingsCount(source, heading) : null;
  if (items !== null) {
    for (const m of source.matchAll(FINDING_REF)) {
      const n = Number(m[1]);
      if (n < 1 || n > items) {
        say(m.index, "anchor:finding", "the " + heading + " list has " + items + (items === 1 ? " item" : " items"));
      }
    }
  }
  return out;
}

function anchorFindings(ctx, mod, det) {
  const p = det.params;
  const window = typeof p.symbolWindow === "number" ? p.symbolWindow : 2;
  const heading = typeof p.findingsHeading === "string" ? p.findingsHeading : null;
  const out = [];
  for (const rel of ctx.files(p.paths)) {
    const text = ctx.read(rel);
    if (text === null) continue;
    out.push(...docAnchorFindings(ctx, mod.id, rel, text, window, heading));
  }
  return out;
}

// An anchor fixture is a doc and the files it points at: one string, fenced by
// `--- targets`, with each target introduced by a `=== <path>` line naming where
// it sits relative to the throwaway root. These halves DO go to disk, unlike the
// paired-change fixture's change set, because the thing under test is whether
// the check can open a target and count it — and only a real tree proves the
// glob, the path resolution and the line count together.
function anchorFixture(text) {
  const at = text.search(/^--- targets$/m);
  if (at === -1) return null;
  const nl = text.indexOf("\n", at);
  const files = [];
  let current = null;
  for (const line of (nl === -1 ? "" : text.slice(nl + 1)).split("\n")) {
    const head = /^=== (\S+)$/.exec(line);
    if (head) { current = { path: head[1], body: [] }; files.push(current); continue; }
    if (current) current.body.push(line);
  }
  return { doc: text.slice(0, at), files: files.map((f) => ({ path: f.path, body: f.body.join("\n") })) };
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
    const anchors = anchorDetectors(mod);
    if (!mine.length && !paired.length && !anchors.length) {
      skipped.push({ id: mod.id, why: "no detector this driver runs — it is watched elsewhere", command: null });
      continue;
    }
    try {
      for (const det of mine) findings.push(...scanWith(ctx, mod, det));
      for (const det of anchors) findings.push(...anchorFindings(ctx, mod, det));
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
      const anchors = anchorDetectors(mod);
      const pair = mod.fixtures;
      if ((!mine.length && !paired.length && !anchors.length) || !pair ||
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
      // An anchor fixture is written out whole — the doc and every target it
      // names — and read back by the unmodified detector, so the temp tree
      // proves the glob, the path resolution and the line count the same way a
      // real run does.
      if (!failed && anchors.length) {
        for (const det of anchors) {
          const name = fixturePath(det);
          if (!seeded) seeded = name;
          for (const half of ["violation", "nearMiss"]) {
            const parsed = anchorFixture(pair[half]);
            if (!parsed) {
              failed = "an anchor detector's fixture carries no `--- targets` fence, so there is nothing for it to open";
              break;
            }
            const written = [];
            try {
              for (const file of [{ path: name, body: parsed.doc }, ...parsed.files]) {
                const full = path.join(dir, ...file.path.split("/"));
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, file.body);
                written.push(full);
              }
              const count = anchorFindings(makeContext(dir, [name]), mod, det).length;
              if (half === "violation") hits += count; else nearMissHits += count;
            } catch (err) {
              failed = err.message;
            } finally {
              for (const full of written) fs.rmSync(full, { force: true });
            }
            if (failed) break;
          }
          if (failed) break;
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
