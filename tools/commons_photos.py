#!/usr/bin/env python3
"""Candidate Wikimedia Commons photos for every place that is not an NPS unit (TPWD, Forest Service, Oklahoma), with each
file's licence READ FROM COMMONS' OWN METADATA, so no one has to type or trust a licence by eye.

For a place: the Commons category named for it (exact name, else the best category search hit) and a file search on its
name; every file is kept only if it is a JPEG at least 1200 px wide in a landscape shape, its licence is CC0, CC BY, CC BY-SA
or public domain (no NC, no ND, no GFDL-only), it names an author, and it is not already on the place. The best 12 (Commons
quality, featured or valued marks first, then size) go on a numbered contact sheet for someone to look at and choose from;
the choice is by number, and tools/merge_photos.py then builds the record from THIS file, not from anyone's typing.
Usage: python -I tools/commons_photos.py <outDir> [place id ...]
"""
import hashlib, html, io, json, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://commons.wikimedia.org/w/api.php"
UA = "StarFinder-photo-research/1.0 (https://github.com/luxbot01/StarFinder; free dark-sky map)"
GOOD_BADGES = re.compile(r"Quality images|Featured pictures|Valued images", re.I)
BAD_TITLE = re.compile(r"\b(map|logo|sign|plan|diagram|brochure|flag|seal|panorama of the|poster|plaque|tombstone|grave|aerial survey)\b|\.svg|\.pdf|\.tif", re.I)
LIC_OK = re.compile(r"^(CC0|CC BY(-SA)? \d\.\d|Public domain|PD\b|PD-)", re.I)
LIC_NO = re.compile(r"\bNC\b|\bND\b|-NC|-ND|GFDL|non-?commercial|no deriv", re.I)


def call(params):
    q = dict(params, action="query", format="json", formatversion="2", maxlag="5")
    url = API + "?" + urllib.parse.urlencode(q)
    for wait in (0, 6, 20, 60):
        time.sleep(wait or 0.7)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return json.load(r)
        except Exception as e:
            err = e
    raise RuntimeError("Commons did not answer: %s" % err)


def clean(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def licence(meta):
    short = clean((meta.get("LicenseShortName") or {}).get("value"))
    if not short or LIC_NO.search(short) or not LIC_OK.match(short): return None
    if short.upper().startswith(("PD", "PUBLIC DOMAIN")): return "Public domain"
    return short


def category_for(name):
    j = call({"titles": "Category:" + name, "prop": "info"})
    if j["query"]["pages"] and not j["query"]["pages"][0].get("missing"): return "Category:" + name
    j = call({"list": "search", "srnamespace": "14", "srsearch": name, "srlimit": "5"})
    toks = [t for t in re.findall(r"[a-z0-9]+", name.lower()) if t not in ("state", "park", "national", "the", "of")]
    for h in j["query"]["search"]:
        t = h["title"].lower()
        if all(k in t for k in toks): return h["title"]
    return None


def files_for(name, cat):
    titles = []
    if cat:
        j = call({"list": "categorymembers", "cmtitle": cat, "cmtype": "file", "cmlimit": "150"})
        titles += [m["title"] for m in j["query"]["categorymembers"]]
    j = call({"list": "search", "srnamespace": "6", "srsearch": '"%s"' % name, "srlimit": "40"})
    titles += [m["title"] for m in j["query"]["search"] if name.lower().split(" state")[0] in m["title"].lower()]
    seen, out = set(), []
    for t in titles:
        if t not in seen: seen.add(t); out.append(t)
    return out[:180]


def info(titles):
    out = []
    for i in range(0, len(titles), 40):
        j = call({"titles": "|".join(titles[i:i + 40]), "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": "480"})
        out += j["query"]["pages"]
    return out


def candidates(place, have):
    name = place["name"]
    cat = category_for(name)
    cands = []
    for pg in info(files_for(name, cat)):
        ii = (pg.get("imageinfo") or [None])[0]
        if not ii or ii.get("mime") != "image/jpeg": continue
        w, h = ii.get("width") or 0, ii.get("height") or 0
        if w < 1200 or h <= 0 or not 1.2 <= w / h <= 2.4: continue
        meta = ii.get("extmetadata") or {}
        lic = licence(meta)
        artist = clean((meta.get("Artist") or {}).get("value"))
        if not lic or not artist or len(artist) > 80 or BAD_TITLE.search(pg["title"]): continue
        if re.search(r"(?i)trademark|insignia", clean((meta.get("Restrictions") or {}).get("value"))): continue
        page = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(pg["title"].replace(" ", "_"), safe=":_().,'!~*-")
        if page.lower() in have: continue
        cats = clean((meta.get("Categories") or {}).get("value"))
        cands.append({"title": pg["title"][5:], "artist": artist, "license": lic, "w": w, "h": h, "page": page,
                      "img": "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(pg["title"][5:].replace(" ", "_"), safe="_().,'!~*-") + "?width=800",
                      "thumb": ii.get("thumburl"), "badge": bool(GOOD_BADGES.search(cats)), "desc": clean((meta.get("ImageDescription") or {}).get("value"))[:160]})
    cands.sort(key=lambda c: (not c["badge"], -c["w"], hashlib.md5(c["page"].encode()).hexdigest()))
    return cat, len(cands), cands[:12]


def sheet(items, thumbs, path):
    cols, tw, th, pad, lab = 4, 300, 200, 8, 46
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + lab + pad) + pad), (20, 14, 36))
    d = ImageDraw.Draw(im)
    for i, (it, t) in enumerate(zip(items, thumbs)):
        x, y = pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + lab + pad)
        t = t.copy(); t.thumbnail((tw, th)); im.paste(t, (x + (tw - t.width) // 2, y + (th - t.height) // 2))
        d.text((x + 2, y + th + 2), "#%d %s" % (i, it["title"][:44]), fill=(255, 220, 120))
        d.text((x + 2, y + th + 16), "%s | %s" % (it["artist"][:24], it["license"]), fill=(200, 190, 230))
        d.text((x + 2, y + th + 30), "%dx%d%s" % (it["w"], it["h"], "  [quality mark]" if it["badge"] else ""), fill=(150, 140, 190))
    im.save(path, quality=78)


def main():
    out = sys.argv[1]; only = set(sys.argv[2:])
    os.makedirs(out, exist_ok=True)
    places = json.load(open(os.path.join(REPO, "data", "places.json"), encoding="utf-8"))["places"]
    summary = []
    for p in places:
        if p["id"].startswith("nps-") or (only and p["id"] not in only): continue
        if os.path.exists(os.path.join(out, p["id"] + ".json")): continue   # resumable
        have = {urllib.parse.unquote(ph.get("page", "")).lower().replace(" ", "_") for ph in p.get("photos") or []} | {ph.get("page", "").lower() for ph in p.get("photos") or []}
        try:
            cat, n, top = candidates(p, have)
        except Exception as e:
            print("%s: FAILED %s" % (p["id"], e)); continue
        thumbs = []
        for c in top:
            try:
                time.sleep(0.5)
                with urllib.request.urlopen(urllib.request.Request(c["thumb"], headers={"User-Agent": UA}), timeout=60) as r:
                    thumbs.append(Image.open(io.BytesIO(r.read())).convert("RGB"))
            except Exception:
                thumbs.append(Image.new("RGB", (300, 200), (60, 0, 0)))
        json.dump({"place": p["id"], "name": p["name"], "category": cat, "passed": n, "have": len(p.get("photos") or []), "candidates": top}, open(os.path.join(out, p["id"] + ".json"), "w", encoding="utf-8"), indent=1)
        if top: sheet(top, thumbs, os.path.join(out, p["id"] + ".jpg"))
        print("%s: category %s, %d candidates pass, %d on the sheet (has %d)" % (p["id"], cat, n, len(top), len(p.get("photos") or [])), flush=True)


if __name__ == "__main__":
    main()
