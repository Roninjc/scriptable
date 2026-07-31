// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cog;

/**
 * BackgroundConfig — central registry for widget background keys
 *
 * Single source of truth for the dynamic widget background system, stored in
 * Scriptable/bg-config.json:
 *
 *   {
 *     "defaultKey": "home",                       // used when no focus (or unmapped focus) is active
 *     "keys": ["home", "work"],                   // every key that images exist (or will exist) for
 *     "focusModes": { "Trabajo": "work", ... }    // Focus mode name -> key
 *   }
 *
 * Consumers:
 *   - SetActiveBackground: resolves focus name -> key and writes defbg.txt
 *   - GenerateWidgetBackgrounds: offers registered keys, registers new ones
 *   - ManageBackgrounds: mappings, coverage, cleanup
 * (SetWidgetBackground keeps reading only defbg.txt and stays untouched.)
 */

const fm = (() => {
  try {
    const m = FileManager.iCloud()
    m.documentsDirectory()
    return m
  } catch (e) {
    return FileManager.local()
  }
})()

const configPath = fm.joinPath(fm.documentsDirectory(), "bg-config.json")
const activeKeyPath = fm.joinPath(fm.documentsDirectory(), "defbg.txt")
const backgroundsRoot = fm.joinPath(fm.documentsDirectory(), "Backgrounds")

// Every folder SetWidgetBackground can look in, and the appearances it expects.
const LAYOUT = {
  small: ["top/left", "top/right", "middle/left", "middle/right", "bottom/left", "bottom/right"],
  medium: ["top", "middle", "bottom"],
  large: ["top", "middle"],
}
const APPEARANCES = ["light", "dark"]

async function load() {
  let cfg = {}
  try {
    if (fm.fileExists(configPath)) {
      await fm.downloadFileFromiCloud(configPath)
      cfg = JSON.parse(fm.readString(configPath))
    }
  } catch (e) {
    console.warn(`[BGCONFIG] Could not read config, starting fresh: ${e}`)
  }
  return {
    defaultKey: typeof cfg.defaultKey === "string" ? cfg.defaultKey : "",
    keys: Array.isArray(cfg.keys) ? cfg.keys : [],
    focusModes: cfg.focusModes && typeof cfg.focusModes === "object" ? cfg.focusModes : {},
  }
}

function save(cfg) {
  fm.writeString(configPath, JSON.stringify(cfg, null, 2))
}

// Keys are folder-safe identifiers; they become file names like "<key>-light.jpg".
function isValidKey(key) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)
}

function addKey(cfg, key) {
  if (!cfg.keys.includes(key)) cfg.keys.push(key)
  if (!cfg.defaultKey) cfg.defaultKey = key
}

// Focus name -> key. Unmapped/absent focus falls back to defaultKey.
function resolveKey(cfg, focusName) {
  const name = (focusName || "").toString().trim()
  return {
    key: (name && cfg.focusModes[name]) || cfg.defaultKey,
    mapped: !name || Boolean(cfg.focusModes[name]),
  }
}

async function getActiveKey() {
  try {
    if (!fm.fileExists(activeKeyPath)) return ""
    await fm.downloadFileFromiCloud(activeKeyPath)
    return fm.readString(activeKeyPath).trim()
  } catch (e) {
    return ""
  }
}

function setActiveKey(key) {
  fm.writeString(activeKeyPath, key)
}

// All image paths a key occupies (existing only unless includeMissing).
function imagePathsFor(key, includeMissing) {
  const paths = []
  for (const [family, positions] of Object.entries(LAYOUT)) {
    for (const position of positions) {
      for (const appearance of APPEARANCES) {
        const p = fm.joinPath(backgroundsRoot, `${family}/${position}/${key}-${appearance}.jpg`)
        if (includeMissing || fm.fileExists(p)) paths.push(p)
      }
    }
  }
  return paths
}

// Distinct keys found on disk by scanning Backgrounds/ file names.
function keysOnDisk() {
  const found = new Set()
  for (const [family, positions] of Object.entries(LAYOUT)) {
    for (const position of positions) {
      const dir = fm.joinPath(backgroundsRoot, `${family}/${position}`)
      if (!fm.isDirectory(dir)) continue
      for (const file of fm.listContents(dir)) {
        const match = file.match(/^(.+)-(light|dark)\.jpg$/)
        if (match) found.add(match[1])
      }
    }
  }
  return [...found].sort()
}

module.exports = {
  fm,
  configPath,
  activeKeyPath,
  backgroundsRoot,
  LAYOUT,
  APPEARANCES,
  load,
  save,
  isValidKey,
  addKey,
  resolveKey,
  getActiveKey,
  setActiveKey,
  imagePathsFor,
  keysOnDisk,
}
