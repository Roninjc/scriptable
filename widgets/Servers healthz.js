/**
 * Servers healthz widget
 * 
 * This widget checks the health status of predefined servers and displays their status.
 */
const { setWidgetBackground } = importModule('SetWidgetBackground')

const serversData = {
  servers:[
    {
      url: 'https://pve.milkyhome.eu',
      title: 'Proxmox',
      status: null,
    },
    {
      url: 'https://haos.milkyhome.eu',
      title: 'Homa assistant',
      status: null,
    },
    {
      url: 'https://passbolt.milkyhome.eu',
      title: 'Passbolt',
      status: null,
    }
  ],
  lastUpdate: null
}

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
  const { servers, lastUpdate } = serversData

  for (const server of servers) {
    try {
      const req = new Request(server.url)
      await req.load()
      const { statusCode } = req.response
      server.status = statusCode
    } catch (e) {
      console.log(e)
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
