/* StarFinder: the burn-ban line on a place's card. Reads data/burnbans.json, which tools/burnbans.py writes every 6 hours
   from the Texas A&M Forest Service county list (see README). The line says what the state's list says for the counties this
   place sits in, when the list is dated and when we last checked, and never says "safe": an absent or old reading is shown as
   "not available", never as "no ban". Plain script, no dependencies; also loads in Node for the tests (tools/test_burnban_view.mjs). */
(function (root) {
  "use strict";
  var PAGE = "https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/";
  var CHECKED_MAX_H = 48;   // the job runs every 6 hours; two days without a good run means something is wrong, so stop claiming
  var LIST_MAX_D = 14;      // the state's own list is dated; a list this old is not shown as current
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function ago(ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 2) return "just now";
    if (m < 90) return m + " minutes ago";
    var h = Math.round(m / 60);
    if (h < 36) return h + (h === 1 ? " hour ago" : " hours ago");
    var d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  // "2026-10-30T08:18:37-05:00" -> "Oct 30": the list's own calendar date, read off the string so the viewer's time zone cannot move it
  function listDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? MON[+m[2] - 1] + " " + +m[3] : "";
  }
  function names(cs) { return cs.length < 2 ? cs.join("") : cs.slice(0, -1).join(", ") + " and " + cs[cs.length - 1]; }
  function counties(cs) { return names(cs) + (cs.length === 1 ? " County" : " Counties"); }

  /* The view of one place: {kind: "ban" | "none" | "na" | "off", lead, counties, listed, checked, why}. Pure, so it can be tested. */
  function view(place, data, now) {
    var off = function (lead, why) { return { kind: "off", lead: lead, why: why || "" }; };
    var rec = data && data.places && data.places[place.id];
    if (!rec) return off("Burn-ban information is not available right now; check the park's rules");
    if (rec.status === "not_covered") return { kind: "na", lead: "Burn bans are not tracked for Oklahoma; check the park's rules" };
    var checked = Date.parse(data.checked), published = Date.parse(data.published);
    if (!isFinite(checked) || !isFinite(published)) return off("Burn-ban information is not available right now; check the park's rules");
    if ((now - checked) / 36e5 > CHECKED_MAX_H) return off("Burn-ban information is out of date; check the park's rules", "Last checked " + ago(now - checked) + ".");
    if ((now - published) / 864e5 > LIST_MAX_D) return off("Burn-ban information is out of date; check the park's rules", "The state's list is dated " + listDay(data.published) + ".");
    var base = { counties: rec.counties || [], listed: listDay(data.published), checked: ago(now - checked) };
    if (rec.status === "ban") return Object.assign({ kind: "ban", lead: "Burn ban in effect (" + counties(rec.banned) + ")", label: "Burn ban in effect, " + counties(rec.banned) }, base);
    if (rec.status === "none") return Object.assign({ kind: "none", lead: "No county burn ban reported; check the park's rules" }, base);
    return off("Burn-ban information is not available right now; check the park's rules");
  }

  var FLAME_D = "M12 2.6c.5 3 2.8 4.6 4.5 6.9 1.4 1.9 2.1 3.6 2.1 5.5a6.6 6.6 0 0 1-13.2 0c0-2 .8-3.6 2.1-4.9.4 1 1 1.7 1.7 2.1-.2-3.4.8-6.5 2.8-9.6z";
  var FLAME = '<svg class="burn-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="' + FLAME_D + '" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  /* THE BURN-BAN MARK (asked for on Nov 2 2026 as a little fire with a little line over it): the card's own flame, a solid inner tongue,
     and one line through it. Each part has a job:
     - the flame outline is the same path as the card's fire line, so the mark and the card say "fire" in one shape;
     - the solid tongue is what keeps it fire at 15 px: without it, an outline with a slash reads as a crossed-out water drop,
       and the drinking-water icon sits in the same strip;
     - the line runs top left to bottom right, the direction of every prohibition sign, past the flame on both ends so it reads
       as a line over the fire and not as part of it;
     - a gap of 1.1 units each side of the line is cut out of the flame (a mask, so it works on any background), so the line
       and the flame never merge into one blot at small sizes;
     - stroke 1.7, the weight of the amenity icons, so it sits in their strip as one of them; colour is currentColor (set by CSS).
     Each copy gets its own mask id: the list redraws, and a page with two masks of one id is invalid and fragile. */
  var TONGUE_D = "M12 20.6c-1.6 0-2.7-1.2-2.7-2.7 0-1.7 1.3-2.7 2.2-4.4.9 1.4 3.2 2.5 3.2 4.4 0 1.5-1.1 2.7-2.7 2.7z";
  var SLASH_D = "M3.6 3.6L20.4 20.4";
  var seq = 0;
  function glyphParts(sw, id) {
    return '<defs><mask id="' + id + '" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="#fff"/>' +
      '<path d="' + SLASH_D + '" stroke="#000" stroke-width="' + (sw + 2.2) + '" stroke-linecap="round"/></mask></defs>' +
      '<g mask="url(#' + id + ')"><path d="' + FLAME_D + '" fill="none" stroke="currentColor" stroke-width="' + sw + '" stroke-linejoin="round"/>' +
      '<path d="' + TONGUE_D + '" fill="currentColor"/></g><path d="' + SLASH_D + '" stroke="currentColor" stroke-width="' + sw + '" stroke-linecap="round"/>';
  }
  function glyph(cls) { return '<svg' + (cls ? ' class="' + cls + '"' : "") + ' viewBox="0 0 24 24" aria-hidden="true">' + glyphParts(1.7, "sfBanGap" + seq++) + "</svg>"; }

  /* The mark as a chip for the amenity strip (list rows and the pin pop-up), or "" when the place is not under a ban by a
     current reading (an old or missing file shows no mark anywhere: we never claim what we did not just read). */
  function chip(place, data, now) {
    var v = view(place, data, now);
    return v.kind === "ban" ? '<i class="ban" role="img" aria-label="' + esc(v.label) + '" title="' + esc(v.label) + '">' + glyph() + "</i>" : "";
  }
  /* The map badge: a dark disc with a ring and the mark inside, which together read as the familiar circle-and-line sign.
     The disc is what keeps it legible over the brightest sky glow; the ring is the same orange so it reads as one sign.
     A standalone SVG (an image for the map), so the colour is written in: COLOR is var(--ban), oklch(0.75 0.155 45). */
  var COLOR = "#fd8a54";
  function badgeSvg(px) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 20 20" style="color:' + COLOR + '">' +
      '<circle cx="10" cy="10" r="9.3" fill="#0b0820" fill-opacity=".92" stroke="currentColor" stroke-width="1.2"/>' +
      '<g transform="translate(3 3) scale(0.5833)">' + glyphParts(2.1, "sfBanBadge" + seq++) + "</g></svg>";
  }

  /* The card's section as an HTML string. federal: the NPS and Forest Service sites make their own fire rules. */
  function html(place, data, now, federal) {
    var v = view(place, data, now);
    var link = '<a href="' + PAGE + '" target="_blank" rel="noopener">Texas A&amp;M Forest Service</a>';
    var rows = "";
    if (v.kind === "ban" || v.kind === "none") {
      rows += '<p class="burn-src">Looked up for ' + esc(counties(v.counties)) + ". " + link + " list of " + esc(v.listed) + "; last checked " + esc(v.checked) + ".</p>";
      rows += '<p class="burn-src">' + (federal ? "This is federal land, so its own agency sets the fire rules, which can differ from the county's. " : "The park's own fire rules apply either way. ") +
        "County orders start and lift on their own dates and the list can lag them.</p>";
    } else if (v.kind === "off" && v.why) {
      rows += '<p class="burn-src">' + esc(v.why) + " Source: " + link + ".</p>";
    }
    return '<section class="burn is-' + v.kind + '" aria-labelledby="burnLead">' + (v.kind === "ban" ? glyph("burn-ic ban-ic") : FLAME) +
      '<div class="burn-t"><p class="burn-lead" id="burnLead">' + esc(v.lead) + "</p>" + rows + "</div></section>";
  }

  var api = { view: view, html: html, chip: chip, glyph: glyph, badgeSvg: badgeSvg, ago: ago, listDay: listDay, names: names, PAGE: PAGE };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.SFBurn = api;
})(typeof window !== "undefined" ? window : globalThis);
