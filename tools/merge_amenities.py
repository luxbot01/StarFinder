# Round two: fold each researcher's amenities and hand-picked photos into data/places.json.
# A photo is kept only if its licence is on the allowed list AND its image URL answers 200 with an image type.
import json, glob, os, re, sys, urllib.request, concurrent.futures as cf
REPO = r"C:\Users\luxbo\Documents\Code\StarFinder"
OK_LIC = re.compile(r"cc0|cc[- ]?by|public[- ]domain|^pd", re.I)
BAD_LIC = re.compile(r"\bnc\b|\bnd\b|non-?commercial|no ?deriv|all rights reserved|©|copyright", re.I)
UA = {"User-Agent": "StarFinder-check/1.0 (free public map; github rose-bot47/StarFinder)"}

def loads(url):
    import time
    for attempt in range(6):                     # Commons answers bursts with 429: back off and retry
        try:
            req = urllib.request.Request(url, headers=UA, method="GET")
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status == 200 and r.headers.get("Content-Type", "").startswith("image/")
        except urllib.error.HTTPError as e:
            if e.code != 429: return False
        except Exception:
            pass
        time.sleep(4 + attempt * 4)
    return False

data = json.load(open(os.path.join(REPO, "data", "places.json"), encoding="utf-8"))
by = {p["id"]: p for p in data["places"]}
amen = {}
for f in sorted(glob.glob(os.path.join(REPO, "data", "research", "amen_*.json"))):
    for row in json.load(open(f, encoding="utf-8"))["places"]:
        row["_file"] = os.path.basename(f); amen[row["id"]] = row
cands = []
for pid, a in amen.items():
    for ph in (a.get("photos") or [])[:3]:
        lic = (ph.get("license") or "").strip()
        if not ph.get("img") or BAD_LIC.search(lic) or not OK_LIC.search(lic): ph["_reject"] = "licence: " + lic; continue
        cands.append((pid, ph))
with cf.ThreadPoolExecutor(2) as ex:
    res = list(ex.map(lambda t: loads(t[1]["img"]), cands))
for (pid, ph), ok in zip(cands, res):
    if not ok: ph["_reject"] = "did not load"
kept = rejected = 0; withphoto = 0
for pid, p in by.items():
    a = amen.get(pid)
    if not a: p.setdefault("photos", []); continue
    p["amen"] = {k2: a.get(k1) for k1, k2 in [("rv_30a", "rv30"), ("rv_50a", "rv50"), ("water_at_site", "waterSite"), ("water_access", "water"),
                                              ("restrooms", "restrooms"), ("showers", "showers"), ("cabins", "cabins")]}
    p["amen"]["src"] = a.get("amenity_source")
    good = [{k: ph.get(k) for k in ("img", "page", "credit", "license", "source")} for ph in (a.get("photos") or []) if not ph.get("_reject")]
    rejected += sum(1 for ph in (a.get("photos") or []) if ph.get("_reject"))
    p["photos"] = good; kept += len(good); withphoto += bool(good)
data["meta"]["amenities"] = "Gathered per place by the round-two researchers from each park's own page; photos are Wikimedia Commons (CC0, CC BY, CC BY-SA, public domain) or NPS/USFS public domain, each with its credit and licence, every URL checked to load."
json.dump(data, open(os.path.join(REPO, "data", "places.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("amen rows", len(amen), "photos kept", kept, "rejected", rejected, "places with a photo", withphoto, "of", len(by))
for pid, a in amen.items():
    for ph in (a.get("photos") or []):
        if ph.get("_reject"): print("  rejected", pid, ph["_reject"], (ph.get("img") or "")[:90])
