// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: image;

/**
 * Function to be called from a widget script to set widget background based on widget parameter
 * or fallback to default background color
 *
 * The widget parameter can be:
 * - a folder name inside Scriptable/Backgrounds/[small|medium|large]/[top/middle/bottom]/[left|right]/ to set an image as background depending on widget size (gotten by the script) and screen vertical and horizontal position (gotten from the widget parameter), so parameter should be something like: "top/left", "middle/right", "bottom/left", etc.
 * - a color name or hex code to set a solid background color
 * - nothing, to fallback to a default background color
 *
 * Image backgrounds are resolved entirely through the BackgroundConfig helper
 * (active key from defbg.txt, then the registry's defaultKey) — file locations
 * live only there. This module must NEVER break a widget: without the helper
 * (or on any failure) it simply degrades to the color/theme fallbacks below.
 */

let bgConf = null
try {
  bgConf = importModule('BackgroundConfig')
} catch (e) {
  console.warn(`[WIDGETBACKGROUND] BackgroundConfig unavailable, image backgrounds disabled: ${e}`)
}

// Active key from defbg.txt, then registry defaultKey; '' when unresolvable.
const resolveActiveKey = async () => {
  if (!bgConf) return ''
  try {
    const key = await bgConf.getActiveKey()
    if (key) return key
    return (await bgConf.load()).defaultKey || ''
  } catch (e) {
    console.warn(`[WIDGETBACKGROUND] Error resolving active key: ${e}`)
    return ''
  }
}

module.exports.setWidgetBackground = async (widget) => {
  if (!widget) {
    console.warn('No widget received')
    return
  }

    /* Set vars */
  const themeBackgroundColor = Color.dynamic(Color.white(), Color.darkGray());

    /* Get widget args */
  const widgetInputRAW = args.widgetParameter;
  const widgetSize = config.widgetFamily;
  let widgetInput = null;

    /* Validate widget input */
  try {
    if (!widgetInputRAW) {
      throw new Error('Nothing set as widget parameter.')
    }
    widgetInput = widgetInputRAW.toString();
    if (!widgetInput) {
      throw new Error(`Received empty string, fallback param "${widgetInput}".`)
    }
  } catch(e) {
    console.warn(`[WIDGETBACKGROUND] Error reading param: ${e}`);
  }

    /* Load background image, if everything needed is known */
  const activeKey = await resolveActiveKey()
  let imgFromFile = null
  if (activeKey && widgetSize && widgetInput) {
    const imgName = Device.isUsingDarkAppearance() ? `${activeKey}-dark.jpg` : `${activeKey}-light.jpg`
    const bgImgPath = bgConf.fm.joinPath(bgConf.backgroundsRoot, `${widgetSize}/${widgetInput}/${imgName}`)
    try {
      await bgConf.fm.downloadFileFromiCloud(bgImgPath)
      imgFromFile = bgConf.fm.readImage(bgImgPath);
    } catch(e) {
      console.warn(`[WIDGETBACKGROUND] Error downloading image from iCloud: ${e}`)
    }
  }

  if (imgFromFile) {
    try {
      widget.backgroundImage = imgFromFile
    } catch (error) {
      console.warn(`[WIDGETBACKGROUND] Set background image - ${error} - ${imgFromFile}`)
    }
  } else if (widgetInput) {
    try {
      widget.backgroundColor = new Color(`${widgetInput}`);
    } catch (error) {
      console.warn(`[WIDGETBACKGROUND] Set background color - ${error}`)
    }
  } else {
    try {
      widget.backgroundColor = themeBackgroundColor
    } catch (error) {
      console.warn(`[WIDGETBACKGROUND] Set fallback background color - ${error}`)
    }
  }
}
