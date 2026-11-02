// The burn-ban line on the card, in both engines at the sizes we ship for, on every road it can take.
// Usage: node tools/shoot_burn.mjs <outDir>   (the site served at http://127.0.0.1:4317)
// Checks per view and per road: the right words, no console or page errors, the line fits its card (no sideways overflow), and a
// screenshot of the card scrolled to the line. Roads: the real file; a file whose last check is 3 days old; a file that does not
// exist (404); a file that is not JSON.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const fs = await import("fs");
const OUT = process.argv[2] || "C:/Users/luxbo/Documents/Code/StarFinder/docs/screens/burn";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4317/StarFinder.html";
const views = [["desktop-1440", 1440, 900, 1, false], ["phone-390", 390, 844, 3, true], ["fold-cover-344", 344, 882, 2.625, true], ["phone-land-844", 844, 390, 3, true]];
const real = JSON.parse(fs.readFileSync("C:/Users/luxbo/Documents/Code/StarFinder/data/burnbans.json", "utf8"));
// the state-park case follows today's file (Inks Lake was the example until Burnet County left the list on Nov 2): the first
// Texas state park under a ban in exactly one county, and the words it must show
const stateBan = Object.entries(real.places).find(([id, r]) => id.startsWith("tx-") && r.status === "ban" && r.counties.length === 1);
const SB = stateBan[0], SBC = stateBan[1].banned[0];
const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const places = [["tx-colorado-bend", /No county burn ban reported; check the park's rules/, /San Saba and Lampasas Counties/],
  [SB, rx(`Burn ban in effect (${SBC} County)`), rx(`Looked up for ${SBC} County`)],
  ["nps-bibe", /Burn ban in effect \(Brewster County\)/, /federal land/],
  ["ok-turner-falls", /not tracked for Oklahoma/, null]];
const roads = {
  real: null,
  stale: (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...real, checked: new Date(Date.now() - 3 * 864e5).toISOString().replace(/\.\d+Z/, "Z") }) }),
  missing: (r) => r.fulfill({ status: 404, body: "not found" }),
  notjson: (r) => r.fulfill({ contentType: "application/json", body: "<html>moved</html>" }),
};
const expectRoad = { stale: /out of date/, missing: /not available right now/, notjson: /not available right now/ };
let bad = 0, n = 0; const rows = [];
for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(engineName === "chromium" ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  for (const [vn, w, h, dpr, touch] of views) {
    if (engineName === "webkit" && !touch && vn !== "desktop-1440") continue;
    for (const [road, handler] of Object.entries(roads)) {
      for (const [pid, leadRe, detailRe] of places) {
        if (road !== "real" && pid !== "tx-colorado-bend" && pid !== SB) continue;
        if (road !== "real" && vn !== "desktop-1440" && vn !== "phone-390") continue;
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && engineName === "chromium" });
        const page = await ctx.newPage(); const errs = [];
        page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));
        page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
        await page.route(/weather\.gov|open-meteo/, (r) => r.abort());
        if (handler) await page.route(/data\/burnbans\.json/, handler);
        const tag = `${engineName}-${vn}-${road}-${pid}`; let note = "ok";
        try {
          await page.goto(`${BASE}#p=${pid}`, { waitUntil: "load" });
          await page.waitForSelector("#burnSlot .burn", { timeout: 15000 });
          await page.waitForTimeout(700);
          const m = await page.evaluate(() => {
            const slot = document.querySelector("#burnSlot"), b = slot.querySelector(".burn"), card = document.querySelector("#card");
            slot.scrollIntoView({ block: "center" });
            const r = b.getBoundingClientRect(), c = card.getBoundingClientRect(), body = card.querySelector(".body");
            return { text: b.innerText.replace(/\s+/g, " "), cls: b.className, w: Math.round(r.width), left: Math.round(r.left), right: Math.round(r.right), cardRight: Math.round(c.right),
              cardLeft: Math.round(c.left), bodyScrollW: body.scrollWidth, bodyClientW: body.clientWidth, pageScrollW: document.documentElement.scrollWidth, vw: innerWidth,
              border: getComputedStyle(b).borderColor, leadColor: getComputedStyle(b.querySelector(".burn-lead")).color, linkOK: !!b.querySelector('a[href^="https://tfsweb.tamu.edu"]') };
          });
          const wantLead = road === "real" ? leadRe : expectRoad[road];
          if (!wantLead.test(m.text)) { note = "WRONG TEXT: " + m.text.slice(0, 120); }
          else if (road === "real" && detailRe && !detailRe.test(m.text)) note = "WRONG DETAIL: " + m.text.slice(0, 200);
          else if (m.left < m.cardLeft - 1 || m.right > m.cardRight + 1) note = "OVERFLOWS CARD " + JSON.stringify([m.left, m.right, m.cardLeft, m.cardRight]);
          else if (m.bodyScrollW > m.bodyClientW + 1 || m.pageScrollW > m.vw + 1) note = "SIDEWAYS SCROLL " + JSON.stringify([m.bodyScrollW, m.bodyClientW, m.pageScrollW, m.vw]);
          else if (errs.length) note = "ERRORS " + errs.join(" | ");
          else if ((road === "real") && /^Burn ban/.test(m.text) === false && /is-ban/.test(m.cls)) note = "class/text mismatch";
          if (road === "real" && !m.linkOK && !/Oklahoma/.test(m.text)) note = "MISSING SOURCE LINK";
          await page.screenshot({ path: `${OUT}/${tag}.png` });
          rows.push(`${note === "ok" ? "ok  " : "FAIL"} ${tag}: ${m.text.slice(0, 150)}${note === "ok" ? "" : "   <<< " + note}`);
        } catch (e) { note = "EXC " + String(e).slice(0, 140); rows.push("FAIL " + tag + " " + note); }
        n++; if (note !== "ok") bad++;
        await ctx.close();
      }
    }
  }
  await browser.close();
}
console.log(rows.join("\n")); console.log(`\n${n - bad} of ${n} views passed`);
process.exit(bad ? 1 : 0);
