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
import json, os, re, sys, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = "https://tfsweb.tamu.edu/wildfire-and-other-disasters/burn-bans-and-information/"
TXT = "https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.txt"
XML = "https://tfsfrp.tamu.edu/WILDFIRES/BURNBAN.XML"
UA = "StarFinder-burnban-watcher (+https://github.com/luxbot01/StarFinder)"
HEARTBEAT_H = 12
MAX_BYTES = 200_000   # the real files are 3 to 4 KB

# Parks whose county text in places.json is not enough. Others are read from the text ("A and B", "A, B, C", a trailing note dropped).
OVERRIDES = {
    "tx-colorado-bend": ["San Saba", "Lampasas"],   # mostly San Saba; the small part in Lampasas has no public access (Wikipedia)
    "nps-lamr": ["Hutchinson", "Moore", "Potter"],   # Lake Meredith NRA
    "usfs-lyndon-b-johnson-national-grassland": ["Wise", "Montague"],
    "tx-guadalupe-river": ["Comal", "Kendall"],      # the park straddles both
}


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


def build(txt_raw, xml_raw, places, tx, prev, now, accept_drop=False):
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
        out_places[p["id"]] = {"counties": cs, "status": "ban" if hit else "none", "banned": hit}
    return {
        "schema": 1,
        "source": {"name": "Texas A&M Forest Service, Texas Burn Bans", "page": PAGE, "data": TXT},
        "published": stamp_to_iso(s1),
        "publishedText": re.sub(r"\s+", " ", s1),
        "checked": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "banCount": len(banned),
        "banned": banned,
        "places": out_places,
    }


def same_but_checked(a, b):
    if not a or not b:
        return False
    strip = lambda d: {k: v for k, v in d.items() if k != "checked"}
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


def main():
    now = datetime.now(timezone.utc).replace(microsecond=0)
    out = ROOT / "data" / "burnbans.json"
    places = json.loads((ROOT / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    tx = json.loads((ROOT / "data" / "tx_counties.json").read_text(encoding="utf-8"))
    prev = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    try:
        new = build(fetch(TXT), fetch(XML), places, tx, prev, now, accept_drop=os.environ.get("ACCEPT_DROP") == "true")
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
    msg = "List of %s: %d counties under a burn ban. Colorado Bend State Park (%s): %s. File %s." % (
        new["publishedText"], new["banCount"], " and ".join(cb["counties"]) if cb else "?", cb["status"] if cb else "?", verdict)
    print(msg)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
