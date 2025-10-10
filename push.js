/**
 * 🧩 push.js
 * Uploads a Scriptable file to your GitHub repository and updates its version in versions.json.
 * 
 * Features:
 *  - Authenticates using your GitHub Personal Access Token stored in Keychain.
 *  - Prompts you to choose which file to upload.
 *  - Lets you choose the version bump type: major / minor / patch.
 *  - Updates both the script file and the meta/versions.json file in GitHub.
 *
 * Prerequisites:
 *  1️⃣ Run once in Scriptable: Keychain.set("github_token", "ghp_yourTokenHere")
 *  2️⃣ Update your GitHub username and repository name below.
 */

const GITHUB_USER = "TuUsuario"; // 👈 change this
const GITHUB_REPO = "scriptable";
const BRANCH = "main";

const githubRepo = `${GITHUB_USER}/${GITHUB_REPO}`;
const githubToken = Keychain.get("github_token");

const fm = FileManager.iCloud();
const dir = fm.documentsDirectory();
const metaDir = fm.joinPath(dir, "meta");
const versionsFile = fm.joinPath(metaDir, "versions.json");

// Ensure meta folder exists
if (!fm.fileExists(metaDir)) fm.createDirectory(metaDir, true);

// Load or create versions.json
let versions = {};
if (fm.fileExists(versionsFile)) {
  try {
    versions = JSON.parse(fm.readString(versionsFile));
  } catch (e) {
    console.warn("Error reading versions file:", e);
  }
} else {
  versions = {};
  fm.writeString(versionsFile, JSON.stringify(versions, null, 2));
}

// Multi-select files to upload
const files = fm.listContents(dir).filter(f => f.endsWith(".js"));
if (files.length === 0) {
  const alert = new Alert();
  alert.title = "No .js files found";
  alert.message = "Make sure you have scripts in your iCloud Scriptable directory.";
  alert.addAction("OK");
  await alert.present();
  return;
}

// keep track of selected files
let selected = new Set();

while (true) {
  const menu = new Alert();
  menu.title = "Select scripts to push";
  menu.message = "Tap a file to toggle selection.\nWhen done, tap 'Push Selected'.";
  
  // Add file entries with a checkmark if selected
  files.forEach(f => {
    const prefix = selected.has(f) ? "✅ " : "⬜️ ";
    menu.addAction(prefix + f);
  });
  
  menu.addAction("🚀 Push Selected");
  menu.addCancelAction("Cancel");
  
  const choice = await menu.present();
  if (choice === -1) return; // cancel
  if (choice === files.length) break; // push selected
  
  // toggle selection
  const chosen = files[choice];
  if (selected.has(chosen)) selected.delete(chosen);
  else selected.add(chosen);
}

if (selected.size === 0) {
  const alert = new Alert();
  alert.title = "No files selected";
  alert.message = "Please select at least one script to upload.";
  alert.addAction("OK");
  await alert.present();
  return;
}

const selectedFiles = Array.from(selected);

// Bump version by type
function bumpVersion(version, type) {
  const parts = version.split(".").map(Number);
  if (type === "major") {
    parts[0]++;
    parts[1] = 0;
    parts[2] = 0;
  } else if (type === "minor") {
    parts[1]++;
    parts[2] = 0;
  } else {
    parts[2]++;
  }
  return parts.join(".");
}

// Upload each file
for (const fileName of selectedFiles) {
  const filePath = fm.joinPath(dir, fileName);
  const content = fm.readString(filePath);

  let currentVersion = versions[fileName] || "0.0.0";

  const bump = new Alert();
  bump.title = ` current version: ${currentVersion}`;
  bump.message = "Select version bump type:";
  bump.addAction("Major");
  bump.addAction("Minor");
  bump.addAction("Patch");
  bump.addCancelAction("Cancel");
  const bumpChoice = await bump.present();

  if (bumpChoice === -1) {
    console.log(`Skipped ${fileName}`);
    continue;
  }

  const bumpTypes = ["major", "minor", "patch"];
  const bumpType = bumpTypes[bumpChoice];
  const newVersion = bumpVersion(currentVersion, bumpType);
  console.log(`Pushing ${fileName} (v${currentVersion} → v${newVersion})`);

  // Get SHA if file exists (required for updates)
  const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${encodeURIComponent(fileName)}`;
  let sha = null;
  try {
    const req = new Request(apiUrl);
    req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
    const resp = await req.loadJSON();
    sha = resp.sha;
  } catch (e) {
    console.log(`File ${fileName} not found in repo (creating new).`);
  }

  // Upload request
  try {
    const req = new Request(apiUrl);
    req.method = "PUT";
    req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePush" };
    req.body = JSON.stringify({
      message: `Update ${fileName} to v${newVersion}`,
      content: Data.fromString(content).toBase64String(),
      sha: sha,
      branch: BRANCH
    });

    const res = await req.loadJSON();
    if (req.response.statusCode >= 200 && req.response.statusCode < 300) {
      console.log(`✅ Uploaded ${fileName} v${newVersion}`);
      versions[fileName] = newVersion;
    } else {
      console.error(`❌ Failed to upload ${fileName}: ${JSON.stringify(res)}`);
    }
  } catch (e) {
    console.error(`⚠️ Error uploading ${fileName}: ${e}`);
  }
}

// Save updated versions
fm.writeString(versionsFile, JSON.stringify(versions, null, 2));

const doneAlert = new Alert();
doneAlert.title = "✅ Upload complete";
doneAlert.message = selectedFiles.map(f => `${f}: v${versions[f]}`).join("\n");
doneAlert.addAction("OK");
await doneAlert.present();
