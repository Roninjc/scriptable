// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: red; icon-glyph: code-branch;
/**
 * 🧩 pull.js
 * Only to use inside Scriptable app.
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
 *  1️⃣ Keychain must contain your GitHub token: Keychain.set("github_scriptable_token", "ghp_xxx")
 *  2️⃣ Update your GitHub username/repository below.
 */

const { computeHash, errorAlert, fetchGitHubJSON, loadFmJSON } = importModule('Git');

// --- Helper Functions ---
// async function fetchGitHubJSON(path) {
//   const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${BRANCH}`;
//   const req = new Request(apiUrl);
//   req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePull" };
//   const res = await req.loadJSON();
//   if (!res.content) throw new Error(`No content found for ${path}`);
//   const base64Content = res.content.replace(/\n/g, '');
//   const decoded = Data.fromBase64String(base64Content).toRawString();
//   return JSON.parse(decoded);
// }

// async function fetchGitHubFile(path) {
//   const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${BRANCH}`;
//   const req = new Request(apiUrl);
//   req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePull" };
//   const res = await req.loadJSON();
//   if (!res.content) throw new Error(`No content found at ${path}`);
//   return Data.fromBase64String(res.content).toRawString();
// }

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

// --- Main Script ---
const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const configPath = fm.joinPath(dir, "config/config.json");
const metaFilePath = fm.joinPath(dir, "config/scripts-meta.json");

let config = {};
if (fm.fileExists(configPath)) {
  try {
    config = JSON.parse(fm.readString(configPath));
  } catch (e) {
    errorAlert("❌ Error parsing config.json", e.toString());
    return;
  }
} else {
  errorAlert("❌ config.json not found", "Please create a config.json file in your Scriptable root folder with your GitHub settings.");
  return;
}

// --- Configuration  vars ---
const GITHUB_USER = config.GITHUB_USER || "YourUser";
const GITHUB_REPO = config.GITHUB_REPO || "scriptable";
const BRANCH = config.BRANCH || "main";
const META_FILE = config.META_FILE || "config/scripts-meta.json";

const githubRepo = `${GITHUB_USER}/${GITHUB_REPO}`;
const githubToken = Keychain.get("github_scriptable_token");

// --- Load local & remote metadata ---
const localMeta = loadFmJSON(fm, metaFilePath);
console.log("📄 Local meta loaded:", JSON.stringify(localMeta, null, 2));

let remoteMeta;
try {
  remoteMeta = await fetchGitHubJSON(githubToken, githubRepo, META_FILE, BRANCH);
  console.log("☁️ Remote meta loaded.");
} catch (e) {
  errorAlert("❌ Error fetching remote meta", e.toString());
  return;
}

// --- Compare scripts ---
const updates = [];
const newScripts = [];
const conflicts = [];
const skipped = [];

for (const [name, remoteData] of Object.entries(remoteMeta)) {
  const localData = localMeta[name] || {};
  const localPath = fm.joinPath(dir, `${name}.js`);
  const existsLocally = fm.fileExists(localPath);

  const localSavedHash = localData.hash || null;
  const localGeneratedHash = existsLocally ? computeHash(fm.readString(localPath)) : null;
  const remoteHash = remoteData.hash || null;

  const vLocal = localData.version || "0.0.0";
  const vRemote = remoteData.version || "0.0.0";
  const cmp = compareVersions(vRemote, vLocal);

  if (!existsLocally) {
    newScripts.push({ name, ...remoteData, reason: "missing locally" });
  }
  else if (localGeneratedHash === remoteHash) {
    skipped.push({ name, reason: "identical content" });
  }
  else if (cmp > 0) {
    if (localGeneratedHash !== localSavedHash) {
      conflicts.push({ name, ...remoteData, reason: "remote newer version + local edits" });
    } else {
      updates.push({ name, ...remoteData, reason: "remote newer version" });
    }
  }
  else if (cmp === 0) {
    if (localGeneratedHash !== remoteHash) {
      conflicts.push({ name, ...remoteData, reason: "same version but different content" });
    } else {
      skipped.push({ name, reason: "same version + identical content" });
    }
  }
  else if (cmp < 0) {
    if (localGeneratedHash !== remoteHash) {
      conflicts.push({ name, ...remoteData, reason: "local newer version + content differs" });
    } else {
      skipped.push({ name, reason: "local newer version but identical content" });
    }
  }
}

console.log(`🆕 New: ${newScripts.length}, ⬆️ Updates: ${updates.length}, ⚠️ Conflicts: ${conflicts.length}, ⏭️ Skipped: ${skipped.length}`);
console.log(`conflicts: ${JSON.stringify(conflicts)}`)

// --- Main menu ---
const menu = new Alert();
menu.title = "📦 Script Updates";

let message = "";
if (newScripts.length) message += `🆕 New: ${newScripts.map(s => s.name).join(", ")}\n`;
if (updates.length) message += `⬆️ Updates: ${updates.map(s => s.name).join(", ")}\n`;
if (conflicts.length) message += `⚠️ Conflicts: ${conflicts.map(s => s.name).join(", ")}\n`;
if (!(newScripts.length + updates.length > 0)) message += "No possible updates.";
if (!message) message = "✅ All scripts up to date!";

menu.message = message;
if (newScripts.length + updates.length > 0) {
  menu.addAction("Update All");
  menu.addAction("Choose");
  menu.addCancelAction("Cancel");
} else {
  menu.addCancelAction("OK");
}

const choice = await menu.present();
if (choice === -1) return;
let selectedScripts = [];

if (choice === 0) {
  selectedScripts = [...newScripts, ...updates];
} else if (choice === 1) {
  const allOptions = [...newScripts, ...updates];
  if (!allOptions.length) {
    const alert = new Alert();
    alert.title = "✅ Nothing to update";
    alert.message = "All scripts are already up to date.";
    alert.addAction("OK");
    await alert.present();
    return;
  }

  const selected = new Set();

  let doneSelecting = false;
  while (!doneSelecting) {
    const pick = new Alert();
    pick.title = "Select scripts to update";
    pick.message = "Tap to toggle selection.\nWhen done, tap 'Download Selected'.";

    for (const s of allOptions) {
      const prefix = selected.has(s.name) ? "✅ " : "⬜️ ";
      pick.addAction(prefix + s.name);
    }

    pick.addAction("⬇️ Download Selected");
    pick.addCancelAction("Cancel");
    const res = await pick.present();

    if (res === -1) return;

    if (res === allOptions.length) {
      doneSelecting = true;
      continue;
    }

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
  const remotePath = script.type + "s/" + encodeURIComponent(script.name) + ".js";

  try {
    const content = await fetchGitHubFile(githubRepo, githubToken, remotePath, BRANCH);
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
fm.writeString(metaFilePath, JSON.stringify(localMeta, null, 2));

// --- Done ---
const done = new Alert();
done.title = "✅ Update complete";
done.message = selectedScripts.map(s => `${s.name}: v${s.version}`).join("\n");
done.addAction("OK");
await done.present();
