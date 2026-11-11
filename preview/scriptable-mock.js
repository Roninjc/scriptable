// Minimal mock of the Scriptable API, enough to run widget scripts in Node and
// render the resulting ListWidget / DrawContext images as HTML + SVG.
// Fidelity is approximate (fonts, text metrics): use it to iterate on layout and
// colors, then do a final check on the iPhone.
const fs = require('fs')
const path = require('path')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* ---------- Basic value types ---------- */
class Point { constructor(x, y) { this.x = x; this.y = y } }
class Size { constructor(width, height) { this.width = width; this.height = height } }
class Rect { constructor(x, y, width, height) { Object.assign(this, { x, y, width, height }) } }

const NAMED = {
  white: '#FFFFFF', black: '#000000', darkGray: '#555555', lightGray: '#AAAAAA', gray: '#808080',
  red: '#FF0000', green: '#00FF00', blue: '#0000FF', yellow: '#FFFF00', orange: '#FF8000',
  purple: '#8000FF', brown: '#996633', magenta: '#FF00FF', cyan: '#00FFFF', clear: '#000000',
}

function makeColorClass(getTheme) {
  class Color {
    constructor(hex, alpha = 1) {
      this.hex = String(hex).replace('#', '').toUpperCase()
      if (this.hex.length === 3) this.hex = [...this.hex].map(c => c + c).join('')
      this.alpha = alpha
    }
    get css() {
      const n = parseInt(this.hex, 16)
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${this.alpha})`
    }
    static dynamic(light, dark) { return getTheme() === 'dark' ? dark : light }
  }
  for (const [name, hex] of Object.entries(NAMED)) {
    Color[name] = () => new Color(hex, name === 'clear' ? 0 : 1)
  }
  return Color
}

/* ---------- Fonts ---------- */
const WEIGHTS = { ultraLight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 }
const TEXT_STYLES = { largeTitle: 34, title1: 28, title2: 22, title3: 20, headline: 17, subheadline: 15, body: 17, callout: 16, footnote: 13, caption1: 12, caption2: 11 }

class Font {
  constructor(name, size) { Object.assign(this, { name, size, weight: 400, mono: false, italic: false }) }
  get css() {
    const fam = this.mono ? 'ui-monospace, "SF Mono", Menlo, monospace' : '-apple-system, "SF Pro Text", system-ui, sans-serif'
    return `${this.italic ? 'italic ' : ''}${this.weight} ${this.size}px/1.2 ${fam}`
  }
}
const FontProxy = new Proxy(Font, {
  get(target, prop) {
    if (prop in target || typeof prop !== 'string') return target[prop]
    if (TEXT_STYLES[prop]) return () => new Font('system', TEXT_STYLES[prop])
    if (/ystemFont$/.test(prop)) {
      return (size) => {
        const f = new Font('system', size)
        const w = Object.keys(WEIGHTS).find(k => prop.startsWith(k))
        if (w) f.weight = WEIGHTS[w]
        f.mono = /Monospaced/.test(prop)
        f.italic = /^italic/.test(prop)
        return f
      }
    }
    return target[prop]
  },
})

/* ---------- Path + DrawContext (renders to SVG) ---------- */
class Path {
  constructor() { this.d = [] }
  move(p) { this.d.push(`M${p.x} ${p.y}`) }
  addLine(p) { this.d.push(`L${p.x} ${p.y}`) }
  addRect(r) { this.d.push(`M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}z`) }
  addEllipse(r) {
    const rx = r.width / 2, ry = r.height / 2, cx = r.x + rx, cy = r.y + ry
    this.d.push(`M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0z`)
  }
  addRoundedRect(r, rw, rh) {
    this.d.push(`M${r.x + rw} ${r.y}h${r.width - 2 * rw}a${rw} ${rh} 0 0 1 ${rw} ${rh}v${r.height - 2 * rh}a${rw} ${rh} 0 0 1 ${-rw} ${rh}h${-(r.width - 2 * rw)}a${rw} ${rh} 0 0 1 ${-rw} ${-rh}v${-(r.height - 2 * rh)}a${rw} ${rh} 0 0 1 ${rw} ${-rh}z`)
  }
  addCurve(to, c1, c2) { this.d.push(`C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`) }
  addQuadCurve(to, c) { this.d.push(`Q${c.x} ${c.y} ${to.x} ${to.y}`) }
  closeSubpath() { this.d.push('Z') }
  get svgD() { return this.d.join('') }
}

class MockImage { constructor(svg, size) { this.svg = svg; this.size = size } }

function makeDrawContext(Color) {
  return class DrawContext {
    constructor() {
      this.size = new Size(100, 100)
      this.opaque = true
      this.respectScreenScale = false
      this._els = []
      this._path = null
      this._fill = Color.black(); this._stroke = Color.black(); this._text = Color.black()
      this._lw = 1; this._font = new Font('system', 17); this._align = 'start'
    }
    setFillColor(c) { this._fill = c }
    setStrokeColor(c) { this._stroke = c }
    setTextColor(c) { this._text = c }
    setLineWidth(w) { this._lw = w }
    setFont(f) { this._font = f }
    setTextAlignedLeft() { this._align = 'start' }
    setTextAlignedCenter() { this._align = 'middle' }
    setTextAlignedRight() { this._align = 'end' }
    addPath(p) { this._path = p }
    fillPath() { if (this._path) this._els.push(`<path d="${this._path.svgD}" fill="${this._fill.css}" fill-rule="evenodd"/>`) }
    strokePath() { if (this._path) this._els.push(`<path d="${this._path.svgD}" fill="none" stroke="${this._stroke.css}" stroke-width="${this._lw}"/>`) }
    fillRect(r) { this._els.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="${this._fill.css}"/>`) }
    strokeRect(r) { this._els.push(`<rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="none" stroke="${this._stroke.css}" stroke-width="${this._lw}"/>`) }
    fillEllipse(r) { this._els.push(`<ellipse cx="${r.x + r.width / 2}" cy="${r.y + r.height / 2}" rx="${r.width / 2}" ry="${r.height / 2}" fill="${this._fill.css}"/>`) }
    strokeEllipse(r) { this._els.push(`<ellipse cx="${r.x + r.width / 2}" cy="${r.y + r.height / 2}" rx="${r.width / 2}" ry="${r.height / 2}" fill="none" stroke="${this._stroke.css}" stroke-width="${this._lw}"/>`) }
    drawText(text, p) { this._text_(text, p.x, p.y, this._align) }
    drawTextInRect(text, r) {
      const x = this._align === 'middle' ? r.x + r.width / 2 : this._align === 'end' ? r.x + r.width : r.x
      this._text_(text, x, r.y, this._align)
    }
    _text_(text, x, top, anchor) {
      const f = this._font
      const fam = f.mono ? 'ui-monospace,SF Mono,Menlo,monospace' : '-apple-system,SF Pro Text,system-ui,sans-serif'
      this._els.push(`<text x="${x}" y="${top + f.size * 0.94}" text-anchor="${anchor}" font-family="${fam}" font-size="${f.size}" font-weight="${f.weight}" font-style="${f.italic ? 'italic' : 'normal'}" fill="${this._text.css}">${esc(text)}</text>`)
    }
    drawImageInRect(img, r) {
      this._els.push(`<svg x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" viewBox="0 0 ${img.size.width} ${img.size.height}">${img.svg}</svg>`)
    }
    drawImageAtPoint(img, p) { this.drawImageInRect(img, new Rect(p.x, p.y, img.size.width, img.size.height)) }
    getImage() { return new MockImage(this._els.join(''), this.size) }
  }
}

/* ---------- Widget tree ---------- */
const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' }

class Node {
  constructor(kind) { this.kind = kind; this.children = []; this.align = 'left'; this.vAlign = null; return lenient(this) }
  _add(n) { this.children.push(n); return n }
  addText(text) { const n = new WidgetText(text); return this._add(n) }
  addImage(img) { return this._add(new WidgetImage(img)) }
  addSpacer(len) { return this._add(new WidgetSpacer(len)) }
  addStack() { return this._add(new WidgetStack()) }
  setPadding(t, l, b, r) { this.padding = [t, l, b, r] }
  useDefaultPadding() { this.padding = [16, 16, 16, 16] }
  centerAlignContent() { this.vAlign = 'center' }
  topAlignContent() { this.vAlign = 'flex-start' }
  bottomAlignContent() { this.vAlign = 'flex-end' }
  layoutHorizontally() { this.dir = 'row' }
  layoutVertically() { this.dir = 'column' }
  leftAlignImage() { this.align = 'left' }
  centerAlignImage() { this.align = 'center' }
  rightAlignImage() { this.align = 'right' }
  leftAlignText() { this.align = 'left' }
  centerAlignText() { this.align = 'center' }
  rightAlignText() { this.align = 'right' }
  applyFillingContentMode() { this.fill = true }
  applyFittingContentMode() { this.fill = false }
}
class WidgetText extends Node { constructor(t) { super('text'); this.text = t; this.font = new Font('system', 12) } }
class WidgetImage extends Node { constructor(i) { super('image'); this.image = i } }
class WidgetSpacer extends Node { constructor(l) { super('spacer'); this.length = l } }
class WidgetStack extends Node { constructor() { super('stack'); this.dir = 'row' } }
class ListWidget extends Node {
  constructor() { super('widget'); this.dir = 'column'; this.padding = [16, 16, 16, 16]; this.spacing = 0 }
  async presentSmall() { this.family = 'small' }
  async presentMedium() { this.family = 'medium' }
  async presentLarge() { this.family = 'large' }
  async presentExtraLarge() { this.family = 'extraLarge' }
}

// Unknown setters/methods (shadow, url, ...) shouldn't crash a design iteration:
// warn once and ignore. Plain properties stay undefined.
const warned = new Set()
const METHOD_LIKE = /^(set|add|use|apply|center|left|right|top|bottom|layout|present|refresh)/
function lenient(obj) {
  return new Proxy(obj, {
    get(o, prop, recv) {
      if (prop in o || typeof prop === 'symbol' || !METHOD_LIKE.test(prop)) return Reflect.get(o, prop, recv)
      if (!warned.has(prop)) { warned.add(prop); console.warn(`[preview] ${prop}() not mocked (ignored)`) }
      return () => {}
    },
  })
}

/* ---------- Widget → HTML ---------- */
const col = (c, fb) => (c ? c.css : fb)

function renderNode(n, parent) {
  const pdir = parent ? parent.dir : 'column'
  const selfAlign = n.kind !== 'spacer' && pdir === 'column' && n.align ? `align-self:${FLEX_ALIGN[n.align]};` : ''
  if (n.kind === 'spacer') {
    return n.length != null ? `<div style="flex:none;${pdir === 'column' ? 'height' : 'width'}:${n.length}px"></div>` : '<div style="flex:1"></div>'
  }
  if (n.kind === 'text') {
    const lines = n.lineLimit ? `display:-webkit-box;-webkit-line-clamp:${n.lineLimit};-webkit-box-orient:vertical;overflow:hidden;` : ''
    return `<div style="${selfAlign}font:${n.font.css};color:${col(n.textColor, 'inherit')};opacity:${n.textOpacity ?? 1};text-align:${n.align};${lines}">${esc(n.text).replace(/\n/g, '<br>')}</div>`
  }
  if (n.kind === 'image') {
    const { width, height } = n.image.size
    const sized = n.imageSize ? `width:${n.imageSize.width}px;height:${n.imageSize.height}px;flex:none;` : 'flex:1 1 0;min-height:0;min-width:0;max-width:100%;max-height:100%;'
    const radius = n.cornerRadius ? `border-radius:${n.cornerRadius}px;overflow:hidden;` : ''
    const op = n.imageOpacity != null ? `opacity:${n.imageOpacity};` : ''
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="${selfAlign}${sized}${radius}${op}aspect-ratio:${width}/${height}">${n.image.svg}</svg>`
  }
  // stack / widget
  const p = n.padding ? `padding:${n.padding.map(v => v + 'px').join(' ')};` : ''
  const sz = n.size ? `${n.size.width ? `width:${n.size.width}px;` : ''}${n.size.height ? `height:${n.size.height}px;` : ''}flex:none;` : ''
  const bg = n.backgroundColor ? `background:${n.backgroundColor.css};` : ''
  const br = n.cornerRadius ? `border-radius:${n.cornerRadius}px;` : ''
  const bd = n.borderWidth ? `border:${n.borderWidth}px solid ${col(n.borderColor, 'transparent')};` : ''
  const ai = n.vAlign ? `align-items:${n.vAlign};` : (n.dir === 'row' ? 'align-items:flex-start;' : '')
  const inner = n.children.map(c => renderNode(c, n)).join('')
  return `<div style="${selfAlign}display:flex;flex-direction:${n.dir};${ai}${p}${sz}${bg}${br}${bd}box-sizing:border-box;min-height:0;min-width:0;${n.kind === 'widget' ? 'width:100%;height:100%;' : 'flex:' + (n.size ? 'none' : '1 1 auto') + ';'}">${inner}</div>`
}

const FAMILY_SIZE = { small: [158, 158], medium: [338, 158], large: [338, 354], extraLarge: [715, 345] }

function renderWidgetHtml(widget, theme, family) {
  const [w, h] = FAMILY_SIZE[family] || FAMILY_SIZE.small
  let bg = '#FFFFFF'
  if (widget.backgroundColor) bg = widget.backgroundColor.css
  if (widget.backgroundGradient) bg = widget.backgroundGradient
  return `<div class="widget" style="width:${w}px;height:${h}px;background:${bg};color:${theme === 'dark' ? '#fff' : '#000'};${widget.textColor ? 'color:' + widget.textColor.css + ';' : ''}">${renderNode(widget, null)}</div>`
}

/* ---------- Script runner ---------- */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// Runs a Scriptable script (widget file) with the mocked globals.
// opts: { theme, family, files: {path: string}, root, widgetParameter }
async function runWidget(file, opts) {
  const { theme = 'light', family = 'small', files = {}, root, widgetParameter = null, failRead = false, failWrite = false, online = null } = opts
  const Color = makeColorClass(() => theme)
  const DrawContext = makeDrawContext(Color)
  let captured = null

  const store = { ...files }
  // Cached round flag PNGs (Documents/Flags/ES.png) are served from the repo's assets/flags/
  const flagFile = (p) => { const m = /\/Flags\/([A-Z]{2})\.png$/.exec(p); const f = m && path.join(root, 'assets', 'flags', `${m[1]}.png`); return f && !process.env.NOFLAGS && fs.existsSync(f) ? f : null }
  const makeFM = () => ({
    documentsDirectory: () => '/mock/Documents',
    joinPath: (a, b) => `${a}/${b}`,
    fileExists: (p) => p in store || !!flagFile(p),
    readImage: (p) => {
      const f = flagFile(p)
      if (!f) return null
      const b64 = fs.readFileSync(f).toString('base64')
      return new MockImage(`<image href="data:image/png;base64,${b64}" width="128" height="128"/>`, new Size(128, 128))
    },
    // failRead / failWrite simulate an evicted or syncing iCloud year file
    readString: (p) => (failRead && /locationsStore/.test(p) ? null : store[p]),
    writeString: (p, s) => { if (failWrite && /locationsStore/.test(p)) throw new Error('The file could not be written to disk'); store[p] = s },
    isFileDownloaded: () => true,
    isFileStoredIniCloud: () => true,
    downloadFileFromiCloud: async () => {},
  })
  const FileManager = { iCloud: makeFM, local: makeFM }

  const globals = {
    Color, Font: FontProxy, Point, Size, Rect, Path, DrawContext,
    ListWidget, FileManager,
    Location: online ? {
      current: async () => ({ latitude: 40, longitude: -3 }),
      reverseGeocode: async () => [{ country: online.country, isoCountryCode: online.isoCountryCode }],
    } : {
      current: async () => { throw new Error('preview: no GPS') },
      reverseGeocode: async () => { throw new Error('preview: offline') },
    },
    Keychain: { contains: () => false, get: () => null },
    Device: { isUsingDarkAppearance: () => theme === 'dark' },
    config: { runsInWidget: true, widgetFamily: family },
    args: { widgetParameter },
    Script: { setWidget: (w) => { captured = w }, complete: () => {}, name: () => path.basename(file) },
    console,
  }

  const load = (name, filePath) => {
    const src = fs.readFileSync(filePath, 'utf8')
    const mod = { exports: {} }
    const names = [...Object.keys(globals), 'importModule', 'module', 'exports']
    const fn = new AsyncFunction(...names, src)
    return { mod, run: () => fn(...Object.values(globals), importModule, mod, mod.exports) }
  }
  const importModule = (name) => {
    if (name === 'SetWidgetBackground') {
      // Real one reads Scriptable's iCloud backgrounds; preview uses the plain themed fallback.
      return { setWidgetBackground: async (w) => { w.backgroundColor = Color.dynamic(Color.white(), Color.darkGray()) } }
    }
    let p = path.join(root, 'helpers', `${name}.js`)
    if (!fs.existsSync(p)) p = path.join(root, 'preview', 'variants', `${name}.js`)
    // Helpers are synchronous modules; run as plain functions to get module.exports.
    const src = fs.readFileSync(p, 'utf8')
    const mod = { exports: {} }
    new Function(...Object.keys(globals), 'importModule', 'module', 'exports', src)(...Object.values(globals), importModule, mod, mod.exports)
    return mod.exports
  }

  const { run } = load('widget', file)
  await run()
  if (!captured) throw new Error('The script never called Script.setWidget()')
  return { html: renderWidgetHtml(captured, theme, family), family, store }
}

module.exports = { runWidget, FAMILY_SIZE }
