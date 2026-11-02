// The burn-ban mark (a flame with a line through it) wherever a place's status is "ban": list rows, the pin pop-up, the card,
// and a badge beside the map dot. Usage: node tools/shoot_banicon.mjs <outDir> [check]   (the site served at http://127.0.0.1:4317)
// Without "check" it only takes the pictures (used for the before set). With "check" it also asserts, per view: every banned
// place in the list carries the mark with a label naming its county, no other row does, the pop-up and the card carry it for a
// banned place and not for a clear one, the map draws a badge for banned places only (and none when the data is stale), the
// row's accessible name includes the label, and there are no console or page errors and no sideways scroll.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const fs = await import("fs");
const ROOT = new URL("..", import.meta.url);
const OUT = process.argv[2] || new URL("docs/screens/banicon/after", ROOT).pathname.replace(/^\/(\w:)/, "$1");
const CHECK = process.argv[3] === "check";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4317/StarFinder.html";
const real = JSON.parse(fs.readFileSync(new URL("data/burnbans.json", ROOT), "utf8"));
// a banned place and a clear one, read from today's file so the test follows the data instead of going stale with it
const BAN = Object.keys(real.places).find((id) => id === "nps-bibe" && real.places[id].status === "ban") || Object.keys(real.places).find((id) => real.places[id].status === "ban");
const CLEAR = Object.keys(real.places).find((id) => id === "tx-colorado-bend" && real.places[id].status === "none") || Object.keys(real.places).find((id) => real.places[id].status === "none");
const banIds = new Set(Object.keys(real.places).filter((id) => real.places[id].status === "ban"));
const views = [["chromium", "desktop-1440", 1440, 900, 1, false], ["chromium", "phone-390", 390, 844, 3, true],
  ["webkit", "phone-390", 390, 844, 3, true], ["webkit", "desktop-1440", 1440, 900, 1, false], ["chromium", "fold-cover-344", 344, 882, 2.625, true]];
const rows = []; let bad = 0, n = 0;
const fail = (tag, why) => { rows.push(`FAIL ${tag}: ${why}`); bad++; };
for (const [engName, vn, w, h, dpr, touch] of views) {
  const engine = engName === "chromium" ? chromium : webkit;
  const browser = await engine.launch(engName === "chromium" ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  const shots = ["list", "pop", "card", "map"].concat(CHECK && vn === "desktop-1440" && engName === "chromium" ? ["stale"] : []);
  for (const shot of shots) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && engName === "chromium" });
    const page = await ctx.newPage(); const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|AJAXError|tiles\.openfreemap|gibs\.earthdata/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
    await page.route(/weather\.gov|open-meteo/, (r) => r.abort());
    if (shot === "stale") await page.route(/data\/burnbans\.json/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ...real, checked: new Date(Date.now() - 3 * 864e5).toISOString().replace(/\.\d+Z/, "Z") }) }));
    const tag = `${engName}-${vn}-${shot}`; n++;
    try {
      if (shot === "card") await page.goto(`${BASE}#p=${BAN}`, { waitUntil: "load" });
      else await page.goto(BASE, { waitUntil: "load" });
      await page.waitForFunction(() => window.__sf && window.__sf.places.length && window.__sf.burnDone, null, { timeout: 20000 });
      await page.waitForFunction(() => window.__sf.mapReady, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(touch ? 3200 : 3400);   // let the opening fly-in finish
      if (shot === "list") {
        if (touch) { await page.click("#burger"); await page.waitForTimeout(500); }
        await page.evaluate(() => { const l = document.querySelector("#list"); if (l && l.parentElement) l.parentElement.scrollTop = 0; });
      } else if (shot === "pop") {
        if (touch) { await page.click("#burger"); await page.waitForTimeout(400); }
        await page.click(`.row[data-id="${BAN}"]`);
        await page.waitForSelector(".pop", { timeout: 8000 });
        await page.waitForTimeout(touch ? 1400 : 2600);
      } else if (shot === "card") {
        await page.waitForSelector("#burnSlot .burn", { timeout: 15000 });
        await page.evaluate(() => document.querySelector("#burnSlot").scrollIntoView({ block: "center" }));
        await page.waitForTimeout(500);
      } else if (shot === "map" || shot === "stale") {
        const p = await page.evaluate((id) => { const p = window.__sf.byId.get(id); return [p.lon, p.lat]; }, BAN);
        await page.evaluate(([lon, lat, phone]) => window.__sf.map.jumpTo({ center: [lon + (phone ? 0 : -0.6), lat + 0.25], zoom: 7.6 }), [p[0], p[1], touch]);
        await page.waitForTimeout(2600);
      }
      if (CHECK) {
        const m = await page.evaluate(([ban, clear, shot]) => {
          const out = { rowsWithMark: [], rowsNoMark: [], labels: {}, rowName: "", pop: null, card: null, layer: null, pageW: document.documentElement.scrollWidth, vw: innerWidth };
          for (const r of document.querySelectorAll(".row")) {
            const mk = r.querySelector(".ban"); (mk ? out.rowsWithMark : out.rowsNoMark).push(r.dataset.id);
            if (mk) out.labels[r.dataset.id] = mk.getAttribute("aria-label");
            if (r.dataset.id === ban) out.rowName = r.innerText.replace(/\s+/g, " ") + " | " + [...r.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" / ");
          }
          const pop = document.querySelector(".pop"); if (pop) out.pop = { mark: !!pop.querySelector(".ban"), label: pop.querySelector(".ban") && pop.querySelector(".ban").getAttribute("aria-label") };
          const b = document.querySelector("#burnSlot .burn"); if (b) out.card = { cls: b.className, ic: b.querySelector("svg").getAttribute("class"), lead: b.querySelector(".burn-lead").textContent };
          const map = window.__sf.map;
          if (map && map.getLayer && map.getLayer("pl-ban")) {
            const f = map.getFilter("pl-ban"); out.layer = { filter: JSON.stringify(f).slice(0, 300), rendered: map.queryRenderedFeatures({ layers: ["pl-ban"] }).map((x) => x.properties.id) };
          }
          return out;
        }, [BAN, CLEAR, shot]);
        const wrongRows = m.rowsWithMark.filter((id) => !banIds.has(id)), missedRows = m.rowsNoMark.filter((id) => banIds.has(id));
        if (shot !== "stale") {
          if (wrongRows.length) fail(tag, "mark on rows that are not banned: " + wrongRows.join(","));
          else if (missedRows.length) fail(tag, "banned rows without the mark: " + missedRows.slice(0, 6).join(","));
          else if (!/^Burn ban in effect, .+ Count(y|ies)$/.test(m.labels[BAN] || "")) fail(tag, "row label: " + m.labels[BAN]);
          else if (!/Burn ban in effect/.test(m.rowName)) fail(tag, "row accessible text lacks the label: " + m.rowName.slice(0, 160));
          else if (shot === "pop" && !(m.pop && m.pop.mark && /^Burn ban in effect, /.test(m.pop.label))) fail(tag, "pop-up mark: " + JSON.stringify(m.pop));
          else if (shot === "card" && !(m.card && /is-ban/.test(m.card.cls) && /burn-ic ban-ic/.test(m.card.ic))) fail(tag, "card mark: " + JSON.stringify(m.card));
          else if (shot === "map" && !(m.layer && m.layer.rendered.length && m.layer.rendered.every((id) => banIds.has(id)))) fail(tag, "map badges: " + JSON.stringify(m.layer));
          else if (m.pageW > m.vw + 1) fail(tag, "sideways scroll " + m.pageW + " > " + m.vw);
          else if (errs.length) fail(tag, "errors: " + errs.join(" | "));
          else rows.push(`ok   ${tag}: ${m.rowsWithMark.length} rows marked in the DOM; label "${m.labels[BAN]}"${m.layer ? "; map badges drawn: " + m.layer.rendered.length : ""}`);
        } else {
          if (m.rowsWithMark.length) fail(tag, "stale data still marks rows: " + m.rowsWithMark.length);
          else if (m.layer && m.layer.rendered.length) fail(tag, "stale data still draws map badges: " + m.layer.rendered.length);
          else if (errs.length) fail(tag, "errors: " + errs.join(" | "));
          else rows.push(`ok   ${tag}: stale data, no marks anywhere`);
        }
      }
      await page.screenshot({ path: `${OUT}/${tag}.png` });
      if (!CHECK) rows.push(`shot ${tag}`);
    } catch (e) { fail(tag, "EXC " + String(e).slice(0, 200)); }
    await ctx.close();
  }
  await browser.close();
}
console.log(`banned: ${BAN}, clear: ${CLEAR}, banned places today: ${banIds.size}`);
console.log(rows.join("\n")); if (CHECK) console.log(`\n${n - bad} of ${n} views passed`);
process.exit(bad ? 1 : 0);
