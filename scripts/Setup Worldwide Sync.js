// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: motorcycle;
//
// One-time setup for Worldwide encrypted sync.
//
// In the Worldwide app: Sync → "Automatic (encrypted)" → fill the relay URL and a
// passphrase → "Copy config". That copies {"url":...,"id":...}. Paste it here and
// type the SAME passphrase. Everything is stored in the Keychain on this device.

async function note(title, message) {
  const n = new Alert();
  n.title = title;
  n.message = message;
  n.addAction("OK");
  await n.present();
}

const stored = {
  url: Keychain.contains("ww_relay_url") ? Keychain.get("ww_relay_url") : "",
  id: Keychain.contains("ww_relay_id") ? Keychain.get("ww_relay_id") : ""
};

const a = new Alert();
a.title = "Worldwide sync setup";
a.message =
  'Paste the config copied from the app (the {"url":…,"id":…} text) and type the same passphrase you set there.';
a.addTextField("Config JSON", stored.url && stored.id ? JSON.stringify(stored) : "");
a.addSecureTextField("Passphrase", "");
a.addAction("Save");
a.addCancelAction("Cancel");

const idx = await a.present();

if (idx !== -1) {
  const raw = a.textFieldValue(0).trim();
  const pass = a.textFieldValue(1);

  let cfg = null;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    cfg = null;
  }

  if (!cfg) {
    await note("Invalid config", "Couldn't parse the config JSON. Copy it again from the app.");
  } else if (!cfg.url || !cfg.id) {
    await note("Missing fields", "The config must include both url and id.");
  } else if (!pass || pass.length < 6) {
    await note("Weak passphrase", "The passphrase must be at least 6 characters and match the app.");
  } else {
    Keychain.set("ww_relay_url", String(cfg.url));
    Keychain.set("ww_relay_id", String(cfg.id));
    Keychain.set("ww_relay_pass", pass);

    // Push immediately so the app has data right away.
    try {
      const sync = importModule("CountriesAYearSync");
      const res = await sync.pushToRelay();
      await note(
        res.ok ? "Saved & synced" : "Saved (sync issue)",
        res.ok
          ? `Uploaded ${res.count} entries to the relay.`
          : `Config saved, but the upload returned ${res.status ?? res.reason}.`
      );
    } catch (e) {
      await note("Saved", `Config saved. First upload failed: ${e}`);
    }
  }
}

Script.complete();
