#!/usr/bin/env node
// Renders a widget script in light/dark for several data scenarios, no iPhone needed.
//
//   node preview/preview.js [widget.js] [--size small|medium|large] [--no-real] [--open]
//
// Output: preview/out/index.html  (and one PNG per card if Chrome is available, see README)
const fs = require('fs')
const os = require('os')
const path = require('path')
const { runWidget } = require('./scriptable-mock')

const root = path.resolve(__dirname, '..')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const widgetFiles = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--size' && argv[i - 1] !== '--zoom' && argv[i - 1] !== '--param').map(f => path.resolve(root, f))
if (!widgetFiles.length) widgetFiles.push(path.resolve(root, 'widgets/Countries a year.js'))
const widgetFile = widgetFiles[0]
const zoom = opt('--zoom', '1.6')
const params = opt('--param', '') ? opt('--param').split(',') : [null]
const family = opt('--size', 'small')

const year = new Date().getFullYear()
const DAY = 86400000
const jan1 = new Date(year, 0, 1).getTime()

// spans: [iso, country, firstDayOfYear, lastDayOfYear]
const fromSpans = (spans) => spans.flatMap(([isoCountryCode, country, a, b]) =>
  Array.from({ length: b - a + 1 }, (_, i) => ({ country, isoCountryCode, date: jan1 + (a + i - 1) * DAY + 12 * 3600e3 })))

const ES = ['ES', 'Spain'], FR = ['FR', 'France'], IT = ['IT', 'Italy'], PT = ['PT', 'Portugal'], DE = ['DE', 'Germany'],
  JP = ['JP', 'Japan'], US = ['US', 'United States'], MX = ['MX', 'Mexico'], GB = ['GB', 'United Kingdom'], SE = ['SE', 'Sweden']

const scenarios = [
  { name: 'Inicio de año (1 país)', locs: fromSpans([[...ES, 1, 18]]) },
  { name: 'Pocos países', locs: fromSpans([[...ES, 1, 90], [...FR, 91, 100], [...IT, 101, 120], [...ES, 121, 150]]) },
  { name: 'Muchos países (9)', locs: fromSpans([[...SE, 1, 60], [...DE, 61, 66], [...FR, 67, 70], [...ES, 71, 120], [...PT, 121, 126], [...JP, 150, 170], [...US, 180, 200], [...MX, 201, 205], [...GB, 220, 222], [...ES, 223, 310]]) },
  { name: 'Casi todo un país', locs: fromSpans([[...SE, 1, 300], [...DE, 301, 305]]) },
]

// Real data (read-only), if Scriptable's iCloud folder is available on this Mac.
const realPath = path.join(os.homedir(), 'Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents', `locationsStore ${year}.json`)
if (!flag('--no-real') && fs.existsSync(realPath)) {
  try { scenarios.unshift({ name: 'Tus datos reales', locs: JSON.parse(fs.readFileSync(realPath, 'utf8')) }) } catch (e) { console.warn('Could not read real data:', e.message) }
}

;(async () => {
  const cards = []
  for (const sc of scenarios) {
    const row = []
    for (const wf of widgetFiles) for (const param of params) for (const theme of ['light', 'dark']) {
      const files = { [`/mock/Documents/locationsStore ${year}.json`]: JSON.stringify(sc.locs) }
      const { html } = await runWidget(wf, { theme, family, files, root, widgetParameter: param })
      row.push(`<figure class="${theme}"><div class="wall">${html}</div><figcaption>${path.basename(wf, '.js')}${param ? ' · ' + param : ''} · ${theme}</figcaption></figure>`)
    }
    cards.push(`<section><h2>${sc.name}</h2><div class="row">${row.join('')}</div></section>`)
  }

  const out = `<!doctype html><meta charset="utf-8"><title>Widget preview – ${path.basename(widgetFile)}</title>
<style>
  body{margin:0;padding:24px;background:#111;color:#ddd;font:14px -apple-system,system-ui,sans-serif}
  h1{font-size:16px;margin:0 0 16px} h2{font-size:13px;font-weight:600;margin:20px 0 8px;color:#aaa}
  .row{display:flex;gap:14px;flex-wrap:wrap} figure{margin:0}
  figcaption{font-size:11px;color:#777;margin-top:4px;text-align:center}
  .wall{padding:14px;border-radius:28px}
  .light .wall{background:linear-gradient(135deg,#9ec5ff,#f2d6ff)} .dark .wall{background:linear-gradient(135deg,#0b1020,#2a1240)}
  .widget{border-radius:22px;overflow:hidden;box-shadow:0 6px 20px #0006;zoom:${zoom}}
</style>
<h1>${widgetFiles.map(f => path.basename(f)).join(' · ')} · ${family} · ${new Date().toLocaleTimeString()}</h1>${cards.join('')}`

  const outDir = path.join(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, 'index.html')
  fs.writeFileSync(outFile, out)
  console.log(`Wrote ${outFile}`)
  if (flag('--open')) require('child_process').execSync(`open "${outFile}"`)
})().catch((e) => { console.error(e); process.exit(1) })
