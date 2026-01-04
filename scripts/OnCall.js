// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: phone-volume;

/**
 * Script to manage Jesus' On-Call shifts
 * 
 * Called from iOS Shortcuts with parameters:
 * - currentFocusMode: The current focus mode
 * 
 * Functionality:
 * - Checks for "Jesus On-Call" events in the calendar
 * - Interactive notifications to select focus mode (on-call)
 * - Determines if it should change to Rest mode (Friday post-on-call)
 * - Returns the focus mode to activate to the shortcut
 */

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  calendarName: "On-Call", // Name of the calendar to search
  eventSearchText: "Jesus On-Call", // Exact text to search in events
  focusModes: {
    work: "Trabajo",
    rest: "Descanso"
  }
};

// ============================================================
// MAIN FUNCTIONS
// ============================================================

/**
 * Checks current and yesterday's on-call status in a single query
 * Returns an object with both states
 */
async function checkOnCallStatusComplete() {
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  // For all-day events comparison, we need date-only (no time)
  const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayDateOnly = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  
  let isOnCallNow = false;
  let wasOnCallYesterday = false;
  
  const calendars = await Calendar.forEvents();
  const targetCalendar = calendars.find(cal => cal.title === CONFIG.calendarName);
  
  if (!targetCalendar) {
    console.log(`⚠️ Calendar "${CONFIG.calendarName}" not found`);
    return { isOnCallNow: false, wasOnCallYesterday: false };
  }
  
  console.log(`✓ Found calendar: ${targetCalendar.title}`);
  
  const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const endDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  const events = await CalendarEvent.between(startDate, endDate, [targetCalendar]);
    
  for (const event of events) {
    if (event.title.includes(CONFIG.eventSearchText) && event.isAllDay) {
      const eventStartDate = new Date(event.startDate.getFullYear(), event.startDate.getMonth(), event.startDate.getDate());
      const eventEndDate = new Date(event.endDate.getFullYear(), event.endDate.getMonth(), event.endDate.getDate());
      
      if (eventStartDate <= todayDateOnly && eventEndDate >= todayDateOnly) {
        console.log(`✓ Active all-day event now: ${event.title}`);
        console.log(`  Start: ${event.startDate}`);
        console.log(`  End: ${event.endDate}`);
        isOnCallNow = true;
      }
      
      if (eventStartDate <= yesterdayDateOnly && eventEndDate >= yesterdayDateOnly) {
        console.log(`✓ Active all-day event yesterday: ${event.title}`);
        wasOnCallYesterday = true;
      }
    }
    
    if (isOnCallNow && wasOnCallYesterday) {
      break;
    }
  }
  
  return {
    isOnCallNow,
    wasOnCallYesterday
  };
}

/**
 * Gets arguments passed from iOS shortcut
 */
function getShortcutArguments() {
  const params = args.shortcutParameter;
  
  if (!params) {
    console.log("⚠️ No arguments received from shortcut");
    return {
      currentFocusMode: null
    };
  }
  
  return {
    currentFocusMode: params.currentFocusMode || null
  };
}

/**
 * Shows interactive notification to choose focus mode
 * Returns the mode selected by the user
 */
async function showOnCallNotification() {
  const notification = new Notification();
  notification.title = "🚨 Turno de On-Call Activo";
  notification.body = "Selecciona el modo de concentración para esta noche";
  notification.sound = "default";
  
  notification.addAction("💼 Trabajo", CONFIG.focusModes.work, false);
  notification.addAction("🌙 Descanso", CONFIG.focusModes.rest, false);
  notification.addAction("❌ Cancelar", "cancel", true);
  
  const action = await notification.schedule();
  
  if (action === CONFIG.focusModes.work || action === CONFIG.focusModes.rest) {
    return action;
  }
  
  return null;
}

/**
 * Determines if it's Friday
 */
function isFriday() {
  const now = new Date();
  return now.getDay() === 5; // 5 = Friday
}

// ============================================================
// MAIN EXECUTION
// ============================================================

async function main() {
  console.log("====================================");
  console.log("On-Call Management Script");
  console.log(`Date/Time: ${new Date()}`);
  console.log("====================================");
  
  const { currentFocusMode } = getShortcutArguments();
  console.log(`Current focus mode: ${currentFocusMode}`);
  
  let result = {
    action: "none",
    mode: null,
    message: ""
  };
  
  const { isOnCallNow, wasOnCallYesterday } = await checkOnCallStatusComplete();
  
  if (isOnCallNow) {
    // ===== CASE 1: ON-CALL ACTIVE =====
    console.log("✓ ON-CALL ACTIVE");
    
    const selectedMode = await showOnCallNotification();
    
    if (selectedMode) {
      result.action = "activate_mode";
      result.mode = selectedMode;
      result.message = `On-call active. User selected mode: ${selectedMode}`;
      console.log(`✓ User selected: ${selectedMode}`);
    } else {
      result.action = "no_action";
      result.message = "On-call active but user cancelled selection";
      console.log("⚠️ User cancelled selection");
    }
    
  } else {
    // ===== CASE 2: NO ON-CALL =====
    console.log("✗ No on-call active");
    
    if (isFriday() && wasOnCallYesterday) {
      // ===== SUBCASE 2A: FRIDAY AFTER ON-CALL =====
      console.log("📅 Friday after on-call");
      console.log(`Current mode received: ${currentFocusMode}`);
      
      if (currentFocusMode === CONFIG.focusModes.work) {
        result.action = "activate_mode";
        result.mode = CONFIG.focusModes.rest;
        result.message = "Friday post-on-call with Work mode active. Change to Rest.";
        console.log("✓ Returning Rest mode to activate");
      } else {
        result.action = "no_action";
        result.message = `Friday post-on-call but current mode is ${currentFocusMode}, no change.`;
        console.log("ℹ️ Mode is no longer Work, no change made");
      }
    } else {
      // ===== SUBCASE 2B: FREE DAY =====
      result.action = "no_action";
      result.message = "Free day, no on-call active";
      console.log("🌙 Free day");
    }
  }
  
  console.log("====================================");
  console.log("Resultado:");
  console.log(`  Action: ${result.action}`);
  console.log(`  Mode: ${result.mode}`);
  console.log(`  Message: ${result.message}`);
  console.log("====================================");
  
  return result;
}

const output = await main();
Script.setShortcutOutput(output);
