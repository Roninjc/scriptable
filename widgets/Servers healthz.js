/**
 * Servers healthz widget
 * 
 * This widget checks the health status of predefined servers and displays their status.
 * A list of servers needs to be defined in a separate file (ServersList.js) with this format: 
 * [
 *   {
 *     url: 'https://example.com',
 *     title: 'Example Server',
 *     status: null
 *   }
 * ]
 */
const { setWidgetBackground } = importModule('SetWidgetBackground')

let servers = []
try {
  servers = importModule('ServersList')
} catch (e) {
  if (config.runsInApp) {
    const alert = new Alert()
    alert.title = "Servers List Missing"
    alert.message = "Do you want to create a servers list?"
    alert.addAction("Yes")
    alert.addCancelAction("No")
    const response = await alert.present()
    if (response === 0) {
      const fm = FileManager.iCloud()
      const cloudDocsDir = fm.documentsDirectory()
      const serversListFilePath = fm.joinPath(cloudDocsDir, "ServersList.js")
      let initialServersList = []
      while (true) {
        const prompt = new Alert()
        prompt.title = "Add Server"
        prompt.message = "Enter the server name and public URL."
        prompt.addTextField("Server Name", "")
        prompt.addTextField("https://...", "")
        prompt.addAction("Add Another")
        prompt.addAction("Done")
        const response = await prompt.present()
        const title = prompt.textFieldValue(0)
        const url = prompt.textFieldValue(1)
        if (url && title) {
          initialServersList.push({ url, title, status: null })
        }
        if (response === 1) break
      }
      const initialList = `module.exports = ${JSON.stringify(initialServersList, null, 2)}`
      fm.writeString(serversListFilePath, initialList)
      servers = importModule('ServersList')
    } else {
      return
    }
  }
}

const serversData = { servers, lastUpdate: null }

const theme = {
  textColorOnline: Color.green(),
  textColorOffline: Color.red(),
  textColorNoConnection: Color.gray(),
  textColorDefault: Color.dynamic(Color.black(), Color.white())
}

let widget = await createWidget();

if (!config.runsInWidget) {
    await widget.presentLarge();
}

Script.setWidget(widget);
Script.complete();
  
async function createWidget() {
  const widget = new ListWidget()
  const serversStack = widget.addStack()
  serversStack.layoutVertically()
  const { servers } = serversData

  for (const server of servers) {
    try {
      const req = new Request(server.url)
      await req.load()
      const { statusCode } = req.response
      server.status = statusCode
    } catch (e) {
      console.log(`Error fetching ${server.title}: ${e}`)
    }
  }
  
  for (const server of servers) {
    const { status } = server
    let textColor, icon, notification = null
    
    if (status >= 200 && status < 300) {
      textColor = theme.textColorOnline
      icon = '🟢'
    } else if (status >= 400 && status < 600) {
      textColor = theme.textColorOffline
      icon = '🔴'
      notification = true
    } else if (status === null) {
      textColor = theme.textColorNoConnection
      icon = '⚪️'
    } else {
      textColor = theme.textColorDefault
      icon = `${status} ⚫️`
    }

    const serverInfo = serversStack.addStack()
    serverInfo.layoutHorizontally()
    const serverName = serverInfo.addText(server.title)
    serverName.lineLimit = 1
    serverName.textColor = textColor
    serverInfo.addSpacer()
    serverInfo.addText(icon).textColor = textColor
    
    if (notification) {
      const not = new Notification()
      not.title = `Server ${server.title} is down`
      not.body = `Status: ${status}`
      not.threadIdentifier = `server-healthz-${server.title}`
      not.sound = 'piano_error'

      const previousNotifications = await Notification.allDelivered()
      const sameThreadNotifications = previousNotifications.some(n => n.threadIdentifier === not.threadIdentifier)

      if (!sameThreadNotifications) {
        await not.schedule()
      }
    }
  }
  
  serversData.lastUpdate = new Date()
  
  await setWidgetBackground(widget)

  return widget;
}
