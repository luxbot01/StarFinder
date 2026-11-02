#!/usr/bin/env python3
"""Merge new photos into data/places.json, refusing anything that breaks Rose's photo rules.

Input: a JSON file {place id: [{"img", "page", "credit", "license", "source"}, ...]} (the schema of the existing photos).
Rules, each checked here and not left to the person who wrote the input:
  - the place exists; at most MAX_PER_PLACE photos per place in all; a photo already there (same page URL) is skipped;
  - source "National Park Service": the image and page are on nps.gov's NPGallery (page = its AssetDetail page, which prints the credit and licence), the licence says "Public domain (NPS)",
    the credit starts "NPS Photo" and never says courtesy, copyright, (c) or permission (NPS-staff public-domain credits only);
  - source "Wikimedia Commons": the page is a commons File: page and the licence is exactly CC0, CC BY, CC BY-SA or public domain
    (no NC, no ND, no GFDL-only), with a credit;
  - a Texas Parks and Wildlife place never gets a photo from any other source than Wikimedia Commons (no TPWD site photos).
Backs up places.json first. Writes with separators (",", ":") and ensure_ascii=False, like the original.
Usage: python -I tools/merge_photos.py <new_photos.json> [--dry]
"""
import json, os, re, shutil, sys, time
from urllib.parse import unquote

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data", "places.json")
BACKUPS = os.path.join(os.path.dirname(REPO), "StarFinder_backups")
MAX_PER_PLACE = 10
COMMONS_LICENCE = re.compile(r"^(CC0( 1\.0)?|CC BY \d\.\d( [A-Za-z ]+)?|CC BY-SA \d\.\d( [A-Za-z ]+)?|Public domain( \(.+\))?)$")
BAD_WORDS = re.compile(r"courtesy|copyright|\(c\)|©|permission|contribut|\bNC\b|\bND\b|non-?commercial|no ?deriv", re.I)
FIELDS = ("img", "page", "credit", "license", "source")


def norm(u):
    return re.sub(r"\?width=\d+$", "", unquote(u)).lower()   # NPS pages differ only by their ?id=, so the query stays


def problems(place, ph):
    bad = []
    for k in FIELDS:
        if not isinstance(ph.get(k), str) or not ph[k].strip():
            bad.append("missing " + k)
    if bad:
        return bad
    src, lic, credit = ph["source"], ph["license"], ph["credit"]
    if not ph["img"].startswith("https://") or not ph["page"].startswith("https://"):
        bad.append("links must be https")
    if src == "National Park Service":
        if not ph["img"].startswith("https://www.nps.gov/npgallery/GetAsset/"): bad.append("NPS image must be an NPGallery asset")
        if not ph["page"].startswith("https://www.nps.gov/npgallery/AssetDetail/"): bad.append("NPS page must be the asset detail page on nps.gov")
        if lic != "Public domain (NPS)": bad.append("NPS licence must be 'Public domain (NPS)'")
        if not credit.startswith("NPS Photo") or BAD_WORDS.search(credit): bad.append("not an NPS-staff credit: " + credit)
    elif src == "Wikimedia Commons":
        if not ph["page"].startswith("https://commons.wikimedia.org/wiki/File:"): bad.append("Commons page must be a File: page")
        if not COMMONS_LICENCE.match(lic) or BAD_WORDS.search(lic): bad.append("licence not allowed: " + lic)
        if BAD_WORDS.search(credit): bad.append("credit looks restricted: " + credit)
    else:
        bad.append("source not allowed: " + src)
    if place["agency"].startswith("Texas Parks and Wildlife") and src != "Wikimedia Commons":
        bad.append("TPWD places take Wikimedia Commons photos only")
    return bad


def main():
    new = json.load(open(sys.argv[1], encoding="utf-8"))
    dry = "--dry" in sys.argv
    data = json.load(open(DATA, encoding="utf-8"))
    by_id = {p["id"]: p for p in data["places"]}
    added, skipped, refused = 0, 0, []
    for pid, photos in new.items():
        p = by_id.get(pid)
        if not p:
            refused.append((pid, "no such place")); continue
        cur = p.setdefault("photos", [])
        seen = {norm(x.get("page", "")) for x in cur}
        for ph in photos:
            ph = {k: ph[k] for k in FIELDS if k in ph}
            why = problems(p, ph)
            if why: refused.append((pid, "; ".join(why))); continue
            if norm(ph["page"]) in seen: skipped += 1; continue
            if len(cur) >= MAX_PER_PLACE: refused.append((pid, "already %d photos" % MAX_PER_PLACE)); continue
            cur.append(ph); seen.add(norm(ph["page"])); added += 1
    print("added %d, skipped %d already there, refused %d" % (added, skipped, len(refused)))
    for pid, why in refused: print("  REFUSED", pid, "-", why)
    if dry or not added: return 1 if refused else 0
    os.makedirs(BACKUPS, exist_ok=True)
    shutil.copy(DATA, os.path.join(BACKUPS, "places_pre-merge-photos_" + time.strftime("%Y%m%dT%H%M%S") + ".json"))
    with open(DATA, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print("wrote", DATA)
    return 1 if refused else 0


if __name__ == "__main__":
    sys.exit(main())
