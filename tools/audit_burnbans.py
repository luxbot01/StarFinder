#!/usr/bin/env python3
"""An independent check of StarFinder's burn-ban file against the parks' own pages: for every Texas state park, open the park's
home page the way a visitor does, follow each "This park has active alerts > View" link, and read whether the park says it is
under a burn ban. Then compare with what data/burnbans.json would show. Exits 1 if any park says "burn ban" while the file says
anything else (the failure found on Nov 10 2026: StarfinderContext V10), and lists every disagreement both ways.

It shares no code with tools/burnbans.py on purpose (its own fetch, its own reading of the page), so one bug cannot hide in both.

Usage:
  python -I tools/audit_burnbans.py [file.json]                         live pages (about 165 requests, one a second)
  python -I tools/audit_burnbans.py [file.json] --saved <dir>           pages saved by a past audit (<dir>/fetch_log.json, raw/)
file.json defaults to data/burnbans.json. Pages are data: nothing in them is followed except the park's own View links.
"""
import html, json, re, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UA = "StarFinder-burnban-audit (+https://github.com/luxbot01/StarFinder)"
BAN_WORDS = re.compile(r"<h3[^>]*>\s*(?:<[^>]+>\s*)*(?:Burn Bans?|Fire Bans?)\b|\bunder a burn ban\b", re.I)


def text_of(b):
    return b.decode("utf-8", errors="replace") if isinstance(b, (bytes, bytearray)) else b


class Live:
    def __init__(self):
        self.last = 0.0

    def get(self, url):
        time.sleep(max(0.0, 1.0 - (time.time() - self.last)))
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40) as r:
                return r.status, r.read(800_000)
        except urllib.error.HTTPError as e:
            return e.code, b""
        finally:
            self.last = time.time()


class Saved:
    """Pages saved by an earlier audit: fetch_log.json maps each place to its home page and the alert pages it linked."""
    def __init__(self, d):
        self.d = Path(d)
        self.by_url = {}
        for e in json.loads((self.d / "fetch_log.json").read_text(encoding="utf-8")).values():
            for rec in [e.get("home")] + e.get("alerts", []) + e.get("extra", []):
                if rec and rec.get("url") and rec.get("file"):
                    self.by_url[rec["url"]] = rec

    def get(self, url):
        rec = self.by_url.get(url)
        if not rec:
            return None, b""
        p = self.d / "raw" / rec["file"]
        return rec.get("status"), (p.read_bytes() if p.exists() else b"")


def park_says(src, home_url):
    """'ban' with the words, 'none', or 'unread' with why."""
    st, body = src.get(home_url)
    if st != 200 or "park-row" not in text_of(body):
        return "unread", "home page HTTP %s" % st
    links = re.findall(r'class="js-more-link"[^>]*href="([^"]+)"', text_of(body))
    for u in dict.fromkeys(links):
        u = "https://tpwd.texas.gov" + u if u.startswith("/") else u
        st2, b2 = src.get(u)
        if st2 != 200:
            return "unread", "alert page %s HTTP %s" % (u, st2)
        t = text_of(b2)
        core = t[t.find('id="content-core"'):] if 'id="content-core"' in t else ""
        m = BAN_WORDS.search(core[:60000])
        if m:
            words = re.sub(r"\s+", " ", html.unescape(re.sub(r"(?s)<[^>]+>", " ", core[m.start():m.start() + 900]))).strip()
            return "ban", words[:200]
    return "none", ""


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    saved = argv[argv.index("--saved") + 1] if "--saved" in argv else None
    if saved and saved in args:
        args.remove(saved)
    f = Path(args[0]) if args else ROOT / "data" / "burnbans.json"
    shown = json.loads(f.read_text(encoding="utf-8"))["places"]
    places = json.loads((ROOT / "data" / "places.json").read_text(encoding="utf-8"))["places"]
    src = Saved(saved) if saved else Live()
    missed, extra, unread, n = [], [], [], 0
    for p in places:
        if not p["id"].startswith("tx-") or "tpwd.texas.gov/state-parks/" not in (p.get("url") or ""):
            continue
        n += 1
        says, words = park_says(src, p["url"])
        rec = shown.get(p["id"], {})
        st = rec.get("status")
        park_in_file = (rec.get("park") or {}).get("status")
        if says == "unread":
            unread.append((p["id"], words))
        elif says == "ban" and st != "ban":
            missed.append((p["id"], p.get("name"), st, words))
        elif says == "none" and park_in_file == "ban":
            extra.append((p["id"], p.get("name"), "the file still carries a park ban the page no longer states"))
    print("Checked %d state parks against %s (%s)." % (n, f, "saved pages in " + saved if saved else "live pages"))
    for pid, name, st, words in missed:
        print("MISSED  %s (%s): the park says \"%s\" but the file shows %s" % (pid, name, words[:120], st))
    for pid, name, why in extra:
        print("STALE   %s (%s): %s" % (pid, name, why))
    for pid, why in unread:
        print("UNREAD  %s: %s" % (pid, why))
    print("%d missed, %d stale, %d unread." % (len(missed), len(extra), len(unread)))
    return 1 if missed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
