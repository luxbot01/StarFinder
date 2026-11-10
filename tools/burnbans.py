#!/usr/bin/env python3
"""StarFinder's burn-ban watcher: reads the Texas A&M Forest Service county burn-ban list and writes
data/burnbans.json, which the card reads. Standard library only. Run by .github/workflows/burnbans.yml
every 6 hours; safe to run by hand from the repo root:  python tools/burnbans.py

What it reads (all official, all public, facts only: county names and the list's own date):
  https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.txt   the list, UTF-16, first line "149 Texas Burn Bans - 10/30/2026 8:18:37 AM"
  https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.XML   the same list as RSS, used only to cross-check the .txt
Linked from https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/
Their terms (tfsweb.tamu.edu/accessibility-site-policies-and-public-notices/, read Nov 2 2026): personal, educational
and other non-commercial use welcome; cite the author and source, link to the Forest Service site, keep their notices;
no guarantee of accuracy or currency. StarFinder is free with no ads and credits and links them beside the status.

Fail closed. Any doubt (a header that does not parse, a count that does not match the names, a county that does not
exist, the .txt and .xml disagreeing, or a list that lost most of its counties overnight) exits 1 and writes nothing,
so the last good file stays and the page ages it out by its own `checked` stamp. An absent reading is never written
as "no burn ban".

Writes only when something changed, or when the last check is HEARTBEAT_H hours old, so `checked` never lags by more.
"""
import json, os, re, sys, urllib.error, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = "https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/"
TXT = "https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.txt"
XML = "https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.XML"
UA = "StarFinder-burnban-watcher (+https://github.com/luxbot01/StarFinder)"
HEARTBEAT_H = 11   # the job runs every 6 hours, so every second run (about 12 hours) writes; with jitter, 11 keeps `checked` under 18 hours
MAX_BYTES = 200_000   # the real files are 3 to 4 KB

# Parks whose county text in places.json is not enough. Others are read from the text ("A and B", "A, B, C", a trailing note dropped).
# A place is checked against EVERY county it reaches: a ban in any of them is a ban somewhere on that land, and the card names
# which county. (The Nov 10 2026 audit found Sabine NF checked against Sabine County only while its other four counties were
# under bans; StarfinderContext V10.) Each line says where its counties were read.
OVERRIDES = {
    "tx-colorado-bend": ["San Saba", "Lampasas"],   # mostly San Saba; the small part in Lampasas has no public access (Wikipedia)
    "nps-lamr": ["Hutchinson", "Moore", "Potter"],   # Lake Meredith NRA
    "usfs-lyndon-b-johnson-national-grassland": ["Wise", "Montague"],
    "tx-guadalupe-river": ["Comal", "Kendall"],      # the park straddles both
    # the Forest Service's own pages, read Nov 10 2026
    "usfs-angelina-national-forest": ["Angelina", "Nacogdoches", "San Augustine", "Jasper"],   # "located in Angelina, Nacogdoches, San Augustine and Jasper counties"
    "usfs-sabine-national-forest": ["Sabine", "San Augustine", "Shelby", "Jasper", "Newton"],  # "within Sabine, San Augustine, Shelby, Jasper, and Newton counties"
    # Wikipedia, read Nov 10 2026 (the agency's own page names no counties)
    "usfs-davy-crockett-national-forest": ["Houston", "Trinity"],
    "nps-bith": ["Hardin", "Jasper", "Jefferson", "Liberty", "Orange", "Polk", "Tyler"],      # "Centered about Hardin County ... extends into ... Jasper, Jefferson, Liberty, Orange, Polk, and Tyler counties"
    "nps-pais": ["Kleberg", "Kenedy", "Willacy"],    # the seashore; Nueces holds only the city end of the island
    "nps-gumo": ["Culberson", "Hudspeth"],
    "tx-big-bend-ranch": ["Presidio", "Brewster"],
    "tx-cooper-lake": ["Hopkins", "Delta"],          # South Sulphur unit in Hopkins, Doctors Creek unit in Delta
    "tx-lake-somerville": ["Burleson", "Lee"],       # Birch Creek unit in Burleson, Nails Creek unit in Lee
}
# Where each list above was read: written on the place's data record (countiesFrom), never on the public card.
OVERRIDE_FROM = {"usfs-angelina-national-forest": "the Forest Service's own page, read Nov 10 2026",
                 "usfs-sabine-national-forest": "the Forest Service's own page, read Nov 10 2026",
                 "usfs-davy-crockett-national-forest": "Wikipedia, read Nov 10 2026", "nps-bith": "Wikipedia, read Nov 10 2026",
                 "nps-pais": "Wikipedia, read Nov 10 2026", "nps-gumo": "Wikipedia, read Nov 10 2026",
                 "tx-big-bend-ranch": "Wikipedia, read Nov 10 2026", "tx-cooper-lake": "Wikipedia, read Nov 10 2026",
                 "tx-lake-somerville": "Wikipedia, read Nov 10 2026", "tx-colorado-bend": "Wikipedia",
                 "nps-lamr": "Wikipedia", "usfs-lyndon-b-johnson-national-grassland": "Wikipedia", "tx-guadalupe-river": "the park's own geography"}

# ---------------------------------------------------------------------------------------------------------------------------
# The parks' own alerts. Texas state parks post their own burn bans, which do not wait for a county order: on Nov 10 2026 five
# parks (Bastrop, Buescher, Goose Island, Devils River, Post Oak Ridge) were "under a burn ban" by their own alert page while
# none of their counties was on the state's list, and this watcher said "No county burn ban reported" for all five. So every
# run also reads the page a visitor opens from the park's "This park has active alerts > View" link,
# https://tpwd.texas.gov/state-parks/<park>/alert (TPWD's robots.txt allows /state-parks/; read Nov 10 2026). Facts only: the
# heading, the posted date and the alert's own sentence, shown with a link back to the page.
# What the page does: a park with alerts answers 200 with <div class="notice-message"> holding one <h3> per alert, each followed
# by its paragraph ("Burn Ban" / "Oct. 19, 2026 - The park is under a burn ban. No wood fires allowed. ..."). A park with no
# alerts answers 302 to a sign-in page (require_login?came_from=.../alert): there is no alert object, so no alert is posted.
PARK_ALERT = "https://tpwd.texas.gov/state-parks/%s/alert"
FIRE_HEAD = re.compile(r"\b(burn bans?|fire bans?|fire restrictions?|campfire ban)\b", re.I)
UNKNOWN_MAX = 0.10   # more than a tenth of the parks unreadable on one run: the run fails closed rather than half-know


def tpwd_slug(p):
    m = re.match(r"https?://tpwd\.texas\.gov/state-parks/([a-z0-9-]+)/?$", p.get("url") or "")
    return m.group(1) if p["id"].startswith("tx-") and m else None


def parse_park_alert(status, body, location=""):
    """One park's alert page -> {status: ban|none, heading, text, posted}. Raises Fail when the page is not the shape we know,
    so a redesign of their site can never read as "no burn ban"."""
    if status in (301, 302, 303, 307, 308):
        if "require_login" in location and re.search(r"(/|%2F)alert$", location):
            return {"status": "none", "heading": None, "text": None, "posted": None, "alerts": 0}
        raise Fail("an alert page redirected somewhere unexpected: %s" % location[:120])
    if status != 200:
        raise Fail("an alert page answered HTTP %s" % status)
    text = body.decode("utf-8", errors="replace")
    core = re.search(r'(?is)<div id="content-core">(.*?)<div id="viewlet-below-content-body"', text)
    if not core or 'class="notice-message"' not in core.group(1):
        raise Fail("an alert page has no notice-message block (has the page changed?)")
    msg = core.group(1)
    parts = re.split(r"(?is)<h3[^>]*>(.*?)</h3>", msg)
    alerts = []
    for i in range(1, len(parts) - 1, 2):
        head = clean(parts[i])
        body_txt = clean(re.split(r"(?is)<hr\b", parts[i + 1])[0])
        alerts.append((head, body_txt))
    if not alerts:
        raise Fail("an alert page has no alert headings")
    for head, body_txt in alerts:
        if FIRE_HEAD.search(head) or re.search(r"\bunder a burn ban\b", body_txt, re.I):
            m = re.match(r"^((?:Jan|Feb|Mar|Apr|May|June?|July?|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.? \d{1,2}, \d{4})\s*[-–]\s*(.*)$", body_txt)
            return {"status": "ban", "heading": head, "text": (m.group(2) if m else body_txt)[:400], "posted": m.group(1) if m else None, "alerts": len(alerts)}
    return {"status": "none", "heading": None, "text": None, "posted": None, "alerts": len(alerts)}


def clean(fragment):
    import html as _html
    t = _html.unescape(re.sub(r"(?s)<[^>]+>", " ", fragment)).replace("\r", " ").replace(" ", " ")
    t = re.sub(r"[�]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def alert_links(home):
    """The park's own "This park has active alerts > View" links, read off its home page, in page order. TPWD uses more than one
    shape (/<park>/alert, /<park>/park-alert, and a statewide /park-information/notices/... page), so the links are read, never built."""
    text = home.decode("utf-8", errors="replace")
    if 'class="park-row"' not in text:
        raise Fail("a park home page is not the shape we know (no park-row)")
    links = re.findall(r'class="js-more-link"[^>]*href="([^"]+)"', text)
    if "This park has active alerts" in text and not links:
        raise Fail("a park home page shows alerts but no View link")
    return [("https://tpwd.texas.gov" + u if u.startswith("/") else u) for u in dict.fromkeys(links)]


def read_parks(places, get):
    """{place id: park reading} for every Texas state park, read the way a visitor reads it: the park's home page, then every alert
    page its View links open (Nov 10 2026: Sheldon Lake and Palo Pinto Mountains post at /park-alert, most parks at /alert, and
    some only link a statewide notice). get(url) -> (status, body, location). A park whose pages cannot be read is "unknown"
    (never "none"); too many unknowns fail the run."""
    out, unknown, seen = {}, 0, {}
    for p in places:
        if not tpwd_slug(p):
            continue
        try:
            st, body, loc = get(p["url"])
            if st != 200:
                raise Fail("a park home page answered HTTP %s" % st)
            r = {"status": "none", "heading": None, "text": None, "posted": None, "alerts": 0, "url": p["url"]}
            for link in alert_links(body):
                if link not in seen:            # a statewide notice is linked from many parks: read it once a run
                    st2, b2, l2 = get(link)
                    if st2 != 200:
                        raise Fail("an alert page linked from the park answered HTTP %s" % st2)
                    seen[link] = parse_park_alert(st2, b2, l2)
                a = seen[link]
                r["alerts"] += a.get("alerts", 0)
                if a["status"] == "ban" and r["status"] != "ban":
                    r.update({k: a[k] for k in ("status", "heading", "text", "posted")}, url=link)
        except (Fail, OSError) as e:   # one odd park: "unknown", never "none"; a site-wide change trips the guard below
            r = {"status": "unknown", "heading": None, "text": None, "posted": None, "why": str(e)[:160], "url": p["url"]}
            unknown += 1
        out[p["id"]] = r
    if out and unknown / len(out) > UNKNOWN_MAX:
        raise Fail("%d of %d parks' alert pages could not be read" % (unknown, len(out)))
    return out


class Fail(Exception):
    pass


def key(name):
    """'DEWITT', 'DeWitt', 'De Witt' and 'dewitt' are one county."""
    return re.sub(r"[^A-Z]", "", name.upper())


def decode(raw):
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16")
    return raw.decode("utf-8")


def central_offset_hours(naive):
    """US Central time: -5 in daylight time (second Sunday of March to first Sunday of November, 2:00 local), else -6."""
    y = naive.year
    d = datetime(y, 3, 1)
    dst_start = d + timedelta(days=(6 - d.weekday()) % 7 + 7, hours=2)
    d = datetime(y, 11, 1)
    dst_end = d + timedelta(days=(6 - d.weekday()) % 7, hours=2)
    return -5 if dst_start <= naive < dst_end else -6


HEADER = re.compile(r"^\s*(\d+)\s+Texas Burn Bans\s+-\s+(\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+[AP]M)\s*$", re.I)


def stamp_to_iso(stamp):
    naive = datetime.strptime(re.sub(r"\s+", " ", stamp.strip()), "%m/%d/%Y %I:%M:%S %p")
    off = central_offset_hours(naive)
    return naive.replace(tzinfo=timezone(timedelta(hours=off))).isoformat()


def split_names(blob):
    return [n.strip() for n in re.split(r"[,\r\n]+", blob) if n.strip()]


def parse_txt(text):
    lines = [l.strip() for l in text.replace("﻿", "").splitlines() if l.strip()]
    if not lines:
        raise Fail("the .txt list is empty")
    m = HEADER.match(lines[0])
    if not m:
        raise Fail("the .txt header did not parse: %r" % lines[0][:80])
    return int(m.group(1)), m.group(2), lines[1:]


def parse_xml(text):
    if "<!DOCTYPE" in text or "<!ENTITY" in text:
        raise Fail("the .xml carries a DOCTYPE or ENTITY, refusing to read it")
    item = re.search(r"<item>(.*?)</item>", text, re.S)
    if not item:
        raise Fail("the .xml has no item")
    t = re.search(r"<title>\s*(.*?)\s*</title>", item.group(1), re.S)
    d = re.search(r"<description>\s*(.*?)\s*</description>", item.group(1), re.S)
    if not (t and d):
        raise Fail("the .xml item has no title or description")
    m = HEADER.match(t.group(1))
    if not m:
        raise Fail("the .xml title did not parse: %r" % t.group(1)[:80])
    return int(m.group(1)), m.group(2), split_names(d.group(1))


def to_canonical(names, tx):
    by_key = {key(c): c for c in tx}
    out, bad = [], []
    for n in names:
        c = by_key.get(key(n))
        (out if c else bad).append(c or n)
    if bad:
        raise Fail("not Texas counties: %s" % ", ".join(bad[:5]))
    if len(set(out)) != len(out):
        raise Fail("a county is listed twice")
    return sorted(out)


def place_counties(p):
    """The counties to check for one place: [] for Oklahoma (not covered)."""
    if p["id"] in OVERRIDES:
        return list(OVERRIDES[p["id"]])
    if not p["id"].startswith(("tx-", "nps-", "usfs-")):
        return []
    text = re.sub(r"\(.*?\)", "", p.get("county") or "")
    return [c.strip() for c in re.split(r",|\band\b", text) if c.strip()]


def build(txt_raw, xml_raw, places, tx, prev, now, accept_drop=False, parks=None):
    """parks: {place id: park reading} from read_parks(), or None when the parks were not read (old callers, tests of the
    county half): then no place gets a park line and nothing claims the parks were checked."""
    n1, s1, names1 = parse_txt(decode(txt_raw))
    n2, s2, names2 = parse_xml(decode(xml_raw))
    if n1 != len(names1):
        raise Fail("the .txt header says %d counties and lists %d" % (n1, len(names1)))
    if n2 != len(names2):
        raise Fail("the .xml header says %d counties and lists %d" % (n2, len(names2)))
    banned = to_canonical(names1, tx)
    if re.sub(r"\s+", " ", s1) != re.sub(r"\s+", " ", s2) or banned != to_canonical(names2, tx):
        raise Fail("the .txt and the .xml disagree (%s vs %s)" % (s1, s2))
    pc = (prev or {}).get("banCount", 0)
    if pc >= 20 and len(banned) < pc * 0.5 and not accept_drop:
        raise Fail("the list fell from %d to %d counties at once; run the workflow by hand with accept_drop to take it" % (pc, len(banned)))
    tx_keys = {key(c) for c in tx}
    ban_keys = {key(c) for c in banned}
    if parks is not None:
        pb = sum(1 for r in parks.values() if r["status"] == "ban")
        ppb = (prev or {}).get("parkBanCount", 0)
        if ppb >= 4 and pb == 0 and not accept_drop:   # every park ban vanishing at once looks like a parser that went blind
            raise Fail("the parks' own burn bans fell from %d to 0 at once; run the workflow by hand with accept_drop to take it" % ppb)
    out_places = {}
    for p in places:
        cs = place_counties(p)
        if not cs:
            out_places[p["id"]] = {"counties": [], "status": "not_covered", "banned": []}
            continue
        for c in cs:
            if key(c) not in tx_keys:
                raise Fail("%s: %r is not a Texas county" % (p["id"], c))
        hit = [c for c in cs if key(c) in ban_keys]
        rec = {"counties": cs, "countiesFrom": OVERRIDE_FROM.get(p["id"], "places.json county text" if p["id"] not in OVERRIDES else "an override"),
               "countyStatus": "ban" if hit else "none", "banned": hit}
        park = (parks or {}).get(p["id"])
        # a park page we could not read this run never clears a ban it showed last run: the last reading is carried, said so,
        # with when it was read (and a page change across a tenth of the parks fails the whole run, so the last file stands)
        last = (((prev or {}).get("places") or {}).get(p["id"]) or {}).get("park")
        if park and park["status"] == "unknown" and last and last.get("status") == "ban":
            park = dict(last, carried=True, lastRead=last.get("lastRead") or (prev or {}).get("parksRead"), why=park.get("why"))
        if park:
            rec["park"] = park
        # a ban from either source is a ban; a park we could not read never becomes "none"
        rec["status"] = "ban" if hit or (park and park["status"] == "ban") else "unknown" if park and park["status"] == "unknown" else "none"
        out_places[p["id"]] = rec
    out = {
        "schema": 2,
        "source": {"name": "Texas A&M Forest Service, Texas Burn Bans", "page": PAGE, "data": TXT},
        "published": stamp_to_iso(s1),
        "publishedText": re.sub(r"\s+", " ", s1),
        "checked": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "banCount": len(banned),
        "banned": banned,
        "places": out_places,
    }
    if parks is not None:
        out["parkSource"] = {"name": "Texas Parks and Wildlife Department, each state park's alert page", "page": PARK_ALERT % "<park>"}
        out["parksRead"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        out["parkBanCount"] = sum(1 for r in parks.values() if r["status"] == "ban")
    return out


def same_but_checked(a, b):
    if not a or not b:
        return False
    strip = lambda d: {k: v for k, v in d.items() if k not in ("checked", "parksRead")}
    return strip(a) == strip(b)


def age_hours(iso_z, now):
    t = datetime.strptime(iso_z, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return (now - t).total_seconds() / 3600


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise Fail("%s is larger than %d bytes" % (url, MAX_BYTES))
    return raw


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):   # a park with no alerts redirects to a sign-in page: read the 302 itself
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)
_last = [0.0]


def get_page(url):
    """(status, body, Location) without following redirects, one request a second (a courtesy to the park site)."""
    import time
    wait = 1.0 - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
    try:
        with _OPENER.open(req, timeout=30) as r:
            body = r.read(MAX_PAGE + 1)
            st, loc = r.status, ""
    except urllib.error.HTTPError as e:
        st, loc, body = e.code, e.headers.get("Location", "") or "", b""
    finally:
        _last[0] = time.time()
    if len(body) > MAX_PAGE:
        raise Fail("%s is larger than %d bytes" % (url, MAX_PAGE))
    return st, body, loc


MAX_PAGE = 600_000   # a park alert page is about 50 KB


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    out = ROOT / "data" / "burnbans.json"
    places = json.loads((ROOT / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    tx = json.loads((ROOT / "data" / "tx_counties.json").read_text(encoding="utf-8"))
    prev = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    try:
        parks = read_parks(places, get_page)
        new = build(fetch(TXT), fetch(XML), places, tx, prev, now, accept_drop=os.environ.get("ACCEPT_DROP") == "true", parks=parks)
    except Fail as e:
        print("FAIL (nothing written): %s" % e, file=sys.stderr)
        return 1
    except OSError as e:   # network, DNS, HTTP error, timeout
        print("FAIL (nothing written): could not fetch the list: %s" % e, file=sys.stderr)
        return 1
    changed = not same_but_checked(prev, new)
    beat = prev is None or age_hours(prev["checked"], now) >= HEARTBEAT_H or os.environ.get("FORCE") == "true"
    if changed or beat:
        out.write_text(json.dumps(new, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    verdict = "written (changed)" if changed else "written (heartbeat)" if beat else "unchanged"
    cb = new["places"].get("tx-colorado-bend")
    unk = [k for k, r in parks.items() if r["status"] == "unknown"]
    msg = "List of %s: %d counties under a burn ban. %d state parks post their own burn ban; %d park pages unreadable%s. Colorado Bend State Park (%s): %s. File %s." % (
        new["publishedText"], new["banCount"], new.get("parkBanCount", 0), len(unk), (" (" + ", ".join(unk[:5]) + ")") if unk else "",
        " and ".join(cb["counties"]) if cb else "?", cb["status"] if cb else "?", verdict)
    print(msg)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
