/**
 * Shopping list widget for Scriptable
 * 
 * Fetches shopping list items from Home Assistant and displays them in a widget.
 * If offline, it shows the last stored list with an "offline" indicator.
 */
const { setWidgetBackground } = importModule('SetWidgetBackground')

const localFm = FileManager.local()
const localDocsDir = localFm.documentsDirectory()
const localShoppinglistFilePath = localFm.joinPath(localDocsDir, "local-shoppinglist.json")

let widget = await createWidget();

if (!config.runsInWidget) {
    await widget.presentSmall();
}

Script.setWidget(widget);
Script.complete();

async function createWidget(items) {
  
    /* Color variables */
    const lightTextColor = Color.white()
    const darkTextColor = Color.darkGray()
    const theme = Color.dynamic(lightTextColor, darkTextColor);

    /* Get data from API */
    const { list, offline } = await getShoppinglist()

    /* Create the widget */
    const widget = new ListWidget();
    widget.textColor = theme;
    const mainStack = widget.addStack()
    const wSize = new Size(158, 158)
    mainStack.size = wSize
    mainStack.layoutVertically()
    mainStack.setPadding(0, 10, 0, 10)
    mainStack.cornerRadius = 22
    if (offline) {
      mainStack.borderColor = Color.orange()
      mainStack.borderWidth = 4
    }

    /* Design the widget header */
    const headerStack = mainStack.addStack();
    headerStack.addSpacer()
    const symbol = SFSymbol.named('cart.circle.fill')
    const wimgLogo = headerStack.addImage(symbol.image)
    wimgLogo.imageSize = new Size(30, 30)
    headerStack.addSpacer()

    offline ? mainStack.addSpacer(8) : mainStack.addSpacer(5)

    /* Add the HA sensor entries */
    const bodyStack = mainStack.addStack();
    bodyStack.layoutVertically()
    bodyStack.setPadding(0, 10, 0, 0)

    list.items.forEach((item, index) => {
      if ((offline && index < 3) || (!offline && index < 8)) {
        const lisItem = bodyStack.addText(`- ${item}`);
        lisItem.font = Font.semiboldSystemFont(10);
      } else if ((offline && index === 4) || (!offline && index === 9)) {
        const lisItem = bodyStack.addText(`- ${item} ...`)
        lisItem.font = Font.semiboldSystemFont(10)
      }
    })
    
    if (offline) {
      mainStack.addSpacer(5)
      const now = new Date()
      const lastDate = new Date(list.lastChanged)
      const rdtf = new RelativeDateTimeFormatter()
      rdtf.useNamedDateTimeStyle()
      rdtf.date = lastDate
      rdtf.referenceDate = now
      const dateStr = rdtf.string(lastDate, now)
      const lastChangedStack = mainStack.addStack()
      lastChangedStack.addSpacer()
      const lastChangedText = lastChangedStack.addText(`Actualizado ${dateStr}`)
      lastChangedText.centerAlignText()
      lastChangedText.lineLimit = 2
      lastChangedText.font = Font.footnote()
      lastChangedText.textColor = Color.dynamic(new Color('#4d3317', 1), Color.orange())
      lastChangedText.shadowRadius = 2
      lastChangedText.shadowColor = Color.dynamic(Color.lightGray(), Color.darkGray())
      lastChangedStack.addSpacer()
    }

    await setWidgetBackground(widget)

    /* Done: Widget is now ready to be displayed */
    return widget;
}

async function getRemoteShoppinglist() {
  const list = {
    "items": [],
    "lastChanged": null
  }

  try {
    const req = new Request("https://haos.milkyhome.eu/api/states/sensor.shopping_list_items")
    req.headers = { "Authorization": Keychain.get("haos"), "content-type": "application/json" }
    req.timeoutInterval = 5
    const json = await req.loadJSON()
    list.items = json?.attributes?.items
    list.lastChanged = json?.last_updated
  } catch (error) {
    console.warn(`getRemoteShoppinglist failed - ${error}!`)
    return list
  }

  return list
}

async function getLocalShoppingList() {
  if (localFm.fileExists(localShoppinglistFilePath)) {
    return JSON.parse(localFm.readString(localShoppinglistFilePath))
  } else {
    console.warn(`Unable to find ${localShoppinglistFilePath} locally.`)
    return null
  }
}

async function getShoppinglist() {
  const localList = await getLocalShoppingList()
  const remoteList = await getRemoteShoppinglist()

  if (localList && (localList?.lastChanged === remoteList?.lastChanged)) {
    return {list: localList, offline: false}
  } else if (localList && !remoteList?.lastChanged) {
    return {list: localList, offline: true}
  } else if (remoteList?.lastChanged && remoteList?.lastChanged != localList.lastChanged) {
    const listToStore = JSON.stringify(remoteList)
    localFm.writeString(localShoppinglistFilePath, listToStore)
  }

  return {list: remoteList, offline: false}
}
