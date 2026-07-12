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
  
    /* Set vars */
  const fm = (() => {
    try { return FileManager.iCloud(); }
    catch (e) { return FileManager.local(); }
  })();
  const scriptablePath = `${fm.documentsDirectory()}/`;
  const defbgImgFile = `${scriptablePath}defbg.txt`;
  const bgPath = `${scriptablePath}Backgrounds/`
  const themeBackgroundColor = Color.dynamic(Color.white(), Color.darkGray());

  let defaultImgName = '';
  let widgetInput = null;

    /* Get widget args */
  const widgetInputRAW = args.widgetParameter;
  const widgetSize = config.widgetFamily;
  
    /* Get bg image name from file */
  try {
    await fm.downloadFileFromiCloud(defbgImgFile);
    defaultImgName = fm.readString(defbgImgFile);
  } catch(e) {
    console.warn(`[WIDGETBACKGROUND] Error downloading file from iCloud: ${e}`)
  }
console.log(`----- ${defaultImgName}, ${defbgImgFile}`)
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

    /* Build background image path */
  const imgName = Device.isUsingDarkAppearance() ? defaultImgName + "-dark.jpg" : defaultImgName + "-light.jpg"
  const bgImgPath = `${bgPath}${widgetSize}/${widgetInput}/${imgName}`
  let imgFromFile = null

  try {
    await fm.downloadFileFromiCloud(bgImgPath)
    imgFromFile = fm.readImage(bgImgPath);
  } catch(e) {
    console.warn(`[WIDGETBACKGROUND] Error downloading image from iCloud: ${e}`)
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
