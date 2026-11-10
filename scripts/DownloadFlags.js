// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-download-alt;
/**
 * Download flags
 *
 * Caches the round flag icons (assets/flags/<ISO>.png in the GitHub repo) in
 * Scriptable's Documents/Flags folder for every country in your "locationsStore YYYY.json"
 * files, so the "Countries a year" widget can draw them without network.
 * Run it from the app, or from Shortcuts with the text "all" to cache every flag.
 * Needs the GitHub token in the Keychain (same as Pull/Push).
 */
const flags = importModule('CountryFlags')
const countryEmojis = importModule('CountryEmojis')

function getFM() {
  try {
    const fm = FileManager.iCloud()
    fm.documentsDirectory()
    return fm
  } catch (e) {
    return FileManager.local()
  }
}
const fm = getFM()
const dir = fm.documentsDirectory()

const isos = new Set()
if (args.shortcutParameter === 'all') {
  countryEmojis.forEach(c => isos.add(c.isoCountryCode))
} else {
  for (const name of fm.listContents(dir).filter(n => /^locationsStore .*\.json$/.test(n))) {
    const path = fm.joinPath(dir, name)
    try {
      await fm.downloadFileFromiCloud(path)
      JSON.parse(fm.readString(path)).forEach(l => l.isoCountryCode && isos.add(l.isoCountryCode))
    } catch (e) {
      console.warn(`Could not read ${name}: ${e}`)
    }
  }
}

// ensure() caps each call, so loop until nothing new arrives
let total = 0, n
do { n = await flags.ensure(fm, dir, [...isos]); total += n } while (n > 0)
const have = Object.keys(await flags.load(fm, dir, [...isos])).length

const msg = `${have}/${isos.size} flags cached (${total} downloaded now).`
console.log(msg)
if (!config.runsInWidget && !args.shortcutParameter) {
  const a = new Alert()
  a.title = 'Download flags'
  a.message = msg
  a.addAction('OK')
  await a.present()
}
Script.setShortcutOutput(msg)
Script.complete()
