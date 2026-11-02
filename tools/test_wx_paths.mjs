// The forecast's other roads, each made to happen on purpose: NWS down (Open-Meteo answers, with its credit), both down
// (a plain message and Try again), offline (a message, then the week arrives by itself on reconnect), the 30-minute cache
// (no second request), and an expired copy shown, labelled, when offline. Run with the site on http://127.0.0.1:4317.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const OUT = process.argv[2] || ".";
const BASE = "http://127.0.0.1:4317/StarFinder.html#p=tx-enchanted-rock";
const results = []; let failures = 0;
const check = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failures++; };
const wxText = (page) => page.evaluate(() => { const c = document.querySelector("#wxCard"); return c ? { busy: c.hasAttribute("aria-busy"), days: c.querySelectorAll(".wx-day:not(.is-wait)").length, text: c.textContent.replace(/\s+/g, " ").trim().slice(0, 260), src: ((c.querySelector(".wx-src") || {}).textContent || "").trim() } : null; });
const openPlace = async (page, phone) => {   // through the real list, as a person would
  if (phone) { await page.click("#burger"); await page.waitForTimeout(300); }
  await page.click('.row[data-id="tx-enchanted-rock"]'); await page.waitForTimeout(phone ? 1400 : 600);
  if (phone) { await page.click(".pop [data-details]"); await page.waitForTimeout(500); }
};
const waitWx = (page) => page.waitForFunction(() => { const c = document.querySelector("#wxCard"); return window.__sf && window.__sf.mapReady && c && !c.hasAttribute("aria-busy"); }, null, { timeout: 25000 });

for (const [eng, E, vp] of [["chromium", chromium, { width: 1440, height: 900 }], ["webkit", webkit, { width: 390, height: 844 }]]) {
  const b = await E.launch();
  const fresh = async () => { const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 1, hasTouch: eng === "webkit" }); const page = await ctx.newPage();
    const errs = []; page.on("pageerror", (e) => { const m = String(e);   // the map's own tile fetches failing when the test cuts the
      if (!/tiles\/|blob:|openfreemap|gibs\.earthdata/.test(m)) errs.push(m); });  // network are MapLibre's, not the forecast's; they are not counted here
    const req = []; page.on("request", (r) => { if (/weather\.gov|open-meteo/.test(r.url())) req.push(r.url()); });
    return { ctx, page, errs, req }; };

  // 1. NWS down: Open-Meteo answers and is credited beside the data
  { const { ctx, page, errs } = await fresh();
    await ctx.route(/api\.weather\.gov/, (r) => r.abort());
    await page.goto(BASE); await waitWx(page); const t = await wxText(page);
    await page.evaluate(() => document.querySelector("#wxCard").scrollIntoView({ block: "center" })); await page.screenshot({ path: `${OUT}/${eng}-path-openmeteo.png` });
    check(`${eng} NWS down -> Open-Meteo`, t.days === 7 && /Weather data by Open-Meteo\.com/.test(t.src) && errs.length === 0, t.src);
    await ctx.close(); }

  // 2. both down: a plain message and Try again, nothing thrown
  { const { ctx, page, errs } = await fresh();
    await ctx.route(/api\.weather\.gov|open-meteo/, (r) => r.abort());
    await page.goto(BASE); await waitWx(page); const t = await wxText(page);
    const retry = await page.$("#wxCard [data-wx-retry]");
    await page.evaluate(() => document.querySelector("#wxCard").scrollIntoView({ block: "center" })); await page.screenshot({ path: `${OUT}/${eng}-path-bothdown.png` });
    check(`${eng} both down -> message + Try again`, t.days === 0 && /didn't load/.test(t.text) && !!retry && errs.length === 0, t.text);
    await ctx.unrouteAll(); await retry.click(); await waitWx(page); const t2 = await wxText(page);
    check(`${eng} Try again after the services return`, t2.days === 7, t2.text.slice(0, 80));
    await ctx.close(); }

  // 3. offline, then back online: the message, then the week by itself
  { const { ctx, page, errs, req } = await fresh();
    await page.goto(BASE.replace(/#.*/, "")); await page.waitForTimeout(2500);
    await ctx.setOffline(true);
    await openPlace(page, eng === "webkit"); await page.waitForTimeout(800);
    const t = await wxText(page);
    await page.screenshot({ path: `${OUT}/${eng}-path-offline.png` });
    check(`${eng} offline -> message`, !!t && t.days === 0 && /offline/i.test(t.text), t && t.text);
    await ctx.setOffline(false); await page.waitForTimeout(400);
    await page.waitForFunction(() => document.querySelectorAll("#wxCard .wx-day:not(.is-wait)").length === 7, null, { timeout: 25000 }).catch(() => {});
    const t2 = await wxText(page);
    check(`${eng} back online -> the week arrives by itself`, !!t2 && t2.days === 7, t2 && t2.text.slice(0, 80));
    check(`${eng} offline path threw nothing`, errs.length === 0, errs.join(" | "));
    await ctx.close(); }

  // 4. the cache: close and reopen within 30 minutes asks nobody; 5. an expired copy shown, labelled, when offline
  { const { ctx, page, errs, req } = await fresh();
    await page.goto(BASE); await waitWx(page); const n1 = req.length;
    await page.evaluate(() => { document.querySelector("#cardClose").click(); });
    await page.evaluate(() => { location.hash = "p=tx-enchanted-rock"; }); await page.reload(); await waitWx(page);
    check(`${eng} reopen within 30 min -> no new request`, req.length === n1 && n1 >= 1, `requests ${n1} then ${req.length}`);
    await page.evaluate(() => { const k = "sf-wx1:tx-enchanted-rock", v = JSON.parse(localStorage.getItem(k)); v.t -= 3600e3; localStorage.setItem(k, JSON.stringify(v)); });
    await page.goto(BASE.replace(/#.*/, "")); await page.waitForTimeout(2500);   // a fresh page: nothing in memory, the old copy in storage
    await ctx.setOffline(true); await openPlace(page, eng === "webkit"); await page.waitForTimeout(800);
    const t = await wxText(page);
    await page.evaluate(() => document.querySelector("#wxCard") && document.querySelector("#wxCard").scrollIntoView({ block: "center" })); await page.screenshot({ path: `${OUT}/${eng}-path-stale.png` });
    check(`${eng} expired copy, offline -> shown and labelled`, !!t && t.days === 7 && /saved .*offline/.test(t.src), t && t.src);
    check(`${eng} cache paths threw nothing`, errs.length === 0, errs.join(" | "));
    await ctx.close(); }
  await b.close();
}
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, "::", String(r.detail).slice(0, 170));
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
