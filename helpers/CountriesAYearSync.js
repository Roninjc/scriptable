// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: magic;
//
// WorldwideSync — end-to-end encrypted publish to the Worldwide relay.
//
// Called from the "Countries a year" widget whenever a NEW location record is
// written. Reads every locationsStore*.json from iCloud, encrypts the merged
// list with a passphrase (kept in the Keychain, never uploaded), and PUTs the
// ciphertext to the relay. The relay only ever stores unreadable bytes.
//
// The crypto format is byte-compatible with the PWA's src/lib/crypto.ts:
//   base64( salt[16] ‖ nonce[24] ‖ nacl.secretbox )
//   key = scrypt(utf8(passphrase.NFKC), salt, N=32768, r=8, p=1, dkLen=32)
//
// This module is also require()-able under Node so the format can be tested
// against the PWA's decryptEntries without a device.

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

function readAllEntries() {
  const ifm = FileManager.iCloud();
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

// Fetch the PWA's gap repairs from the relay and merge them into the yearly
// JSON files. Idempotent: dedups by country + calendar day (like the widget),
// and short-circuits when the patches blob hasn't changed since last time.
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
  if (status === 404) return { ok: true, applied: 0, empty: true };
  if (status !== 200) return { ok: false, reason: "network", status };

  blob = (blob || "").trim();
  if (!blob) return { ok: true, applied: 0, empty: true };
  if (kc("ww_patches_seen") === blob) return { ok: true, applied: 0, skipped: true };

  let patches;
  try {
    patches = decryptEntries(blob, pass);
  } catch (e) {
    return { ok: false, reason: "decrypt" };
  }
  if (!Array.isArray(patches)) return { ok: false, reason: "decrypt" };

  const ifm = FileManager.iCloud();
  const dir = ifm.documentsDirectory();

  // Group by year so each repair lands in its own annual file.
  const byYear = {};
  for (const p of patches) {
    if (!p || !p.country || !p.isoCountryCode || !p.date) continue;
    const y = new Date(p.date).getFullYear();
    (byYear[y] = byYear[y] || []).push(p);
  }

  let applied = 0;
  for (const year of Object.keys(byYear)) {
    const name = yearFileName(ifm, dir, year);
    const path = ifm.joinPath(dir, name);
    let list = [];
    if (ifm.fileExists(path)) {
      try { ifm.downloadFileFromiCloud(path); } catch (e) {}
      try { list = JSON.parse(ifm.readString(path)) || []; } catch (e) { list = []; }
    }
    let changed = false;
    for (const p of byYear[year]) {
      const dayKey = new Date(p.date).toDateString();
      const exists = list.some(
        (l) => l.country === p.country && new Date(l.date).toDateString() === dayKey
      );
      if (!exists) {
        list.push({ country: p.country, isoCountryCode: p.isoCountryCode, date: p.date, filled: true });
        applied++;
        changed = true;
      }
    }
    if (changed) {
      list.sort((a, b) => a.date - b.date);
      ifm.writeString(path, JSON.stringify(list));
    }
  }

  Keychain.set("ww_patches_seen", blob);
  return { ok: true, applied };
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

module.exports = { pushToRelay, applyPatches, encryptEntries, decryptEntries, readAllEntries };
