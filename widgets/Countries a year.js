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

/* Ring chart: one arc per country, sized by days; the rest of the year is a gap */
const RING_COLORS = ['#4C9AFF', '#FF6B6B', '#2ED573', '#FFA502', '#A55EEA', '#1ABC9C', '#FF6EB4', '#F7DC6F', '#8395A7']
const MAX_SLICES = 8 // more countries than this are merged into a "+N" slice
const MIN_LABEL_SEP = 28 // degrees between flags so they don't overlap

const daysInYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365

// A day with several countries is split equally among them, so the slices add
// up to the days that have records (never more than the days in the year).
function buildRing(locs) {
  const byDay = {}
  for (const l of locs) (byDay[dayKey(l.date)] ??= []).push(l)
  const byCountry = {}
  for (const k in byDay) {
    const countries = [...new Set(byDay[k].map(l => l.isoCountryCode))]
    for (const iso of countries) {
      const first = byDay[k].find(l => l.isoCountryCode === iso)
      const c = (byCountry[iso] ??= { iso, country: first.country, days: 0, first: first.date })
      c.days += 1 / countries.length
      c.first = Math.min(c.first, first.date)
    }
  }
  let slices = Object.values(byCountry).sort((a, b) => b.days - a.days)
  if (slices.length > MAX_SLICES) {
    const rest = slices.slice(MAX_SLICES)
    slices = slices.slice(0, MAX_SLICES)
    slices.push({ iso: null, other: rest.length, days: rest.reduce((t, c) => t + c.days, 0), first: Infinity })
  }
  slices.sort((a, b) => a.first - b.first) // chronological, "+N" last
  return { slices, recordedDays: Object.keys(byDay).length, total: daysInYear(year) }
}

function arcPath(cx, cy, rOut, rIn, a0, a1) {
  const path = new Path()
  const steps = Math.max(2, Math.ceil(((a1 - a0) * 180 / Math.PI) / 3))
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * i / steps
    const pt = new Point(cx + rOut * Math.cos(a), cy + rOut * Math.sin(a))
    i === 0 ? path.move(pt) : path.addLine(pt)
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + (a1 - a0) * i / steps
    path.addLine(new Point(cx + rIn * Math.cos(a), cy + rIn * Math.sin(a)))
  }
  path.closeSubpath()
  return path
}

function drawRing({ slices, recordedDays, total }, dark) {
  const S = 400, cx = S / 2, cy = S / 2
  const rOut = 128, rIn = 94, rLabel = 162
  const ctx = new DrawContext()
  ctx.size = new Size(S, S)
  ctx.opaque = false
  ctx.respectScreenScale = true

  const gap = slices.length > 1 ? 0.03 : 0 // radians between slices
  const labels = []
  let start = -Math.PI / 2

  const fill = (a0, a1, color) => {
    ctx.setFillColor(color)
    ctx.addPath(arcPath(cx, cy, rOut, rIn, a0, a1))
    ctx.fillPath()
  }

  slices.forEach((sl, i) => {
    const sweep = sl.days / total * 2 * Math.PI
    const a0 = start + gap / 2
    const a1 = Math.max(start + sweep - gap / 2, a0 + 0.01)
    fill(a0, a1, new Color(sl.iso ? RING_COLORS[i % (RING_COLORS.length - 1)] : RING_COLORS[RING_COLORS.length - 1]))
    labels.push({ sl, angle: (start + sweep / 2) * 180 / Math.PI })
    start += sweep
  })

  // Days of the year without any record
  if (start < 3 * Math.PI / 2 - 0.01) {
    fill(start + gap / 2, 3 * Math.PI / 2 - gap / 2, dark ? new Color('#FFFFFF', 0.12) : new Color('#000000', 0.10))
  }

  // Keep neighbouring flags apart (labels are in clockwise order from the top)
  for (let i = 1; i < labels.length; i++) {
    labels[i].angle = Math.max(labels[i].angle, labels[i - 1].angle + MIN_LABEL_SEP)
  }
  const textColor = dark ? Color.white() : Color.darkGray()
  ctx.setTextAlignedCenter()
  for (const { sl, angle } of labels) {
    const a = angle * Math.PI / 180
    const x = cx + rLabel * Math.cos(a), y = cy + rLabel * Math.sin(a)
    if (sl.iso) {
      const flag = countryEmojis.find(e => e.isoCountryCode === sl.iso)?.emojiCode ?? sl.iso
      ctx.setFont(Font.systemFont(36))
      ctx.drawTextInRect(flag, new Rect(x - 30, y - 24, 60, 48))
    } else {
      ctx.setFont(Font.boldSystemFont(28))
      ctx.setTextColor(textColor)
      ctx.drawTextInRect(`+${sl.other}`, new Rect(x - 30, y - 17, 60, 36))
    }
  }

  // Center: days with at least one record (not number of records)
  ctx.setTextColor(textColor)
  ctx.setFont(Font.heavyMonospacedSystemFont(58))
  ctx.drawTextInRect(`${recordedDays}`, new Rect(cx - 70, cy - 46, 140, 66))
  ctx.setFont(Font.semiboldSystemFont(24))
  ctx.setTextColor(new Color(textColor.hex, 0.7))
  ctx.drawTextInRect(`${year}`, new Rect(cx - 70, cy + 20, 140, 30))
  return ctx.getImage()
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

  /* Create the widget */
  const widget = new ListWidget();
  widget.textColor = themeTextColor;
  widget.setPadding(4, 4, 4, 4)

  if (msg) {
    widget.addText(msg)
  } else {
    const ring = buildRing(storedLocs)
    const img = drawRing(ring, Device.isUsingDarkAppearance())
    const wimg = widget.addImage(img)
    wimg.centerAlignImage()
  }

  await setWidgetBackground(widget)

    /* Done: Widget is now ready to be displayed */
  return widget;
}
