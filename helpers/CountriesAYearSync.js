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

module.exports = { pushToRelay, encryptEntries, readAllEntries };
