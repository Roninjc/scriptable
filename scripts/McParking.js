// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: motorcycle;

/**
 * McParking — MC parking finder for Oslo
 *
 * Triggered from Shortcuts with one of these parameters:
 *   { lat, lng }         → find nearest parking spots and return candidates
 *   { action: "update" } → refresh local cache from Oslo geodata API
 *
 * Shortcut setup:
 *
 *   "McParking Finder"
 *     1. Receive: Share from Maps (Location type)
 *     2. Get details of location → Latitude, Longitude
 *     3. Run Scriptable script: "McParking", parameter: { lat, lng }
 *     4. If parkings.count > 1 → Choose from list (show distance and slots)
 *     5. Open URL: maps://?daddr=[lat],[lng]&dirflg=d
 *
 *   "McParking Update" (weekly Personal Automation)
 *     1. Run Scriptable script: "McParking", parameter: { action: "update" }
 */

const CACHE_FILENAME = 'mc-parking-oslo.json'
const CACHE_TTL_DAYS = 7
const GAP_THRESHOLD_M = 200  // max distance gap between nearest and alternatives
const ABS_THRESHOLD_M = 400  // max absolute distance from destination for alternatives
const MAX_RESULTS = 3

const API_URL = 'https://geodata.bymoslo.no/arcgis/rest/services/geodata/Parkering/MapServer/0/query'
  + '?where=1%3D1&timeRelation=esriTimeRelationOverlaps&geometryType=esriGeometryEnvelope'
  + '&spatialRel=esriSpatialRelIntersects&units=esriSRUnit_Meter&outFields=*'
  + '&returnGeometry=true&outSR=4326&featureEncoding=esriDefault&f=pjson'

// ─── iCloud FileManager ───────────────────────────────────────────────────

function getCachePath() {
  const fm = FileManager.iCloud()
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILENAME)
}

async function loadCache() {
  const fm = FileManager.iCloud()
  const path = getCachePath()

  if (!fm.fileExists(path)) return null

  if (!fm.isFileDownloaded(path)) {
    try {
      await fm.downloadFileFromiCloud(path)
    } catch (e) {
      console.error(`Failed to download cache from iCloud: ${e}`)
      return null
    }
  }

  try {
    return JSON.parse(fm.readString(path))
  } catch (e) {
    console.error(`Failed to read cache: ${e}`)
    return null
  }
}

function saveCache(features) {
  const fm = FileManager.iCloud()
  const data = { savedAt: new Date().toISOString(), features }
  fm.writeString(getCachePath(), JSON.stringify(data))
}

function isCacheStale(savedAt) {
  return (Date.now() - new Date(savedAt).getTime()) > CACHE_TTL_DAYS * 86400 * 1000
}

// ─── Fetch & validation ───────────────────────────────────────────────────

async function fetchFromAPI() {
  try {
    const req = new Request(API_URL)
    const json = await req.loadJSON()
    if (req.response.statusCode !== 200) throw new Error(`HTTP ${req.response.statusCode}`)
    return json
  } catch (e) {
    console.error(`API fetch failed: ${e}`)
    return null
  }
}

function isValidResponse(data) {
  return Array.isArray(data?.features)
    && data.features.length > 10
    && data.features[0]?.geometry?.x !== undefined
    && data.features[0]?.attributes !== undefined
}

function normalizeFeatures(data) {
  return data.features
    .filter(f => f.geometry?.x != null && f.geometry?.y != null)
    .map(f => ({
      id: f.attributes.objectid,
      slots: f.attributes.befart_antall ?? f.attributes.beregnet_antall ?? null,
      lat: f.geometry.y,
      lng: f.geometry.x,
      note: f.attributes.fritekst?.trim() || null
    }))
}

// ─── Distance & filtering ─────────────────────────────────────────────────

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = d => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function findCandidates(destLat, destLng, spots) {
  const ranked = spots
    .map(s => ({ ...s, distanceMeters: Math.round(haversine(destLat, destLng, s.lat, s.lng)) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  if (!ranked.length) return []

  const nearest = ranked[0]
  // Nearest always included. Alternatives qualify if within 200m of nearest
  // OR within 400m of destination (they may be in the opposite direction).
  const candidates = [
    nearest,
    ...ranked.slice(1).filter(s =>
      (s.distanceMeters - nearest.distanceMeters <= GAP_THRESHOLD_M)
      || (s.distanceMeters <= ABS_THRESHOLD_M)
    )
  ]

  return candidates.slice(0, MAX_RESULTS).map((s, i) => ({ rank: i + 1, ...s }))
}

// ─── Trigger handlers ─────────────────────────────────────────────────────

async function handleUpdate() {
  const raw = await fetchFromAPI()

  if (!raw || !isValidResponse(raw)) {
    console.error('Invalid or empty API response — cache not updated')
    Script.setShortcutOutput({ success: false, message: 'Invalid API response' })
    Script.complete()
    return
  }

  saveCache(normalizeFeatures(raw))
  Script.setShortcutOutput({ success: true, message: 'Cache updated' })
  Script.complete()
}

async function handleQuery(destLat, destLng) {
  let cache = await loadCache()
  let usedStaleCache = false

  if (!cache || isCacheStale(cache.savedAt)) {
    const raw = await fetchFromAPI()
    if (raw && isValidResponse(raw)) {
      const features = normalizeFeatures(raw)
      saveCache(features)
      cache = { features }
    } else if (!cache) {
      Script.setShortcutOutput({
        error: 'No data available. Run McParking with { action: "update" } first.'
      })
      Script.complete()
      return
    } else {
      // API failed but stale cache exists — use it silently
      usedStaleCache = true
    }
  }

  const candidates = findCandidates(destLat, destLng, cache.features)

  if (!candidates.length) {
    Script.setShortcutOutput({ error: 'No MC parking found near destination' })
  } else {
    Script.setShortcutOutput({ parkings: candidates, staleCache: usedStaleCache })
  }

  Script.complete()
}

// ─── Main ─────────────────────────────────────────────────────────────────

const param = args.shortcutParameter

if (param?.action === 'update') {
  await handleUpdate()
} else if (param?.lat != null && param?.lng != null) {
  await handleQuery(Number(param.lat), Number(param.lng))
} else {
  Script.setShortcutOutput({
    error: 'Invalid parameter. Expected { lat, lng } or { action: "update" }'
  })
  Script.complete()
}
