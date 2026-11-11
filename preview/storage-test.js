// Storage robustness tests for "Countries a year": simulates an iCloud year file that is
// evicted/syncing (read returns null), a failing write, a missing file, etc.
//
//   node preview/storage-test.js [widget.js]     (exit code 1 if any check fails)
//
// Run it against an older version of the widget to see the failure modes it guards against:
//   git show <commit>:"widgets/Countries a year.js" > /tmp/old.js && node preview/storage-test.js /tmp/old.js
const path = require('path')
const { runWidget } = require('./scriptable-mock')
const root = path.resolve(__dirname, '..')
const widget = path.resolve(process.argv[2] || path.join(root, 'widgets/Countries a year.js'))
const year = new Date().getFullYear(), D = 86400000, jan1 = new Date(year, 0, 1).getTime()
const span = (iso, country, a, b) => Array.from({ length: b - a + 1 }, (_, i) => ({ country, isoCountryCode: iso, date: jan1 + (a + i - 1) * D + 12 * 3600e3 }))
const base = [...span('ES', 'Spain', 1, 100), ...span('NO', 'Norway', 101, 200)] // 200 days
const KEY = `/mock/Documents/locationsStore ${year}.json`, CACHE = `/mock/Documents/locationsCache ${year}.json`, LOG = '/mock/Documents/countries-widget.log'
const PT = { country: 'Portugal', isoCountryCode: 'PT' }
const shown = (r) => (/(\d+) days/.exec(r.html) || [])[1]
const errShown = (r) => /TypeError|Error|not readable/.test(r.html.replace(/<svg[\s\S]*?<\/svg>/g, ''))
let fails = 0
const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!cond) fails++ }
const run = (files, o = {}) => runWidget(widget, { root, files, ...o })
;(async () => {
  let r
  // 1. normal online run: new country today is saved, cache refreshed
  r = await run({ [KEY]: JSON.stringify(base) }, { online: PT })
  check('1 online: new entry saved', JSON.parse(r.store[KEY]).length === 201 && shown(r) === '201', `(shows ${shown(r)} days)`)
  check('1 online: local cache written', JSON.parse(r.store[CACHE] || '[]').length === 201)

  // 2. iCloud read returns null, local copy exists, online: must NOT overwrite the year, must draw cached data
  r = await run({ [KEY]: JSON.stringify(base), [CACHE]: JSON.stringify(base) }, { online: PT, failRead: true })
  check('2 unreadable+cache: year file untouched', r.store[KEY] === JSON.stringify(base))
  check('2 unreadable+cache: draws cached data, not 0', shown(r) === '200', `(shows ${shown(r)} days)`)
  check('2 unreadable+cache: problem logged', /read/.test(r.store[LOG] || ''))

  // 3. unreadable and no cache at all: shows the error text (nothing else to draw), still no write
  r = await run({ [KEY]: JSON.stringify(base) }, { online: PT, failRead: true })
  check('3 unreadable, no cache: no overwrite', r.store[KEY] === JSON.stringify(base))
  check('3 unreadable, no cache: error text', errShown(r))

  // 4. write fails (file being synced): widget still draws the data, does not show an error
  r = await run({ [KEY]: JSON.stringify(base) }, { online: PT, failWrite: true })
  check('4 write fails: no error screen', !errShown(r) && shown(r) === '200', `(shows ${shown(r)} days)`)
  check('4 write fails: problem logged', /write/.test(r.store[LOG] || ''))

  // 5. brand-new year, nothing anywhere: file is created
  r = await run({}, { online: PT })
  check('5 new year: file created with 1 entry', JSON.parse(r.store[KEY] || '[]').length === 1)

  // 6. file "missing" but a local copy exists (evicted placeholder): must not recreate it from 1 entry
  r = await run({ [CACHE]: JSON.stringify(base) }, { online: PT })
  check('6 missing+cache: no new file', !(KEY in r.store))
  check('6 missing+cache: draws cached data', shown(r) === '200', `(shows ${shown(r)} days)`)

  // 7. offline normal run still works
  r = await run({ [KEY]: JSON.stringify(base) })
  check('7 offline: draws data', shown(r) === '200')
  console.log(fails ? `\n${fails} FAILED` : '\nall passed')
  process.exit(fails ? 1 : 0)
})()
