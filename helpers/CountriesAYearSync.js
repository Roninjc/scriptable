// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: magic;

/**
 * CountriesAYearSync — Worldwide sync helper (end-to-end encrypted).
 *
 * Used by the "Countries a year" widget and by WorldwideConfig:
 *   - pushToRelay():   encrypt every locationsStore*.json and PUT it to the relay.
 *   - applyPatches():  pull the PWA's gap repairs from the relay and reconcile
 *                      them into the yearly JSON files.
 *   - applyPatchSet(): same reconcile, from inline data (QR / no server).
 *
 * Crypto format (byte-compatible with the PWA's src/lib/crypto.ts):
 *   base64( salt[16] ‖ nonce[24] ‖ nacl.secretbox )
 *   key = scrypt(utf8(passphrase.NFKC), salt, N=32768, r=8, p=1, dkLen=32)
 *
 * Also require()-able under Node to test the format against the PWA.
 */

// --- dependency loading (Scriptable importModule vs Node require) ---
function loadDep(name) {
  if (typeof importModule !== "undefined") return importModule(name);
  return require("./" + name + ".js"); // Node: used only by the format test
}

const nacl = loadDep("nacl");
const scrypt = loadDep("scrypt");

// --- scrypt work factors (must match the PWA) ---
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;
const NONCE_LEN = 24;

// --- pure helpers (no environment dependencies) ---

// Identical byte output to tweetnacl-util.decodeUTF8 (string → UTF-8 bytes).
function utf8Encode(str) {
  const d = unescape(encodeURIComponent(str));
  const b = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}

// Standard base64 with padding (matches tweetnacl-util.encodeBase64 output).
function b64Encode(bytes) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  let i = 0;
  const len = bytes.length;
  const main = len - (len % 3);
  for (; i < main; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += A[(n >>> 18) & 63] + A[(n >>> 12) & 63] + A[(n >>> 6) & 63] + A[n & 63];
  }
  if (len % 3 === 1) {
    const n = bytes[i] << 16;
    out += A[(n >>> 18) & 63] + A[(n >>> 12) & 63] + "==";
  } else if (len % 3 === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += A[(n >>> 18) & 63] + A[(n >>> 12) & 63] + A[(n >>> 6) & 63] + "=";
  }
  return out;
}

// Inverse of b64Encode: standard base64 (padding tolerant) → Uint8Array.
function b64Decode(str) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Int16Array(256).fill(-1);
  for (let i = 0; i < A.length; i++) lookup[A.charCodeAt(i)] = i;
  const clean = str.trim().replace(/=+$/, "");
  const outLen = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let bits = 0, acc = 0, p = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = lookup[clean.charCodeAt(i)];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}

// Inverse of utf8Encode (matches tweetnacl-util.encodeUTF8): UTF-8 bytes → string.
function utf8Decode(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(bin));
}

// Scriptable has no CSPRNG global; UUID v4 is a good entropy source for a
// per-upload salt/nonce (they only need to be unique + unpredictable).
function randomBytes(n) {
  const out = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const hex = UUID.string().replace(/-/g, "");
    for (let j = 0; j + 1 < hex.length && i < n; j += 2) {
      out[i++] = parseInt(hex.substr(j, 2), 16);
    }
  }
  return out;
}

function deriveKey(passphrase, salt) {
  return scrypt.syncScrypt(
    utf8Encode(passphrase.normalize("NFKC")),
    salt,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    KEY_LEN
  );
}

// saltIn/nonceIn are only passed by tests; production generates them randomly.
function encryptEntries(entries, passphrase, saltIn, nonceIn) {
  const salt = saltIn || randomBytes(SALT_LEN);
  const nonce = nonceIn || randomBytes(NONCE_LEN);
  const key = deriveKey(passphrase, salt);
  const box = nacl.secretbox(utf8Encode(JSON.stringify(entries)), nonce, key);

  const packed = new Uint8Array(SALT_LEN + NONCE_LEN + box.length);
  packed.set(salt, 0);
  packed.set(nonce, SALT_LEN);
  packed.set(box, SALT_LEN + NONCE_LEN);
  return b64Encode(packed);
}

// Inverse of encryptEntries. Throws if the passphrase is wrong or data corrupt.
function decryptEntries(blobB64, passphrase) {
  const packed = b64Decode(String(blobB64).trim());
  if (packed.length <= SALT_LEN + NONCE_LEN) throw new Error("blob-too-short");
  const salt = packed.slice(0, SALT_LEN);
  const nonce = packed.slice(SALT_LEN, SALT_LEN + NONCE_LEN);
  const box = packed.slice(SALT_LEN + NONCE_LEN);
  const key = deriveKey(passphrase, salt);
  const msg = nacl.secretbox.open(box, nonce, key);
  if (!msg) throw new Error("decrypt-failed");
  return JSON.parse(utf8Decode(msg));
}

// --- Scriptable-only I/O ---

function getFM() {
  try { return FileManager.iCloud(); }
  catch (e) { return FileManager.local(); }
}

function readAllEntries() {
  const ifm = getFM();
  const dir = ifm.documentsDirectory();
  let all = [];
  for (const name of ifm.listContents(dir)) {
    if (!/^locationsStore.*\.json$/i.test(name)) continue;
    const p = ifm.joinPath(dir, name);
    try {
      ifm.downloadFileFromiCloud(p);
    } catch (e) {
      // offline / already local — fall through to read whatever we have
    }
    try {
      const parsed = JSON.parse(ifm.readString(p));
      if (Array.isArray(parsed)) all = all.concat(parsed);
    } catch (e) {
      // skip unreadable/invalid file
    }
  }
  return all;
}

function kc(key) {
  return Keychain.contains(key) ? Keychain.get(key) : null;
}

// Find the existing yearly file for `year`, tolerating the widget's naming
// ("locationsStore 2025.json") and a space-less variant. Falls back to the
// widget's own convention when none exists yet.
function yearFileName(ifm, dir, year) {
  const re = new RegExp("^locationsStore\\D*" + year + "\\.json$", "i");
  for (const name of ifm.listContents(dir)) {
    if (re.test(name)) return name;
  }
  return `locationsStore ${year}.json`;
}

const dayKey = (ms) => new Date(ms).toDateString();

// Reconcile one year's list against the authoritative desired filled set.
// Everything is keyed on isoCountryCode + calendar day (never the country NAME,
// which can differ by locale and would otherwise create duplicates):
//   - keep real entries untouched,
//   - keep a `filled` entry only if it's still desired AND not a duplicate,
//   - add desired fills not already present (real or filled).
function reconcileYear(list, patchesForYear, desired) {
  let removed = 0;
  const keptFilledKeys = new Set();
  const kept = [];
  for (const l of list) {
    if (!l || l.filled !== true) { kept.push(l); continue; } // real → untouchable
    const k = l.isoCountryCode + "|" + dayKey(l.date);
    if (!desired.has(k) || keptFilledKeys.has(k)) { removed++; continue; } // undone/edited or duplicate
    keptFilledKeys.add(k);
    kept.push(l);
  }
  let added = 0;
  for (const p of patchesForYear) {
    const dk = dayKey(p.date);
    const exists = kept.some(
      (l) => l.isoCountryCode === p.isoCountryCode && dayKey(l.date) === dk
    );
    if (!exists) {
      kept.push({ country: p.country, isoCountryCode: p.isoCountryCode, date: p.date, filled: true });
      added++;
    }
  }
  kept.sort((a, b) => a.date - b.date);
  return { list: kept, added, removed };
}

// Reconcile an authoritative set of filled entries into the yearly JSON files.
// Shared by the relay path (applyPatches) and the server-less path (applyPatchSet).
function reconcileToFiles(patches) {
  const ifm = getFM();
  const dir = ifm.documentsDirectory();

  const desired = new Set();
  const byYear = {};
  for (const p of patches) {
    if (!p || !p.country || !p.isoCountryCode || !p.date) continue;
    desired.add(p.isoCountryCode + "|" + dayKey(p.date));
    const y = String(new Date(p.date).getFullYear());
    (byYear[y] = byYear[y] || []).push(p);
  }

  // Reconcile every year that has patches OR an existing yearly file (so undone
  // fills are removed even from years no longer present in the set).
  const years = new Set(Object.keys(byYear));
  for (const name of ifm.listContents(dir)) {
    const mth = name.match(/^locationsStore\D*(\d{4})\.json$/i);
    if (mth) years.add(mth[1]);
  }

  let applied = 0;
  let removed = 0;
  for (const year of years) {
    const name = yearFileName(ifm, dir, year);
    const path = ifm.joinPath(dir, name);
    const exists = ifm.fileExists(path);
    if (!exists && !byYear[year]) continue;

    let list = [];
    if (exists) {
      try { ifm.downloadFileFromiCloud(path); } catch (e) {}
      try { list = JSON.parse(ifm.readString(path)) || []; } catch (e) { list = []; }
    }

    const r = reconcileYear(list, byYear[year] || [], desired);
    if (r.added > 0 || r.removed > 0) {
      ifm.writeString(path, JSON.stringify(r.list));
      applied += r.added;
      removed += r.removed;
    }
  }

  return { applied, removed };
}

// Server-less path (QR / deep link): reconcile an authoritative set of fills
// passed in directly, without touching the relay.
function applyPatchSet(entries) {
  if (!Array.isArray(entries)) return { ok: false, reason: "bad-data" };
  const { applied, removed } = reconcileToFiles(entries);
  return { ok: true, applied, removed };
}

// Fetch the PWA's gap repairs from the relay and reconcile them into the yearly
// JSON files. The patches blob is the authoritative set of manual fills, so
// this both ADDS new fills and REMOVES ones the user has undone or edited
// (matched by the `filled` flag; real entries are never removed). Idempotent,
// and short-circuits when the blob hasn't changed since last time.
async function applyPatches() {
  const url = kc("ww_relay_url");
  const id = kc("ww_relay_id");
  const pass = kc("ww_relay_pass");
  if (!url || !id || !pass) return { ok: false, reason: "not-configured" };

  const req = new Request(`${url.replace(/\/+$/, "")}/${id}_patches`);
  req.method = "GET";
  let blob;
  try {
    blob = await req.loadString();
  } catch (e) {
    return { ok: false, reason: "network" };
  }
  const status = req.response ? req.response.statusCode : 0;

  // 200 → decrypt the set. 404 → no mailbox; treat as an empty set so we can
  // still remove fills the user undid. Anything else is a real error.
  let patches = [];
  if (status === 200) {
    blob = (blob || "").trim();
    if (blob && kc("ww_patches_seen") === blob) {
      return { ok: true, applied: 0, removed: 0, skipped: true };
    }
    if (blob) {
      try {
        patches = decryptEntries(blob, pass);
      } catch (e) {
        return { ok: false, reason: "decrypt" };
      }
      if (!Array.isArray(patches)) return { ok: false, reason: "decrypt" };
    }
  } else if (status === 404) {
    blob = "";
  } else {
    return { ok: false, reason: "network", status };
  }

  const { applied, removed } = reconcileToFiles(patches);

  if (blob) Keychain.set("ww_patches_seen", blob);
  else if (Keychain.contains("ww_patches_seen")) Keychain.remove("ww_patches_seen");
  return { ok: true, applied, removed };
}

// Encrypt every stored entry and PUT it to the relay. Returns a small status.
async function pushToRelay() {
  const url = kc("ww_relay_url");
  const id = kc("ww_relay_id");
  const pass = kc("ww_relay_pass");
  if (!url || !id || !pass) return { ok: false, reason: "not-configured" };

  const entries = readAllEntries();
  const blob = encryptEntries(entries, pass);

  const req = new Request(`${url.replace(/\/+$/, "")}/${id}`);
  req.method = "PUT";
  req.headers = { "Content-Type": "text/plain" };
  req.body = blob;
  await req.loadString();
  const status = req.response ? req.response.statusCode : 0;
  return { ok: status === 200, status, count: entries.length };
}

module.exports = { pushToRelay, applyPatches, applyPatchSet, encryptEntries, decryptEntries, readAllEntries };
