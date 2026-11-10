// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: flag-checkered;
/**
 * Round flag icons (PNG, 128px) cached in Documents/Flags/<ISO>.png.
 * The PNGs live in this repo under assets/flags/ (rendered from the MIT-licensed
 * circle-flags project) and are fetched on demand with the GitHub token in the Keychain,
 * so the widget works offline once a country's flag has been cached.
 *
 *   load(fm, dir, isos, { download })  → { ISO: Image } for the flags available
 *   ensure(fm, dir, isos)              → downloads the missing ones, returns how many
 */

const REMOTE_DIR = 'assets/flags'
const MAX_DOWNLOADS = 8 // per run: keeps a widget refresh short even on a bad connection

const flagPath = (fm, dir, iso) => fm.joinPath(fm.joinPath(dir, 'Flags'), `${iso}.png`)

function readConfig(fm, dir) {
  try { return JSON.parse(fm.readString(fm.joinPath(dir, 'config/config.json'))) } catch (e) { return {} }
}

async function downloadOne(fm, dir, iso, cfg, token) {
  const repo = `${cfg.GITHUB_USER || 'YourUser'}/${cfg.GITHUB_REPO || 'scriptable'}`
  const req = new Request(`https://api.github.com/repos/${repo}/contents/${REMOTE_DIR}/${iso}.png?ref=${cfg.BRANCH || 'main'}`)
  req.headers = { Authorization: `token ${token}`, Accept: 'application/vnd.github.raw', 'User-Agent': 'ScriptableFlags' }
  req.timeoutInterval = 8
  const data = await req.load()
  if (req.response.statusCode !== 200) { const err = new Error(`HTTP ${req.response.statusCode}`); err.status = req.response.statusCode; throw err }
  const folder = fm.joinPath(dir, 'Flags')
  if (!fm.fileExists(folder)) fm.createDirectory(folder, true)
  fm.write(flagPath(fm, dir, iso), data)
}

module.exports.ensure = async (fm, dir, isos) => {
  const missing = [...new Set(isos)].filter(iso => !fm.fileExists(flagPath(fm, dir, iso)))
  if (missing.length === 0) return 0
  const token = Keychain.contains('github_scriptable_token') ? Keychain.get('github_scriptable_token') : null
  if (!token) { console.warn('[FLAGS] No GitHub token in Keychain, cannot download flags'); return 0 }
  const cfg = readConfig(fm, dir)
  let done = 0
  for (const iso of missing.slice(0, MAX_DOWNLOADS)) {
    try {
      await downloadOne(fm, dir, iso, cfg, token)
      done++
    } catch (e) {
      console.warn(`[FLAGS] ${iso} not downloaded: ${e}`)
      if (e.status !== 404) break // offline or rate limited: don't hammer the rest
    }
  }
  return done
}

module.exports.load = async (fm, dir, isos, { download = false } = {}) => {
  if (download) {
    try { await module.exports.ensure(fm, dir, isos) } catch (e) { console.warn(`[FLAGS] ensure failed: ${e}`) }
  }
  const images = {}
  for (const iso of new Set(isos)) {
    const path = flagPath(fm, dir, iso)
    if (!fm.fileExists(path)) continue
    try {
      await fm.downloadFileFromiCloud(path) // no-op for local files
      images[iso] = fm.readImage(path)
    } catch (e) {
      console.warn(`[FLAGS] could not read ${iso}: ${e}`)
    }
  }
  return images
}
