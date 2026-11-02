// The delisted places stay out of the page: not in the list, not on the map, no card from a deep link, and the count says how
// many are listed. Usage: node tools/check_delist_view.mjs [baseUrl]   (default http://127.0.0.1:4317/StarFinder.html)
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const fs = await import("fs");
const BASE = process.argv[2] || "http://127.0.0.1:4317/StarFinder.html";
const data = JSON.parse(fs.readFileSync(new URL("../data/places.json", import.meta.url), "utf8"));
const off = data.places.filter((p) => p.listed === false).map((p) => p.id), on = data.places.length - off.length;
let bad = 0;
for (const [en, eng] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await eng.launch();
  for (const [vn, w, h, dpr, touch] of [["desktop-1440", 1440, 900, 1, false], ["phone-390", 390, 844, 3, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && en === "chromium" });
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
    await p.route(/weather\.gov|open-meteo/, (r) => r.abort());
    await p.goto(`${BASE}?v=${Date.now()}#p=${off[0]}`, { waitUntil: "load" });
    await p.waitForFunction(() => window.__sf && window.__sf.places.length, null, { timeout: 30000 });
    await p.waitForFunction(() => window.__sf.mapReady, null, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const m = await p.evaluate((off) => ({
      n: window.__sf.places.length, rows: document.querySelectorAll(".row").length, count: document.querySelector("#count").textContent,
      offRows: off.filter((id) => document.querySelector(`.row[data-id="${id}"]`)), offInState: off.filter((id) => window.__sf.byId.has(id)),
      card: !document.querySelector("#card").hidden,
      mapOff: window.__sf.map && window.__sf.map.getSource && window.__sf.map.getSource("places") ? off.filter((id) => window.__sf.map.querySourceFeatures("places", { filter: ["==", ["get", "id"], id] }).length) : null,
    }), off);
    const ok = m.n === on && m.rows === on && m.count.startsWith(`${on} of ${on} places`) && !m.offRows.length && !m.offInState.length && !m.card && (m.mapOff == null || !m.mapOff.length) && !errs.length;
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${en}-${vn}: ${JSON.stringify(m)}${errs.length ? " ERR " + errs.join(" | ") : ""}`);
    await ctx.close();
  }
  await b.close();
}
console.log(`delisted: ${off.join(", ")}; listed: ${on}`);
process.exit(bad ? 1 : 0);
