#!/usr/bin/env node
/**
 * update-meta.js
 *
 * Keeps config/scripts-meta.json consistent with the staged .js files so a
 * commit never leaves the sync state (used by Pull.js / Push.js) out of date.
 *
 * Run automatically by the pre-commit hook (.githooks/pre-commit). For every
 * STAGED .js file under widgets/, scripts/ or helpers/ it:
 *   - recomputes the content hash (same algorithm as helpers/Git.js)
 *   - if the hash changed, updates hash + lastUpdated and bumps the version
 *   - creates a fresh entry (v1.0.0, type inferred from folder) for new files
 * then re-stages config/scripts-meta.json so it lands in the same commit.
 *
 * Version bump level defaults to "patch". Override per commit with:
 *   META_BUMP=minor git commit ...     (or major)
 *
 * Entries whose file does not exist in the repo (e.g. device-only scripts like
 * Translate, Widget template) are left untouched.
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const metaPath = path.join(root, "config", "scripts-meta.json");
const metaRel = "config/scripts-meta.json";

// Folders that map to Scriptable script types (basename is the meta key).
const TYPE_BY_DIR = { "widgets/": "widget", "scripts/": "script", "helpers/": "helper" };

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

// Same hash as helpers/Git.js so hashes match what Push.js writes on-device.
function computeHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

// Same semantics as Push.js bumpVersion.
function bumpVersion(version, type) {
  const parts = (version || "0.0.0").split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  if (type === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (type === "minor") { parts[1]++; parts[2] = 0; }
  else { parts[2]++; }
  return parts.join(".");
}

const bump = (process.env.META_BUMP || "patch").toLowerCase();

// Staged, still-present files (added/copied/modified/renamed).
let staged;
try {
  staged = git(["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"])
    .split("\0")
    .filter(Boolean);
} catch (e) {
  process.exit(0); // not in a git context / nothing staged
}

const jsFiles = staged.filter(
  (f) => f.endsWith(".js") && Object.keys(TYPE_BY_DIR).some((d) => f.startsWith(d))
);
if (jsFiles.length === 0) process.exit(0);

let meta = {};
try {
  meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
} catch (e) {
  meta = {};
}

const now = new Date().toISOString();
let changed = false;

for (const file of jsFiles) {
  // Hash the STAGED blob (what will actually be committed), not the worktree.
  let content;
  try {
    content = execFileSync("git", ["show", `:${file}`], { cwd: root, encoding: "utf8" });
  } catch (e) {
    continue;
  }

  const base = path.basename(file).replace(/\.js$/, "");
  const hash = computeHash(content);
  const entry = meta[base] || {};

  if (entry.hash === hash) continue; // content unchanged, nothing to do

  const dir = Object.keys(TYPE_BY_DIR).find((d) => file.startsWith(d));
  const isNew = !meta[base];

  meta[base] = {
    ...entry,
    version: isNew ? "1.0.0" : bumpVersion(entry.version || "0.0.0", bump),
    type: entry.type || TYPE_BY_DIR[dir],
    hash,
    lastUpdated: now,
  };
  changed = true;
  console.log(`scripts-meta: ${base} -> v${meta[base].version} (${hash})`);
}

if (changed) {
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  git(["add", metaRel]);
}
