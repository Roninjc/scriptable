// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: tasks;

/**
 * ManageBackgrounds — inspect and maintain the widget background registry
 *
 * Everything reads/writes the central bg-config.json (helpers/BackgroundConfig):
 *   - Status: active key, default key, focus mappings and image coverage per key
 *   - Map a Focus mode to a key / remove mappings
 *   - Set the default key (used when no focus or an unmapped focus is active)
 *   - Delete a key: removes its images from Backgrounds/ AND its config entries
 *   - Clean orphans: images on disk whose key is not registered (e.g. typos)
 */

const bg = importModule("BackgroundConfig")

const EXPECTED = Object.values(bg.LAYOUT).flat().length * bg.APPEARANCES.length // 22

while (true) {
  const cfg = await bg.load()
  const menu = new Alert()
  menu.title = "Manage widget backgrounds"
  menu.addAction("Status")
  menu.addAction("Map focus mode → key")
  menu.addAction("Remove a focus mapping")
  menu.addAction("Set default key")
  menu.addAction("Delete a key (config + images)")
  menu.addAction("Clean orphan images")
  menu.addCancelAction("Done")
  const choice = await menu.presentSheet()

  if (choice == -1) break
  if (choice == 0) await showStatus(cfg)
  if (choice == 1) await mapFocus(cfg)
  if (choice == 2) await unmapFocus(cfg)
  if (choice == 3) await setDefault(cfg)
  if (choice == 4) await deleteKey(cfg)
  if (choice == 5) await cleanOrphans(cfg)
}

Script.complete()

async function showStatus(cfg) {
  const active = await bg.getActiveKey()
  const lines = []
  lines.push(`Active: ${active || "(none)"}`)
  lines.push(`Default: ${cfg.defaultKey || "(not set)"}`)

  lines.push("", "Keys (images found / expected):")
  if (cfg.keys.length == 0) lines.push("  (none registered)")
  for (const key of cfg.keys) {
    const count = bg.imagePathsFor(key).length
    const focuses = Object.entries(cfg.focusModes)
      .filter(([, k]) => k == key)
      .map(([f]) => f)
    const mark = count == EXPECTED ? "✓" : "⚠️"
    lines.push(`  ${mark} ${key}: ${count}/${EXPECTED}${focuses.length ? ` ← ${focuses.join(", ")}` : ""}`)
  }

  const unmapped = Object.keys(cfg.focusModes).filter((f) => !cfg.keys.includes(cfg.focusModes[f]))
  if (unmapped.length) {
    lines.push("", "⚠️ Mappings pointing to unregistered keys:")
    for (const f of unmapped) lines.push(`  ${f} → ${cfg.focusModes[f]}`)
  }

  const orphans = bg.keysOnDisk().filter((k) => !cfg.keys.includes(k))
  if (orphans.length) {
    lines.push("", `⚠️ Orphan keys on disk: ${orphans.join(", ")}`)
  }

  await info(lines.join("\n"))
}

async function mapFocus(cfg) {
  if (cfg.keys.length == 0) {
    return await info("No keys registered yet. Run GenerateWidgetBackgrounds first.")
  }
  const nameAlert = new Alert()
  nameAlert.message = "Focus mode name, exactly as iOS shows it (what 'Get Current Focus' returns):"
  nameAlert.addTextField("e.g. Trabajo", "")
  nameAlert.addAction("OK")
  nameAlert.addCancelAction("Cancel")
  if (await nameAlert.presentAlert() == -1) return
  const focus = nameAlert.textFieldValue(0).trim()
  if (!focus) return

  const key = await pickKey(cfg, `Key for focus "${focus}":`)
  if (!key) return
  cfg.focusModes[focus] = key
  bg.save(cfg)
  await info(`Mapped "${focus}" → ${key}`)
}

async function unmapFocus(cfg) {
  const focuses = Object.keys(cfg.focusModes)
  if (focuses.length == 0) return await info("No focus mappings yet.")
  const alert = new Alert()
  alert.title = "Remove which mapping?"
  for (const f of focuses) alert.addAction(`${f} → ${cfg.focusModes[f]}`)
  alert.addCancelAction("Cancel")
  const index = await alert.presentSheet()
  if (index == -1) return
  delete cfg.focusModes[focuses[index]]
  bg.save(cfg)
}

async function setDefault(cfg) {
  const key = await pickKey(cfg, `Default key (currently: ${cfg.defaultKey || "not set"}):`)
  if (!key) return
  cfg.defaultKey = key
  bg.save(cfg)
}

async function deleteKey(cfg) {
  const key = await pickKey(cfg, "Delete which key? Its images and mappings are removed too.")
  if (!key) return

  const paths = bg.imagePathsFor(key)
  const confirm = new Alert()
  confirm.message = `Delete "${key}"? This removes ${paths.length} images and its config entries.`
  confirm.addDestructiveAction("Delete")
  confirm.addCancelAction("Cancel")
  if (await confirm.presentAlert() == -1) return

  for (const p of paths) bg.fm.remove(p)
  cfg.keys = cfg.keys.filter((k) => k != key)
  for (const [focus, k] of Object.entries(cfg.focusModes)) {
    if (k == key) delete cfg.focusModes[focus]
  }
  if (cfg.defaultKey == key) cfg.defaultKey = cfg.keys[0] || ""
  bg.save(cfg)

  if ((await bg.getActiveKey()) == key) {
    if (cfg.defaultKey) bg.setActiveKey(cfg.defaultKey)
    await info(`Deleted. Active background was "${key}"; switched to "${cfg.defaultKey || "(none)"}".`)
  } else {
    await info(`Deleted "${key}" (${paths.length} images).`)
  }
}

async function cleanOrphans(cfg) {
  const orphans = bg.keysOnDisk().filter((k) => !cfg.keys.includes(k))
  if (orphans.length == 0) return await info("No orphan images found. All disk keys are registered.")

  const alert = new Alert()
  alert.title = "Orphan keys on disk"
  alert.message = "Images whose key is not in bg-config.json (typos or old keys). Pick one to handle:"
  for (const k of orphans) alert.addAction(`${k} (${bg.imagePathsFor(k).length} images)`)
  alert.addCancelAction("Cancel")
  const index = await alert.presentSheet()
  if (index == -1) return
  const key = orphans[index]

  const action = new Alert()
  action.message = `"${key}": register it as a valid key, or delete its images?`
  action.addAction("Register key")
  action.addDestructiveAction("Delete images")
  action.addCancelAction("Cancel")
  const actionIndex = await action.presentAlert()
  if (actionIndex == -1) return

  if (actionIndex == 0) {
    bg.addKey(cfg, key)
    bg.save(cfg)
    await info(`Registered "${key}".`)
  } else {
    const paths = bg.imagePathsFor(key)
    for (const p of paths) bg.fm.remove(p)
    await info(`Deleted ${paths.length} images for "${key}".`)
  }
}

async function pickKey(cfg, message) {
  if (cfg.keys.length == 0) {
    await info("No keys registered yet.")
    return null
  }
  const alert = new Alert()
  alert.message = message
  for (const key of cfg.keys) alert.addAction(key)
  alert.addCancelAction("Cancel")
  const index = await alert.presentSheet()
  return index == -1 ? null : cfg.keys[index]
}

async function info(message) {
  const alert = new Alert()
  alert.message = message
  alert.addAction("OK")
  await alert.presentAlert()
}
