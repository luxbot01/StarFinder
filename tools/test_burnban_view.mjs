// Tests for app/burnban.js, the card's burn-ban line:  node tools/test_burnban_view.mjs
// The view must never turn an absent or old reading into "no ban", must name the counties it looked up, and must escape what it prints.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const B = createRequire(import.meta.url)("../app/burnban.js");

const NOW = Date.parse("2026-11-02T18:00:00Z");
const data = (over = {}) => ({
  published: "2026-10-30T08:18:37-05:00", checked: "2026-11-02T15:00:00Z", banCount: 149,
  places: {
    cb: { counties: ["San Saba", "Lampasas"], status: "none", banned: [] },
    inks: { counties: ["Burnet"], status: "ban", banned: ["Burnet"] },
    two: { counties: ["Burnet", "Lampasas"], status: "ban", banned: ["Burnet"] },
    both: { counties: ["Comal", "Kendall"], status: "ban", banned: ["Comal", "Kendall"] },
    ok: { counties: [], status: "not_covered", banned: [] },
    evil: { counties: ["<b>x</b>"], status: "none", banned: [] },
  }, ...over,
});
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok   ", name); };

t("no ban: the lead is the requested sentence, with the counties, the list date and the age", () => {
  const v = B.view({ id: "cb" }, data(), NOW);
  assert.equal(v.kind, "none"); assert.equal(v.lead, "No county burn ban reported; check the park's rules");
  const h = B.html({ id: "cb" }, data(), NOW, false);
  assert.match(h, /Looked up for San Saba and Lampasas Counties/); assert.match(h, /list of Oct 30/); assert.match(h, /last checked 3 hours ago/);
  assert.match(h, /tfsweb\.tamu\.edu\/wildfire-and-other-disasters\/burn-bans-and-information/); assert.match(h, /rel="noopener"/);
  assert.doesNotMatch(h, /safe|no fire|allowed/i);
});
t("ban: names only the banned counties; the lookup line names all", () => {
  assert.equal(B.view({ id: "inks" }, data(), NOW).lead, "Burn ban in effect (Burnet County)");
  const v = B.view({ id: "two" }, data(), NOW); assert.equal(v.lead, "Burn ban in effect (Burnet County)");
  assert.match(B.html({ id: "two" }, data(), NOW, false), /Looked up for Burnet and Lampasas Counties/);
  assert.equal(B.view({ id: "both" }, data(), NOW).lead, "Burn ban in effect (Comal and Kendall Counties)");
});
t("federal land says the agency sets its own rules; state land does not", () => {
  assert.match(B.html({ id: "inks" }, data(), NOW, true), /federal land/);
  assert.doesNotMatch(B.html({ id: "inks" }, data(), NOW, false), /federal land/);
});
t("Oklahoma is plainly not covered", () => { assert.equal(B.view({ id: "ok" }, data(), NOW).kind, "na"); assert.match(B.view({ id: "ok" }, data(), NOW).lead, /not tracked for Oklahoma/); });
t("an absent reading is never 'no ban'", () => {
  for (const [label, d] of [["null file", null], ["empty object", {}], ["no places", { published: "x" }]]) {
    const v = B.view({ id: "cb" }, d, NOW); assert.equal(v.kind, "off", label); assert.doesNotMatch(v.lead, /No county burn ban/);
  }
  assert.equal(B.view({ id: "unknown-place" }, data(), NOW).kind, "off");
  assert.equal(B.view({ id: "cb" }, data({ checked: "garbage" }), NOW).kind, "off");
});
t("a check older than 48 hours, or a state list older than 14 days, stops claiming", () => {
  const old = B.view({ id: "cb" }, data({ checked: "2026-10-31T17:00:00Z" }), NOW);   // 49 hours
  assert.equal(old.kind, "off"); assert.match(old.why, /Last checked 2 days ago/);
  assert.equal(B.view({ id: "cb" }, data({ checked: "2026-10-31T19:00:00Z" }), NOW).kind, "none");   // 47 hours still counts
  const stale = B.view({ id: "cb" }, data({ published: "2026-10-18T08:00:00-05:00" }), NOW);          // 15 days
  assert.equal(stale.kind, "off"); assert.match(stale.why, /dated Oct 18/);
  assert.equal(B.view({ id: "inks" }, data({ published: "2026-10-20T08:00:00-05:00" }), NOW).kind, "ban");
});
t("text from the file is escaped", () => {
  const h = B.html({ id: "evil" }, data(), NOW, false); assert.doesNotMatch(h, /<b>x/); assert.match(h, /&lt;b&gt;x&lt;\/b&gt;/);
});
t("the mark: a chip with the county label for a ban, and nothing for no ban, Oklahoma, an old or an absent reading", () => {
  const c = B.chip({ id: "inks" }, data(), NOW);
  assert.match(c, /^<i class="ban" role="img" aria-label="Burn ban in effect, Burnet County" title="Burn ban in effect, Burnet County"><svg /);
  assert.match(B.chip({ id: "both" }, data(), NOW), /aria-label="Burn ban in effect, Comal and Kendall Counties"/);
  assert.equal(B.chip({ id: "cb" }, data(), NOW), "");
  assert.equal(B.chip({ id: "ok" }, data(), NOW), "");
  assert.equal(B.chip({ id: "inks" }, data({ checked: "2026-10-30T12:00:00Z" }), NOW), "");    // 54 hours old: no claim either way
  assert.equal(B.chip({ id: "inks" }, null, NOW), "");
  assert.equal(B.chip({ id: "nowhere" }, data(), NOW), "");
});
t("the mark: each copy has its own mask id; the card swaps its flame for the mark only under a ban", () => {
  const ids = [B.glyph(), B.glyph(), B.chip({ id: "inks" }, data(), NOW)].map((s) => /<mask id="([^"]+)"/.exec(s)[1]);
  assert.equal(new Set(ids).size, 3);
  for (const s of [B.glyph()]) assert.match(s, /mask="url\(#sfBanGap\d+\)"/);
  assert.match(B.html({ id: "inks" }, data(), NOW, false), /<svg class="burn-ic ban-ic"/);
  assert.doesNotMatch(B.html({ id: "cb" }, data(), NOW, false), /ban-ic/);
  assert.doesNotMatch(B.html({ id: "inks" }, data({ checked: "2026-10-30T12:00:00Z" }), NOW, false), /ban-ic/);
});
t("the map badge is a standalone SVG of the asked size with the colour written in", () => {
  const s = B.badgeSvg(60);
  assert.match(s, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="60" height="60" viewBox="0 0 20 20" style="color:#fd8a54">/);
  assert.match(s, /<circle /); assert.match(s, /<mask id="sfBanBadge\d+"/); assert.match(s, /<\/svg>$/);
  assert.notEqual(/<mask id="([^"]+)"/.exec(B.badgeSvg(18))[1], /<mask id="([^"]+)"/.exec(s)[1]);   // inline in the legend too: ids differ
});
t("ages read naturally", () => {
  assert.equal(B.ago(30e3), "just now"); assert.equal(B.ago(10 * 60e3), "10 minutes ago"); assert.equal(B.ago(3600e3), "60 minutes ago");
  assert.equal(B.ago(2 * 3600e3), "2 hours ago"); assert.equal(B.ago(60 * 3600e3), "3 days ago");
  assert.equal(B.listDay("2026-10-30T08:18:37-05:00"), "Oct 30"); assert.equal(B.listDay("2026-12-01T23:59:00-06:00"), "Dec 1");
});
console.log(n + " of " + n + " passed");
