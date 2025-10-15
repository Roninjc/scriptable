/**
 * 🧩 pull.js
 * Synchronizes your local Scriptable scripts with the GitHub repository.
 *
 * Features:
 *  - Fetches remote scripts-meta.json from GitHub.
 *  - Compares local vs remote versions and timestamps.
 *  - Lets you selectively update or install scripts.
 *  - Detects conflicts if local changes are newer.
 *  - Updates local scripts-meta.json automatically.
 *
 * Prerequisites:
 *  1️⃣ Keychain must contain your GitHub token:
 *      Keychain.set("github_token", "ghp_yourTokenHere")
 *  2️⃣ Update your GitHub username/repository below.
 */

const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const configPath = fm.joinPath(dir, "config/config.json");
const metaFilePath = fm.joinPath(dir, "config/scripts-meta.json");

// --- Helper Functions ---
function loadJSON(path) {
  if (!fm.fileExists(path)) return {};
  try {
    return JSON.parse(fm.readString(path));
  } catch (e) {
    console.error(`Error parsing JSON at ${path}:`, e);
    return {};
  }
}

function saveJSON(path, data) {
  fm.writeString(path, JSON.stringify(data, null, 2));
}

async function fetchGitHubJSON(path) {
  const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${BRANCH}`;
  const req = new Request(apiUrl);
  req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePull" };
  const res = await req.loadJSON();
  if (!res.content) throw new Error(`No content found for ${path}`);
  const decoded = Data.fromBase64String(res.content).toRawString();
  return JSON.parse(decoded);
}

async function fetchGitHubFile(path) {
  const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${BRANCH}`;
  const req = new Request(apiUrl);
  req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePull" };
  const res = await req.loadJSON();
  if (!res.content) throw new Error(`No content found at ${path}`);
  return Data.fromBase64String(res.content).toRawString();
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

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

const githubRepo = `${GITHUB_USER}/${GITHUB_REPO}`;
const githubToken = Keychain.get("github_token");

// --- Load local & remote metadata ---
const localMeta = loadJSON(metaFilePath);
console.log("📄 Local meta loaded:", JSON.stringify(localMeta, null, 2));

let remoteMeta;
try {
  remoteMeta = await fetchGitHubJSON("config/scripts-meta.json");
  console.log("☁️ Remote meta loaded.");
} catch (e) {
  const alert = new Alert();
  alert.title = "❌ Error fetching remote meta";
  alert.message = e.toString();
  alert.addAction("OK");
  await alert.present();
  return;
}

// --- Compare scripts ---
const updates = [];
const newScripts = [];
const conflicts = [];

for (const [name, remoteData] of Object.entries(remoteMeta)) {
  const localData = localMeta[name];
  const localPath = fm.joinPath(dir, `${name}.js`);
  const existsLocally = fm.fileExists(localPath);

  if (!existsLocally) {
    newScripts.push({ name, ...remoteData });
    continue;
  }

  if (!localData) {
    updates.push({ name, ...remoteData, reason: "missing metadata" });
    continue;
  }

  const cmp = compareVersions(remoteData.version, localData.version);
  const localModDate = fm.modificationDate(localPath);
  const remoteUpdated = new Date(remoteData.lastUpdated);

  if (cmp > 0) {
    updates.push({ name, ...remoteData, reason: "newer version" });
  } else if (localModDate > remoteUpdated && cmp === 0) {
    conflicts.push({ name, ...remoteData, reason: "local newer" });
  }
}

console.log(`🆕 New: ${newScripts.length}, ⬆️ Updates: ${updates.length}, ⚠️ Conflicts: ${conflicts.length}`);

// --- Main menu ---
const menu = new Alert();
menu.title = "📦 Script Updates";

let message = "";
if (newScripts.length) message += `🆕 New: ${newScripts.map(s => s.name).join(", ")}\n`;
if (updates.length) message += `⬆️ Updates: ${updates.map(s => s.name).join(", ")}\n`;
if (conflicts.length) message += `⚠️ Conflicts: ${conflicts.map(s => s.name).join(", ")}\n`;
if (!message) message = "✅ All scripts up to date!";

menu.message = message;
menu.addAction("Update All");
menu.addAction("Choose");
menu.addCancelAction("Cancel");

const choice = await menu.present();
if (choice === -1) return;
let selectedScripts = [];

if (choice === 0) {
  selectedScripts = [...newScripts, ...updates];
} else if (choice === 1) {
  const allOptions = [...newScripts, ...updates];
  let selected = new Set();

  while (true) {
    const pick = new Alert();
    pick.title = "Select scripts to update";
    pick.message = "Tap to toggle selection.\nWhen done, tap 'Download Selected'.";
    allOptions.forEach(s => {
      const prefix = selected.has(s.name) ? "✅ " : "⬜️ ";
      pick.addAction(prefix + s.name);
    });
    pick.addAction("⬇️ Download Selected");
    pick.addCancelAction("Cancel");
    const res = await pick.present();
    if (res === -1) return;
    if (res === allOptions.length) break;

    const chosen = allOptions[res].name;
    if (selected.has(chosen)) selected.delete(chosen);
    else selected.add(chosen);
  }

  selectedScripts = [...newScripts, ...updates].filter(s => selected.has(s.name));
}

if (!selectedScripts.length) {
  const alert = new Alert();
  alert.title = "No scripts selected";
  alert.addAction("OK");
  await alert.present();
  return;
}

// --- Download selected scripts ---
for (const script of selectedScripts) {
  const remotePath = (script.type === "helper" ? "helpers/" : "scripts/") + encodeURIComponent(script.name) + ".js";

  try {
    const content = await fetchGitHubFile(remotePath);
    const localPath = fm.joinPath(dir, `${script.name}.js`);
    fm.writeString(localPath, content);
    localMeta[script.name] = {
      version: script.version,
      type: script.type,
      lastUpdated: new Date().toISOString()
    };
    console.log(`✅ Updated ${script.name} to v${script.version}`);
  } catch (e) {
    console.error(`❌ Failed to download ${script.name}: ${e}`);
  }
}

// --- Save local meta ---
saveJSON(metaFilePath, localMeta);

// --- Done ---
const done = new Alert();
done.title = "✅ Update complete";
done.message = selectedScripts.map(s => `${s.name}: v${s.version}`).join("\n");
done.addAction("OK");
await done.present();
