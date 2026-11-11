// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-green; icon-glyph: globe-americas;
/**
 * Countries a year widget
 * 
 * This widget tracks the countries you visit during the year and draws them as a calendar ring
 * (each arc where those days were) with round flag badges, tinted with each flag's own color.
 * It stores the locations data in Scriptable's documents folder: iCloud when Scriptable
 * is set up with iCloud (so it's shared across devices), otherwise local storage.
 */
const countryEmojis = importModule('CountryEmojis')
const { setWidgetBackground } = importModule('SetWidgetBackground')
const flagColors = importModule('CountryColors') // dominant flag colors per ISO code
const flagsHelper = importModule('CountryFlags') // round flag icons cached in Documents/Flags

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

/* Ring design: a calendar ring (each arc sits where those days really were) with flag badges.
 * Canvas is 400px shown at ~150pt, so 1pt ≈ 2.67px.
 * Layers, inside → out: ring · tether arc · month ticks · outer badge (+ radial stub to the badge). */
const RUN_SEPARATOR = 3 // px of line between touching stretches (0 = none)
const TAU = Math.PI * 2
const TOP = -Math.PI / 2
const daysInYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
const total = daysInYear(year)
const doy = (ms) => {
  const d = new Date(ms)
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(d.getFullYear(), 0, 1)) / 86400000) + 1
}
const angleOfDay = (d) => TOP + (d / total) * TAU // d = 0..total (boundary between days)
const norm = (a) => ((a % TAU) + TAU) % TAU
const angDist = (a, b) => { const d = norm(a - b); return Math.min(d, TAU - d) }
const signedDiff = (a, b) => { const d = norm(a - b); return d > TAU / 2 ? d - TAU : d }

/* Each country gets a color from its own flag */
const FALLBACK_COLORS = ['#5B8DEF', '#F4796B', '#45C4A0', '#F5B84B', '#9B7FE8', '#4FB6D9', '#E86FA3', '#A3C95B', '#E39A6B']
const MIN_COLOR_DIST = 110
const hexToRgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
function colorDist(a, b) { // "redmean": ~0 identical, >150 clearly different
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b), rm = (r1 + r2) / 2
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2)
}
// Countries with most days choose first (they keep their iconic color); the others take the
// next flag color that isn't too close to one already used, else the least-bad option.
function assignColors(countries) {
  const used = []
  const far = (c) => used.length ? Math.min(...used.map(u => colorDist(u, c))) : 999
  for (const c of [...countries].sort((a, b) => b.days - a.days)) {
    const cands = [...(flagColors[c.iso] ?? []), ...FALLBACK_COLORS]
    c.color = cands.find(x => far(x) >= MIN_COLOR_DIST) ?? cands.reduce((best, x) => far(x) > far(best) ? x : best)
    used.push(c.color)
  }
}

// Countries in order of first visit; a day with several countries is split among them.
function buildCountries(locs) {
  const byDay = {}
  for (const l of locs) (byDay[dayKey(l.date)] ??= []).push(l)
  const by = {}
  for (const k in byDay) {
    const isos = [...new Set(byDay[k].map(l => l.isoCountryCode))]
    for (const iso of isos) {
      const f = byDay[k].find(l => l.isoCountryCode === iso)
      const c = (by[iso] ??= { iso, country: f.country, days: 0, first: f.date })
      c.days += 1 / isos.length
      c.first = Math.min(c.first, f.date)
    }
  }
  const list = Object.values(by).sort((a, b) => a.first - b.first)
  list.forEach(c => { c.flag = countryEmojis.find(e => e.isoCountryCode === c.iso)?.emojiCode ?? c.iso })
  assignColors(list)
  return { list, byDays: [...list].sort((a, b) => b.days - a.days), recordedDays: Object.keys(byDay).length }
}

// Consecutive days in the same country become one run (gaps up to TOL days are bridged).
function buildRuns(locs, TOL = 7) {
  const dayIso = {}
  for (const l of locs) dayIso[doy(l.date)] ??= l.isoCountryCode
  const runs = []
  for (const d of Object.keys(dayIso).map(Number).sort((a, b) => a - b)) {
    const r = runs[runs.length - 1]
    if (r && r.iso === dayIso[d] && d - r.end <= TOL) r.end = d
    else runs.push({ iso: dayIso[d], start: d, end: d })
  }
  return runs
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

// capStart / capEnd: round that end of the arc (off where it touches the next stretch)
function fillArc(ctx, cx, cy, rMid, th, a0, a1, color, capStart = true, capEnd = true) {
  ctx.setFillColor(color)
  const inset = (th / 2) / rMid
  const i0 = capStart ? inset : 0, i1 = capEnd ? inset : 0
  if ((capStart || capEnd) && a1 - a0 > i0 + i1 + 0.02) {
    ctx.addPath(arcPath(cx, cy, rMid + th / 2, rMid - th / 2, a0 + i0, a1 - i1))
    ctx.fillPath()
    for (const [on, a] of [[capStart, a0 + inset], [capEnd, a1 - inset]]) { // round caps
      if (on) ctx.fillEllipse(new Rect(cx + rMid * Math.cos(a) - th / 2, cy + rMid * Math.sin(a) - th / 2, th, th))
    }
  } else {
    ctx.addPath(arcPath(cx, cy, rMid + th / 2, rMid - th / 2, a0, Math.max(a1, a0 + 0.015)))
    ctx.fillPath()
  }
}

function dot(ctx, x, y, r, color) {
  ctx.setFillColor(color)
  ctx.fillEllipse(new Rect(x - r, y - r, 2 * r, 2 * r))
}

function text(ctx, s, x, y, size, font, color, align = 'left') {
  ctx.setFont(font)
  ctx.setTextColor(color)
  const w = 400
  if (align === 'center') { ctx.setTextAlignedCenter(); ctx.drawTextInRect(`${s}`, new Rect(x - w / 2, y, w, size * 1.25)) }
  else if (align === 'right') { ctx.setTextAlignedRight(); ctx.drawTextInRect(`${s}`, new Rect(x - w, y, w, size * 1.25)) }
  else { ctx.setTextAlignedLeft(); ctx.drawTextInRect(`${s}`, new Rect(x, y, w, size * 1.25)) }
}

// Fallback when a round flag icon isn't cached yet: the flag emoji cropped to a disc.
// DrawContext has no clipping, so the disc is built from thin horizontal strips, each its
// own small canvas (the canvas bounds crop the emoji) as wide as the disc at that height.
// Measured glyph: height = 0.63 * font size.
function emojiDisc(ctx, emoji, x, y, r, step = 2) {
  const size = (2 * r) / 0.63 * 1.02
  for (let yy = -r; yy < r; yy += step) {
    const ym = yy + step / 2
    const half = Math.sqrt(Math.max(r * r - ym * ym, 0)) + 1.5 // bleed under the border ring
    const w = half * 2
    const sc = new DrawContext()
    sc.size = new Size(w, step + 0.6)
    sc.opaque = false
    sc.respectScreenScale = true
    sc.setFont(Font.systemFont(size))
    sc.setTextAlignedCenter()
    sc.drawTextInRect(emoji, new Rect(w / 2 - size, -yy - size * 0.6, size * 2, size * 1.25))
    ctx.drawImageInRect(sc.getImage(), new Rect(x - half, y + yy, w, step + 0.6))
  }
}

function drawRing({ list, byDays, recordedDays, runs }, dark, flagImages) {
  const byIso = Object.fromEntries(list.map(c => [c.iso, c]))
  const ctx = new DrawContext()
  ctx.size = new Size(400, 400)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // Two kinds of badge:
  //  · "on ring": big, centered on the ring, for countries whose stretch has room
  //  · "outer": smaller, for crowded short trips, tied to their stretch by a tether
  // Canvas radius is 200: rOut + 14 (tether + ticks + gap) + 2*brOut must fit.
  const cx = 200, cy = 200, th = 20, brOn = 31, brOut = 25, rOut = 135, rMid = rOut - th / 2
  const rT = rOut + 5, rTick = rOut + 10, rOutBadge = rOut + 14 + brOut
  const BORDER = 3.5
  const textColor = dark ? '#FFFFFF' : '#1C1C1E'
  const faded = dark ? new Color('#FFFFFF', 0.62) : new Color('#1C1C1E', 0.6)
  const badgeBg = new Color(dark ? '#3A3A3C' : '#FFFFFF') // opaque so it reads over any background
  const pt = (a, r) => new Point(cx + r * Math.cos(a), cy + r * Math.sin(a))

  // Track: the elapsed year slightly stronger than the days still to come
  const today = doy(Date.now())
  const ta = angleOfDay(today - 0.5)
  const trackCol = (k) => new Color(dark ? '#FFFFFF' : '#000000', (dark ? 0.14 : 0.10) * k)
  fillArc(ctx, cx, cy, rMid, th, TOP, TOP + TAU - 0.0001, trackCol(0.55), false, false)
  fillArc(ctx, cx, cy, rMid, th, TOP, angleOfDay(today), trackCol(1), false, false)

  // Stretches touch each other (proportional to the days). Only the free ends are rounded;
  // RUN_SEPARATOR > 0 also draws a thin line (in the widget background color) at each junction.
  const touches = (r, o) => o !== r && o.end === r.start - 1 // o is the stretch right before r
  for (const r of runs) {
    const capStart = !runs.some(o => touches(r, o)), capEnd = !runs.some(o => touches(o, r))
    fillArc(ctx, cx, cy, rMid, th, angleOfDay(r.start - 1), angleOfDay(r.end), new Color(byIso[r.iso].color), capStart, capEnd)
  }
  if (RUN_SEPARATOR > 0) {
    const sepColor = new Color(dark ? '#555555' : '#FFFFFF', 0.9)
    for (const r of runs) {
      if (!runs.some(o => touches(r, o))) continue
      const a = angleOfDay(r.start - 1), nx = -Math.sin(a) * RUN_SEPARATOR / 2, ny = Math.cos(a) * RUN_SEPARATOR / 2
      const p0 = pt(a, rMid - th / 2 - 1), p1 = pt(a, rMid + th / 2 + 1), path = new Path()
      path.move(new Point(p0.x + nx, p0.y + ny))
      path.addLine(new Point(p1.x + nx, p1.y + ny))
      path.addLine(new Point(p1.x - nx, p1.y - ny))
      path.addLine(new Point(p0.x - nx, p0.y - ny))
      path.closeSubpath()
      ctx.setFillColor(sepColor)
      ctx.addPath(path)
      ctx.fillPath()
    }
  }

  // Month ticks: a small light with a soft halo, in a discreet cool tone
  const tickGlow = dark ? '#DCE4F2' : '#7C879B'
  for (let m = 0; m < 12; m++) {
    const p = pt(angleOfDay(doy(new Date(year, m, 1).getTime()) - 1), rTick)
    dot(ctx, p.x, p.y, 7, new Color(tickGlow, dark ? 0.10 : 0.14)) // soft halo
    dot(ctx, p.x, p.y, 4.5, new Color(tickGlow, dark ? 0.22 : 0.26))
    dot(ctx, p.x, p.y, 2.5, new Color(tickGlow))
  }

  // Candidates: the 5 countries with most days, at the middle of their longest run
  const cands = byDays.slice(0, 5).map(c => {
    const best = runs.filter(r => r.iso === c.iso).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
    if (!best) return null
    const a = (angleOfDay(best.start - 1) + angleOfDay(best.end)) / 2
    return { c, a, home: a, homeDay: (best.start - 1 + best.end) / 2 }
  }).filter(Boolean)

  // The biggest countries claim the ring if they keep clear of each other and of today's dot.
  // Only short trips (< MIN_HIDE days) may not hide under an on-ring badge.
  const MIN_HIDE = 12
  const halfDays = (Math.asin(brOn / rMid) + 0.03) / TAU * total
  const coversOthers = (k) => runs.some(r => r.iso !== k.c.iso && r.end - r.start + 1 < MIN_HIDE &&
    r.end >= k.homeDay - halfDays && r.start - 1 <= k.homeDay + halfDays)
  const chord = (a, b) => 2 * rMid * Math.sin(angDist(a, b) / 2)
  const onRing = [], outer = []
  for (const k of cands) {
    const ok = !coversOthers(k) && chord(k.home, ta) >= brOn + 14 && onRing.every(o => chord(o.home, k.home) >= 2 * brOn + 4)
    ;(ok ? onRing : outer).push(k)
  }

  // Outer badges: spread apart, and keep clear of the on-ring ones
  const minSepOut = 2 * Math.asin((brOut + 3) / rOutBadge)
  let clearOn = 0
  while (clearOn < 1.5 && Math.hypot(rOutBadge * Math.cos(clearOn) - rMid, rOutBadge * Math.sin(clearOn)) < brOut + brOn + 4) clearOn += 0.005
  outer.sort((x, y) => x.a - y.a)
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length
      if (j === i) break
      const d = norm(outer[j].a - outer[i].a)
      if (d < minSepOut) { const push = (minSepOut - d) / 2; outer[i].a -= push; outer[j].a += push }
    }
    for (const b of outer) for (const o of onRing) {
      if (Math.abs(signedDiff(b.a, o.a)) < clearOn) b.a = o.a + (signedDiff(b.home, o.a) >= 0 ? 1 : -1) * clearOn
    }
  }

  // Tethers: arc from the real stretch to the badge's angle, then a radial stub to the badge
  const stub = (a, r0, r1, w, color) => {
    const nx = -Math.sin(a) * w / 2, ny = Math.cos(a) * w / 2
    const p0 = pt(a, r0), p1 = pt(a, r1), path = new Path()
    path.move(new Point(p0.x + nx, p0.y + ny))
    path.addLine(new Point(p1.x + nx, p1.y + ny))
    path.addLine(new Point(p1.x - nx, p1.y - ny))
    path.addLine(new Point(p0.x - nx, p0.y - ny))
    path.closeSubpath()
    ctx.setFillColor(color)
    ctx.addPath(path)
    ctx.fillPath()
  }
  for (const { c, a, home } of outer) {
    const col = new Color(c.color)
    if (angDist(a, home) > 0.01) fillArc(ctx, cx, cy, rT, 4, Math.min(a, home), Math.max(a, home), col, false, false)
    const h = pt(home, rT)
    dot(ctx, h.x, h.y, 4.5, col)
    stub(a, rT, rOutBadge - brOut + 2, 4, col)
  }

  // Today marker
  const tp = pt(ta, rMid)
  dot(ctx, tp.x, tp.y, 12, badgeBg)
  dot(ctx, tp.x, tp.y, 7, new Color(textColor))

  const badge = (c, a, r, br) => {
    const p = pt(a, r)
    dot(ctx, p.x, p.y, br, new Color(c.color))
    dot(ctx, p.x, p.y, br - BORDER, badgeBg)
    const img = flagImages[c.iso]
    if (img) ctx.drawImageInRect(img, new Rect(p.x - (br - BORDER), p.y - (br - BORDER), 2 * (br - BORDER), 2 * (br - BORDER)))
    else emojiDisc(ctx, c.flag, p.x, p.y, br - BORDER)
  }
  for (const { c, a } of onRing) badge(c, a, rMid, brOn)
  for (const { c, a } of outer) badge(c, a, rOutBadge, brOut)

  // Center: countries count + days with a record (the flags around say what the number counts)
  text(ctx, list.length, cx, cy - 80, 96, Font.heavySystemFont(96), new Color(textColor), 'center')
  text(ctx, `${recordedDays} days`, cx, cy + 26, 30, Font.semiboldSystemFont(30), faded, 'center')
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
    const data = { ...buildCountries(storedLocs), runs: buildRuns(storedLocs) }
    // Round flag icons for the badges. Missing ones are only fetched when we know we're online
    // (the reverse geocode above worked); otherwise the badge falls back to the cropped emoji.
    const flagImages = await flagsHelper.load(ifm, dir, data.byDays.slice(0, 5).map(c => c.iso), { download: !!currentLoc })
    const img = drawRing(data, Device.isUsingDarkAppearance(), flagImages)
    const wimg = widget.addImage(img)
    wimg.centerAlignImage()
  }

  await setWidgetBackground(widget)

    /* Done: Widget is now ready to be displayed */
  return widget;
}
