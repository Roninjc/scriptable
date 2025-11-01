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
 */

module.exports.setWidgetBackground = async (widget) => {
  if (!widget) {
    console.warn('No widget received')
    return
  }

  /* Get widget args */
  const fm = FileManager.iCloud();
  const widgetInputRAW = args.widgetParameter;
  const widgetSize = config.widgetFamily
  
  /* Widget default variables */
  const defaultImgName = "bo"; // Adapt this to your background image name or name your background image like this
  const themeBackgroundColor = Color.dynamic(Color.white(), Color.darkGray())

  let widgetInput = null;
  
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

    /* Build background image path */
  const imgName = Device.isUsingDarkAppearance() ? defaultImgName + "-just-blur.jpg" : defaultImgName + "-light-blur.jpg"
  const scriptablePath = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents/Backgrounds/';  
  const bgImgPath = `${scriptablePath}${widgetSize}/${widgetInput}/${imgName}`
  let imgFromFile = null

  try {
    await fm.downloadFileFromiCloud(bgImgPath)
    imgFromFile = fm.readImage(bgImgPath);
  } catch(e) {
    console.warn(`[WIDGETBACKGROUND] Error downloading file from iCloud: ${e}`)
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
