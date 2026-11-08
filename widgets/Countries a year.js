// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: globe-americas;
/**
 * Countries a year widget
 * 
 * This widget tracks the countries you visit during the year and displays them in a list.
 * It stores the locations data in Scriptable's documents folder: iCloud when Scriptable
 * is set up with iCloud (so it's shared across devices), otherwise local storage.
 */
const countryEmojis = importModule('CountryEmojis')
const { setWidgetBackground } = importModule('SetWidgetBackground')

const date = new Date().getTime()
const year = new Date(date).getFullYear()

function getFM() {
  try {
    const fm = FileManager.iCloud()
    fm.documentsDirectory() // iCloud() never throws on its own; the check runs on first use
    return fm
  } catch (e) {
    return FileManager.local()
  }
}
const ifm = getFM()
const dir = ifm.documentsDirectory()
const pathLoc = ifm.joinPath(dir, `locationsStore ${year}.json`)

/* Offline queue: coordinates captured without internet, reverse-geocoded later */
const pathPending = ifm.joinPath(dir, 'locationsPending.json') // not matched by the sync's locationsStore*.json glob
const SAME_PLACE_KM = 10
const MAX_PENDING_PER_RUN = 5 // reverse geocoding is rate-limited by iOS

const dayKey = (ms) => new Date(ms).toDateString()
const pathForYear = (y) => ifm.joinPath(dir, `locationsStore ${y}.json`)

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin((lon2 - lon1) * rad / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

async function reverseToEntry(latitude, longitude, ts) {
  const res = await Location.reverseGeocode(latitude, longitude, "en_US")
  const { country, isoCountryCode } = res?.[0] ?? {}
  if (!country || !isoCountryCode) throw new Error('empty reverse geocode result')
  return { country, isoCountryCode, date: ts }
}

function readPending() {
  if (!ifm.fileExists(pathPending)) return []
  try {
    const list = JSON.parse(ifm.readString(pathPending))
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

// Queue only a new place or a different day; same day + nearby is redundant.
function queuePending(latitude, longitude, ts) {
  const pending = readPending()
  const known = pending.some(p =>
    dayKey(p.date) === dayKey(ts) && distanceKm(p.latitude, p.longitude, latitude, longitude) < SAME_PLACE_KM)
  if (known) return false
  pending.push({ latitude, longitude, date: ts })
  ifm.writeString(pathPending, JSON.stringify(pending))
  console.log(`Queued pending location (${pending.length} pending)`)
  return true
}

// Resolves queued coordinates oldest-first; stops at the first failure
// (still offline / throttled) and keeps the rest for the next run.
async function resolvePending() {
  const pending = readPending()
  if (pending.length === 0) return []
  pending.sort((a, b) => a.date - b.date)
  const resolved = []
  let done = 0
  for (const p of pending.slice(0, MAX_PENDING_PER_RUN)) {
    try {
      resolved.push(await reverseToEntry(p.latitude, p.longitude, p.date))
      done++
    } catch (e) {
      console.warn(`Pending reverse failed, will retry later: ${e}`)
      break
    }
  }
  if (done > 0) {
    const rest = pending.slice(done)
    if (rest.length > 0) ifm.writeString(pathPending, JSON.stringify(rest))
    else ifm.writeString(pathPending, "[]")
  }
  return resolved
}

async function loadYear(y) {
  const path = pathForYear(y)
  if (!ifm.fileExists(path)) return []
  try {
    ifm.downloadFileFromiCloud(path)
    await new Promise(r => setTimeout(r, 500))
  } catch (e) {
    console.warn("No se pudo descargar el archivo de iCloud:", e)
  }
  return JSON.parse(ifm.readString(path)) || []
}

// Adds entries to their own year's file (a queued entry can belong to a previous
// year). Dedupes by country code + calendar day. Returns how many were added.
function addToStore(entries) {
  const byYear = {}
  for (const e of entries) (byYear[new Date(e.date).getFullYear()] ??= []).push(e)
  let added = 0
  for (const y in byYear) {
    const path = pathForYear(y)
    let list = []
    if (ifm.fileExists(path)) {
      try { ifm.downloadFileFromiCloud(path) } catch (e) {}
      list = JSON.parse(ifm.readString(path)) || []
    }
    let changed = false
    for (const e of byYear[y]) {
      const dup = list.some(l => l.isoCountryCode === e.isoCountryCode && dayKey(l.date) === dayKey(e.date))
      if (!dup) { list.push(e); added++; changed = true }
    }
    if (changed || !ifm.fileExists(path)) {
      list.sort((a, b) => a.date - b.date)
      ifm.writeString(path, JSON.stringify(list))
    }
  }
  return added
}

let widget = await createWidget();

if (!config.runsInWidget) {
    await widget.presentSmall();
}

Script.setWidget(widget);
Script.complete();

async function createWidget() {
  
    /* Widget variables */
  const lightThemeTextColor = Color.darkGray()
  const darkThemeTextColor = Color.white()
  const themeTextColor = Color.dynamic(lightThemeTextColor, darkThemeTextColor)
  const lightThemeLogoColor = Color.yellow()
  const darkThemeLogoColor = Color.orange()
  const themeLogoColor = Color.dynamic(lightThemeLogoColor, darkThemeLogoColor)

  let storedLocs = []
  let currentLoc = null
  let location = null
  let msg = ''

  // 1. GPS works offline; reverse geocoding doesn't.
  try {
    location = await Location.current()
  } catch (error) {
    console.warn(`Error trying to get GPS location: ${error}`)
  }

  // 2. Resolve the country. If that fails but we have coordinates, queue them
  //    so the country can be resolved once we're back online.
  if (location) {
    try {
      currentLoc = await reverseToEntry(location.latitude, location.longitude, date)
    } catch (error) {
      console.warn(`Reverse geocode failed, queueing location: ${error}`)
      try {
        queuePending(location.latitude, location.longitude, date)
      } catch (e) {
        console.warn(`Could not queue pending location: ${e}`)
      }
    }
  }

  // 3. Reverse worked → we're online: resolve what was queued while offline.
  const newEntries = []
  if (currentLoc) {
    newEntries.push(...await resolvePending())
    newEntries.push(currentLoc)
  }

  try {
    const added = addToStore(newEntries)
    if (added > 0) {
      // New day/country recorded → publish the encrypted dataset to the relay.
      // No-op unless sync was enabled from the Worldwide app (keys in Keychain).
      // NOTE: no applyPatches() here — decrypting the patches mailbox runs
      // scrypt, whose 32 MiB buffer exceeds the widget extension's memory
      // limit and gets the process killed. Repairs are reconciled in app
      // context instead (WorldwideConfig action=set / apply). The push itself
      // is widget-safe: it uses the cached key, no scrypt involved.
      try {
        const sync = importModule('CountriesAYearSync')
        const res = await sync.pushToRelay()
        if (res && res.ok === false && res.reason !== 'not-configured') {
          console.warn(`Relay push failed: ${res.reason ?? res.status}`)
        }
      } catch (e) {
        console.warn(`Relay sync failed: ${e}`)
      }
    }
    storedLocs = await loadYear(year)
  } catch (e) {
    msg = `- ${e} | ${pathLoc}`
  }

  const locsByCountry = storedLocs?.reduce((group, loc) => {
    const { country } = loc
    group[country] = group[country] ?? []
    group[country].push(loc)
    return group
  }, {})

    /* Create the widget */
  const widget = new ListWidget();
  widget.textColor = themeTextColor;


    /* Design the widget header */
  let headerStack = widget.addStack();
  headerStack.centerAlignContent()
  const titleStack = headerStack.addText(`${year} in...`);
  titleStack.font = Font.heavyMonospacedSystemFont(18);
  headerStack.addSpacer(2);
  const logoStack = headerStack.addStack();
  
    /* Add a logo icon */
  const symbol = SFSymbol.named('globe.europe.africa.fill')
  const wimgLogo = logoStack.addImage(symbol.image)
  wimgLogo.imageSize = new Size(30, 30)
  wimgLogo.tintColor = themeLogoColor

  widget.addSpacer();

    /* Add the countries */
  const bodyStack = widget.addStack()
  bodyStack.layoutVertically()

  if (!msg) {
  for (const loc in locsByCountry) {
    const countryStack = bodyStack.addStack()
    let flag = ''

    if (!!countryEmojis && countryEmojis.length > 0) {
      flag = countryEmojis.find((emoji) => emoji.isoCountryCode === locsByCountry[loc][0].isoCountryCode)
    }

    const days = locsByCountry[loc].length
    const text = countryStack.addText(`${flag?.emojiCode} ${loc} ${days}`)
    text.font = Font.semiboldSystemFont(15)
    text.leftAlignText()
  }
  } else {
    bodyStack.addText(msg)
  }
  widget.addSpacer();
  
  await setWidgetBackground(widget)

    /* Done: Widget is now ready to be displayed */
  return widget;
}
