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
  try { return FileManager.iCloud() }
  catch (e) { return FileManager.local() }
}
const ifm = getFM()
const dir = ifm.documentsDirectory()
const pathLoc = ifm.joinPath(dir, `locationsStore ${year}.json`)

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
  let currentLoc = {}
  
  let msg = ''

  try {
    const location = await Location.current()
    const reverseLocation = await Location.reverseGeocode(location.latitude, location.longitude, "en_US")

    currentLoc = {
      "country": reverseLocation[0].country,
      "isoCountryCode": reverseLocation[0].isoCountryCode,
      date
    }
  } catch (error) {
    console.warn(`Error trying to get location: ${error}`)
  }
  
  if (!ifm.fileExists(pathLoc)) {
    ifm.writeString(pathLoc, "[]")
  } else {
    try {
      ifm.downloadFileFromiCloud(pathLoc)
      await new Promise(r => setTimeout(r, 500))
    } catch (e) {
      console.warn("No se pudo descargar el archivo de iCloud:", e);
    }
    storedLocs = JSON.parse(ifm.readString(pathLoc)) || []
  }
  if (Object.keys(currentLoc)?.length > 0 && currentLoc.country && currentLoc.isoCountryCode && !storedLocs?.some(loc => loc.country === currentLoc.country && (new Date(loc.date)).toDateString() === (new Date(currentLoc.date)).toDateString())) {
    const locsToStore = [
      ...storedLocs,
      currentLoc
    ]
    try {
      console.log(`---- ${pathLoc}`)
      console.log(`---- ${JSON.stringify(locsToStore)}`)
      ifm.writeString(pathLoc, JSON.stringify(locsToStore))
      storedLocs = [ ...locsToStore ]

      // A new day was recorded → merge any pending gap repairs from the app,
      // then publish the encrypted dataset to the relay. Both are no-ops unless
      // sync was enabled from the Worldwide app (keys in Keychain).
      try {
        const sync = importModule('CountriesAYearSync')
        await sync.applyPatches()
        await sync.pushToRelay()
      } catch (e) {
        console.warn(`Relay sync failed: ${e}`)
      }
    } catch (e) {
      msg = `- ${e} | ${pathLoc}`
    }
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
