// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: moon;

/**
 * SetActiveBackground — single entry point for Focus-mode automations
 *
 * Resolves the current Focus mode to a background key using the central
 * registry (bg-config.json, see helpers/BackgroundConfig) and writes it to
 * defbg.txt, which SetWidgetBackground reads. Replaces the per-focus
 * hardcoded strings that used to live inside each Shortcuts automation.
 *
 * Shortcuts setup (ONE shared shortcut, e.g. "Sync Widget Background"):
 *   1. Get Current Focus
 *   2. Run Scriptable script: "SetActiveBackground", parameter: Current Focus (Name)
 * Then every Focus automation ("When <focus> turns On" AND "turns Off") just
 * runs that shortcut — no keys inside automations anymore. A focus with no
 * mapping (or no focus at all) falls back to the default key, and you get a
 * notification so you know a mapping is missing.
 *
 * Run it manually inside Scriptable to pick the active background by hand.
 */

const bg = importModule("BackgroundConfig")

const cfg = await bg.load()
const param = args.shortcutParameter

/* Manual mode: run from the app with no parameter -> pick a key */
if (config.runsInApp && (param === null || param === undefined)) {
  if (cfg.keys.length === 0) {
    const alert = new Alert()
    alert.message = "No keys registered yet. Run GenerateWidgetBackgrounds first."
    alert.addAction("OK")
    await alert.presentAlert()
    return
  }
  const active = await bg.getActiveKey()
  const alert = new Alert()
  alert.title = "Active widget background"
  alert.message = active ? `Current: ${active}` : "No background active."
  for (const key of cfg.keys) alert.addAction(key == active ? `${key} ✓` : key)
  alert.addCancelAction("Cancel")
  const index = await alert.presentSheet()
  if (index == -1) return
  bg.setActiveKey(cfg.keys[index])
  return
}

/* Automation mode: resolve focus name -> key */
const focusName = (param ?? "").toString().trim()
const { key, mapped } = bg.resolveKey(cfg, focusName)

if (!key) {
  console.warn(`[SETACTIVEBG] No key for focus "${focusName}" and no default key configured.`)
  Script.setShortcutOutput("")
  return Script.complete()
}

const current = await bg.getActiveKey()
if (current != key) bg.setActiveKey(key)

if (!mapped) {
  const notification = new Notification()
  notification.title = "Widget background"
  notification.body = `Focus "${focusName}" has no background key mapped — using default "${key}". Map it in ManageBackgrounds.`
  await notification.schedule()
}

Script.setShortcutOutput(key)
Script.complete()
