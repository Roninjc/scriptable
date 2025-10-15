// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: code-branch;
/**
 * 🧩 push.js
 * Uploads selected Scriptable scripts to your GitHub repository and updates scripts-meta.json.
 *
 * Features:
 *  - Authenticates using GitHub token stored in Keychain ("github_scriptable_token").
 *  - Reads scripts-meta.json directly from the remote repo.
 *  - Lets you choose multiple scripts to upload.
 *  - Automatically updates version, type (first time only), and lastUpdated.
 *
 * Prerequisites:
 *  1️⃣ Save your GitHub token once: Keychain.set("github_scriptable_token", "ghp_xxx")
 *  2️⃣ Update your GitHub username and repo below.
 */

const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const configPath = fm.joinPath(dir, "config/config.json");
const metaFilePath = fm.joinPath(dir, "config/scripts-meta.json");

let config = {};
if (fm.fileExists(configPath)) {
  try {
    config = JSON.parse(fm.readString(configPath));
  } catch (e) {
    const alert = new Alert();
    alert.title = "❌ Error parsing config.json";
    alert.message = e.toString();
    alert.addAction("OK");
    await alert.present();
    return;
  }
} else {
  const alert = new Alert();
  alert.title = "❌ config.json not found";
  alert.message = "Please create a config.json file in your Scriptable root folder with your GitHub settings.";
  alert.addAction("OK");
  await alert.present();
  return;
}

// --- Configuration  vars ---
const GITHUB_USER = config.GITHUB_USER || "YourUser";
const GITHUB_REPO = config.GITHUB_REPO || "scriptable";
const BRANCH = config.BRANCH || "main";

const META_FILE = "config/scripts-meta.json";

const githubRepo = `${GITHUB_USER}/${GITHUB_REPO}`;
const githubToken = Keychain.get("github_scriptable_token");
if (!githubToken) throw new Error("❌ Missing GitHub token in Keychain.");

// --- Fetch remote scripts-meta.json ---
let meta = {};
const metaUrl = `https://raw.githubusercontent.com/${githubRepo}/${BRANCH}/${META_FILE}`;
try {
  const req = new Request(metaUrl);
  meta = await req.loadJSON();
  console.log("✅ Loaded remote scripts-meta.json");
} catch (e) {
  const alert = new Alert();
  alert.title = "❌ Error fetching remote meta";
  alert.message = e.toString();
  alert.addAction("OK");
  await alert.present();
  return;
}

// --- Get local .js files ---
const files = fm.listContents(dir).filter(f => f.endsWith(".js"));
if (files.length === 0) {
  const alert = new Alert();
  alert.title = "No .js files found";
  alert.message = "Make sure you have scripts in your iCloud Scriptable directory.";
  alert.addAction("OK");
  await alert.present();
  return;
}

// --- Multi-select scripts ---
let selected = new Set();
while (true) {
  const menu = new Alert();
  menu.title = "Select scripts to push";
  menu.message = "Tap to toggle selection.\nThen tap 'Push Selected'.";
  files.forEach(f => menu.addAction((selected.has(f) ? "✅ " : "⬜️ ") + f));
  menu.addAction("🚀 Push Selected");
  menu.addCancelAction("Cancel");
  const choice = await menu.present();
  if (choice === -1) return; // cancel
  if (choice === files.length) break; // push
  const chosen = files[choice];
  selected.has(chosen) ? selected.delete(chosen) : selected.add(chosen);
}
if (selected.size === 0) return;

const selectedFiles = Array.from(selected);

// --- Helper: bump version ---
function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
  if (type === "major") {
    parts[0]++; parts[1] = 0; parts[2] = 0;
  } else if (type === "minor") {
    parts[1]++; parts[2] = 0;
  } else {
    parts[2]++;
  }
  return parts.join(".");
}

// --- Process each selected file ---
for (const fileName of selectedFiles) {
  const filePath = fm.joinPath(dir, fileName);
  const content = fm.readString(filePath);
  const existing = meta[fileName] || {};

  // Get or ask for script type (first time only)
  let type = existing.type;
  if (!type) {
    const typeAlert = new Alert();
    typeAlert.title = `Select type for ${fileName}`;
    typeAlert.addAction("widget");
    typeAlert.addAction("helper");
    typeAlert.addAction("script");
    typeAlert.addCancelAction("Cancel");
    const typeChoice = await typeAlert.present();
    if (typeChoice === -1) continue;
    type = ["widget", "helper", "script"][typeChoice];
  }

  // Determine version bump
  let currentVersion = existing.version || "0.0.0";
  const bump = new Alert();
  bump.title = `${fileName} current: v${currentVersion}`;
  bump.message = "Select version bump type:";
  bump.addAction("Major");
  bump.addAction("Minor");
  bump.addAction("Patch");
  bump.addCancelAction("Cancel");
  const bumpChoice = await bump.present();
  if (bumpChoice === -1) continue;
  const bumpType = ["major", "minor", "patch"][bumpChoice];
  const newVersion = bumpVersion(currentVersion, bumpType);

  const now = new Date().toISOString();

  // Update meta info locally
  meta[fileName] = {
    version: newVersion,
    type: type,
    lastUpdated: now
  };

  // --- Upload script file to GitHub ---
  const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${type}s/${encodeURIComponent(fileName)}`;
  let sha = null;
  try {
    const req = new Request(apiUrl);
    req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
    const resp = await req.loadJSON();
    sha = resp.sha;
  } catch {
    console.log(`🆕 Creating new file: ${fileName}`);
  }

  const upload = new Request(apiUrl);
  upload.method = "PUT";
  upload.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
  upload.body = JSON.stringify({
    message: `Update ${fileName} to v${newVersion}`,
    content: Data.fromString(content).toBase64String(),
    sha: sha,
    branch: BRANCH
  });

  const res = await upload.loadJSON();
  if (upload.response.statusCode >= 200 && upload.response.statusCode < 300) {
    console.log(`✅ Uploaded ${fileName} v${newVersion}`);
  } else {
    console.error(`❌ Failed to upload ${fileName}: ${JSON.stringify(res)}`);
  }
}

// --- Upload updated scripts-meta.json ---
console.log("📝 Uploading updated scripts-meta.json...");
const metaApiUrl = `https://api.github.com/repos/${githubRepo}/contents/config/${META_FILE}`;
let metaSha = null;
try {
  const req = new Request(metaApiUrl);
  req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
  const resp = await req.loadJSON();
  metaSha = resp.sha;
} catch {
  console.log("🆕 Creating new scripts-meta.json...");
}

const metaUpload = new Request(metaApiUrl);
metaUpload.method = "PUT";
metaUpload.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
metaUpload.body = JSON.stringify({
  message: "Update scripts-meta.json",
  content: Data.fromString(JSON.stringify(meta, null, 2)).toBase64String(),
  sha: metaSha,
  branch: BRANCH
});

const metaRes = await metaUpload.loadJSON();
if (metaUpload.response.statusCode >= 200 && metaUpload.response.statusCode < 300) {
  try {
    fm.writeString(metaFilePath, JSON.stringify(meta, null, 2));
  } catch (e) {
    const errorAlert = new Alert();
    errorAlert.title = "❌ Error saving scripts-meta.json";
    errorAlert.message = e.toString();
    errorAlert.addAction("OK");
    await errorAlert.present();
  }
} else {
  const errorAlert = new Alert();
  errorAlert.title = "❌ Failed to upload scripts-meta.json";
  errorAlert.message = JSON.stringify(metaRes);
  errorAlert.addAction("OK");
  await errorAlert.present();
}

// --- Done ---
const doneAlert = new Alert();
doneAlert.title = "✅ Upload complete";
doneAlert.message = selectedFiles
  .map(f => `${f}: v${meta[f].version} (${meta[f].type})`)
  .join("\n");
doneAlert.addAction("OK");
await doneAlert.present();
