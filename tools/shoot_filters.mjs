// The filter row: its order (Dark Sky Places first, then one toggle per amenity icon, then the other filters), sideways
// scrolling, the AND logic of the icon toggles, the count and clear, and the state in the URL hash.
// Usage: node tools/shoot_filters.mjs <outDir> [check]   (the site served at http://127.0.0.1:4317)
// Without "check" it only photographs the row (the before set). With "check" it asserts, per view: the order; every toggle is a
// native button with aria-pressed and is at least 44 px on touch screens; one icon shows only places that have it (list and map
// agree with the data); two icons show only places that have BOTH and the count line says AND; Clear brings every place back;
// the hash carries the filters and a reload restores them; no console or page errors and no sideways page scroll.
import { createRequire } from "module";
const require = createRequire("C:/Users/luxbo/Documents/Code/sage-desktop/package.json");
const { chromium, webkit } = require("playwright");
const fs = await import("fs");
const OUT = process.argv[2], CHECK = process.argv[3] === "check";
fs.mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:4317/StarFinder.html";
const data = JSON.parse(fs.readFileSync(new URL("../data/places.json", import.meta.url), "utf8"));
const listed = data.places.filter((p) => p.listed !== false);
const has = (keys) => listed.filter((p) => keys.every((k) => p.amen && p.amen[k] === true)).map((p) => p.id).sort();
const views = [["chromium", "desktop-1440", 1440, 900, 1, false], ["chromium", "phone-390", 390, 844, 3, true], ["webkit", "phone-390", 390, 844, 3, true],
  ["chromium", "fold-cover-344", 344, 882, 2.625, true], ["webkit", "desktop-1440", 1440, 900, 1, false]];
let bad = 0, n = 0; const rows = [];
const fail = (tag, why) => { rows.push(`FAIL ${tag}: ${why}`); bad++; };
for (const [en, vn, w, h, dpr, touch] of views) {
  const b = await (en === "chromium" ? chromium : webkit).launch(en === "chromium" ? { args: ["--use-angle=d3d11", "--enable-gpu"] } : {});
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch && en === "chromium" });
  const page = await ctx.newPage(); const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|AJAXError|openfreemap|gibs/.test(m.text())) errs.push("console: " + m.text().slice(0, 160)); });
  await page.route(/weather\.gov|open-meteo/, (r) => r.abort());
  const tag = `${en}-${vn}`; n++;
  const open = async () => {
    await page.waitForFunction(() => window.__sf && window.__sf.places.length && window.__sf.burnDone, null, { timeout: 20000 });
    await page.waitForFunction(() => window.__sf.mapReady, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3200);
    if (touch) { await page.click("#burger"); await page.waitForTimeout(500); }
  };
  const shot = async (name) => {
    const box = await page.evaluate(() => { const c = document.querySelector(".chips").getBoundingClientRect(), l = document.querySelector("#list").getBoundingClientRect();
      return { x: 0, y: Math.max(0, c.top - 40), width: innerWidth, height: Math.min(innerHeight - Math.max(0, c.top - 40), (l.top - c.top) + 260) }; });
    await page.screenshot({ path: `${OUT}/${tag}-${name}.png`, clip: box });
  };
  try {
    await page.goto(BASE, { waitUntil: "load" }); await open();
    await shot("row");
    if (CHECK) {
      const order = await page.evaluate(() => [...document.querySelectorAll(".chips > *, .chips .amen-filters > *")].filter((e) => !e.classList.contains("amen-filters") && !e.classList.contains("sr-only"))
        .map((e) => e.dataset.filter || (e.dataset.amen ? "amen:" + e.dataset.amen : e.id)));
      const firstOther = order.findIndex((k, i) => i > 0 && !k.startsWith("amen:"));
      const amenIdx = order.map((k, i) => (k.startsWith("amen:") ? i : -1)).filter((i) => i >= 0);
      if (order[0] !== "darksky") fail(tag, "Dark Sky Places is not first: " + order.join(","));
      else if (!amenIdx.length || amenIdx[0] !== 1 || amenIdx.some((i, j) => i !== 1 + j) || firstOther !== 1 + amenIdx.length) fail(tag, "icons are not right after Dark Sky and before the others: " + order.join(","));
      const sizes = await page.evaluate(() => [...document.querySelectorAll(".chips button")].map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.amen || e.dataset.filter || e.id, Math.round(r.width), Math.round(r.height), e.tagName, e.getAttribute("aria-pressed")]; }));
      const small = sizes.filter(([, wd, ht]) => touch ? (wd < 44 || ht < 44) : (wd < 24 || ht < 24));
      if (small.length) fail(tag, "targets too small: " + JSON.stringify(small));
      if (sizes.some(([, , , tg, ap]) => tg !== "BUTTON" || (ap !== "false" && ap !== "true"))) fail(tag, "a toggle is not a native button with aria-pressed");
      const rowInfo = await page.evaluate(() => { const c = document.querySelector(".chips"); return { sw: c.scrollWidth, cw: c.clientWidth, wrap: getComputedStyle(c).flexWrap, ov: getComputedStyle(c).overflowX }; });
      if (rowInfo.wrap !== "nowrap" || !/auto|scroll/.test(rowInfo.ov)) fail(tag, "the row wraps or does not scroll: " + JSON.stringify(rowInfo));
      // how many icons are in view before any scrolling (reported, not asserted: Dark Sky Places plus eight icons is wider than the
      // 384 px desktop panel, so her rule is read as the order: Dark Sky, then the icons, then the rest)
      const inView = await page.evaluate(() => { const c = document.querySelector(".chips").getBoundingClientRect().right;
        return [...document.querySelectorAll(".chips [data-amen]")].filter((e) => e.getBoundingClientRect().right <= c + 0.5).length; });
      const read = () => page.evaluate(() => ({ rows: [...document.querySelectorAll(".row")].map((r) => r.dataset.id).sort(), count: document.querySelector("#count").textContent,
        hash: location.hash, clear: !document.querySelector("#fClear").hidden,
        map: window.__sf.mapReady ? JSON.stringify(window.__sf.map.getFilter("pl-core")) : null }));
      const press = async (sel) => { await page.locator(sel).scrollIntoViewIfNeeded(); await page.click(sel); await page.waitForTimeout(250); };
      await press('[data-amen="rv50"]');
      let s = await read(), want = has(["rv50"]);
      if (JSON.stringify(s.rows) !== JSON.stringify(want)) fail(tag, `50A shows ${s.rows.length}, data says ${want.length}`);
      else if (s.map && want.some((id) => !s.map.includes(id))) fail(tag, "the map filter misses a 50A place");
      else if (!s.count.startsWith(`${want.length} of ${listed.length} places`) || !/with 50A/.test(s.count)) fail(tag, "count line: " + s.count);
      else if (!/f=[^&]*rv50/.test(s.hash) || !s.clear) fail(tag, "hash or clear: " + s.hash + " " + s.clear);
      await shot("50a");
      await press('[data-amen="showers"]');
      s = await read(); want = has(["rv50", "showers"]);
      if (JSON.stringify(s.rows) !== JSON.stringify(want)) fail(tag, `50A AND showers shows ${s.rows.length}, data says ${want.length}`);
      else if (!/ AND /.test(s.count)) fail(tag, "the count line does not say AND: " + s.count);
      await shot("50a-and-showers");
      const hashNow = s.hash;
      await page.goto(BASE + hashNow, { waitUntil: "load" }); await page.reload({ waitUntil: "load" }); await open();
      s = await read();
      const pressed = await page.evaluate(() => [...document.querySelectorAll('[data-amen][aria-pressed="true"]')].map((e) => e.dataset.amen).sort());
      if (JSON.stringify(pressed) !== JSON.stringify(["rv50", "showers"]) || JSON.stringify(s.rows) !== JSON.stringify(want)) fail(tag, "reload did not restore the filters: " + pressed + " rows " + s.rows.length);
      await press("#fClear");
      s = await read();
      if (s.rows.length !== listed.length || s.clear || /f=/.test(s.hash)) fail(tag, "Clear did not bring every place back: " + s.rows.length + " " + s.hash);
      const pw = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      if (pw[0] > pw[1] + 1) fail(tag, "sideways page scroll " + pw);
      if (errs.length) fail(tag, "errors: " + errs.join(" | "));
      if (!rows.some((r) => r.includes(tag))) rows.push(`ok   ${tag}: order ${order.slice(0, 4).join(",")}...; ${inView} of 8 icons in view unscrolled; 50A ${has(["rv50"]).length}, 50A AND showers ${want.length}; row ${rowInfo.cw}/${rowInfo.sw} px`);
    } else rows.push("shot " + tag);
  } catch (e) { fail(tag, "EXC " + String(e).slice(0, 200)); }
  await ctx.close(); await b.close();
}
console.log(rows.join("\n")); if (CHECK) console.log(`\n${n - bad} of ${n} views passed`);
process.exit(bad ? 1 : 0);
