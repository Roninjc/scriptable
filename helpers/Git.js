// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: magic;

module.exports.computeHash = (str) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(16);  
}


module.exports.loadFmJSON = (fm, path) => {
  if (!fm.fileExists(path)) return {};
  try {
    return JSON.parse(fm.readString(path));
  } catch (e) {
    console.error(`Error parsing JSON at ${path}:`, e);
    return {};
  }
}

module.exports.errorAlert = async (title, message) => {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction("OK");
  await alert.present();
}

async function fetchAndDecodeGitHubFile(githubToken, githubRepo, path, BRANCH) {
  if (!githubToken || !githubRepo || !path || !BRANCH) {
    throw new Error("Missing parameters for fetchAndDecodeGitHubFile");
  }
  const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/${path}?ref=${BRANCH}`;
  const req = new Request(apiUrl);
  req.headers = { Authorization: `token ${githubToken}`, "User-Agent": "ScriptablePull" };
  const res = await req.loadJSON();
  if (!res.content) throw new Error(`No content found at ${path}`);
  const base64Content = res.content.replace(/\n/g, '');
  return Data.fromBase64String(base64Content).toRawString();
}

module.exports.fetchGitHubFile = async (githubToken, githubRepo, path, BRANCH) => {
  const decoded = await fetchAndDecodeGitHubFile(githubToken, githubRepo, path, BRANCH);
  return decoded;
}

module.exports.fetchGitHubJSON = async (githubToken, githubRepo, path, BRANCH) => {
  const decoded = await fetchAndDecodeGitHubFile(githubToken, githubRepo, path, BRANCH);
  return JSON.parse(decoded);
}
