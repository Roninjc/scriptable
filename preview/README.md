# Widget preview

Runs a widget script in Node against a mocked Scriptable API and renders it as HTML (light + dark, several data scenarios).

    node preview/preview.js                      # Countries a year, small, incl. your real data
    node preview/preview.js "widgets/X.js" --size medium --open
    node preview/preview.js a.js b.js --zoom 1.2 # several designs side by side
    node preview/preview.js a.js --param x,y     # same script with different widget parameters

`node preview/storage-test.js` checks that the widget survives an unreadable/evicted iCloud year file, failing writes, missing files and a new year (it must never show 0 for unreadable data nor overwrite a year it couldn't read).

Output: `preview/out/index.html` (git-ignored). Real data is read from Scriptable's iCloud folder when present (`--no-real` to skip).
Flag icons are served from `assets/flags/`; set `NOFLAGS=1` to preview the emoji fallback.
Approximate: fonts/text metrics and the image background (stubbed to the themed color) differ slightly from iOS.
Not mocked: anything that needs the device (Location, Keychain, Request).
