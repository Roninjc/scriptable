// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: satellite-dish;
//
// WorldwideConfig — enables/disables the encrypted relay from a deep link.
// The Worldwide PWA drives everything; there is no manual entry here.
//
//   scriptable:///run/WorldwideConfig?action=ping&hello=world     → spike test, no side effects
//   scriptable:///run/WorldwideConfig?action=set&url=…&id=…&pass=… → store relay keys + first push
//   scriptable:///run/WorldwideConfig?action=clear                → remove relay keys (stop publishing)
//
// Keys live in this device's Keychain: ww_relay_url / ww_relay_id / ww_relay_pass.

const q = args.queryParameters || {};
const action = (q.action || "").trim();

async function note(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction("OK");
  await a.present();
}

const RELAY_KEYS = ["ww_relay_url", "ww_relay_id", "ww_relay_pass"];

if (action === "ping") {
  // Spike: prove the app can launch this script with parameters. No side effects.
  const seen = Object.keys(q).map((k) => `${k} = ${q[k]}`).join("\n") || "(no params)";
  await note("Deep link OK ✓", "WorldwideConfig ran with:\n\n" + seen);
} else if (action === "set") {
  const url = (q.url || "").trim();
  const id = (q.id || "").trim();
  const pass = q.pass || "";
  if (!url || !id || !pass) {
    await note("Worldwide", "The link is missing url, id or pass.");
  } else {
    Keychain.set("ww_relay_url", url);
    Keychain.set("ww_relay_id", id);
    Keychain.set("ww_relay_pass", pass);

    // Push right away so the app has data immediately (best effort).
    let extra = "";
    try {
      const sync = importModule("CountriesAYearSync");
      const res = await sync.pushToRelay();
      extra = res.ok
        ? `\n\nUploaded ${res.count} entries to the relay.`
        : `\n\nConfig saved, but the first upload returned ${res.status ?? res.reason}.`;
    } catch (e) {
      extra = `\n\nConfig saved. First upload skipped (${e}).`;
    }
    await note("Worldwide sync enabled", "This device will now publish to the relay." + extra);
  }
} else if (action === "clear") {
  for (const k of RELAY_KEYS) {
    if (Keychain.contains(k)) Keychain.remove(k);
  }
  await note(
    "Worldwide sync disabled",
    "Relay keys removed from this device. The widget will stop publishing."
  );
} else {
  await note("Worldwide", "Open this from the Worldwide app (Sync page).\n\nUnknown action: " + (action || "none"));
}

Script.complete();
