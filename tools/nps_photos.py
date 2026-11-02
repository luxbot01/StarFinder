#!/usr/bin/env python3
"""Candidate NPS photos for the 15 national park places, from NPGallery, the database nps.gov's own photo galleries read
(https://www.nps.gov/npgallery/api/search/execute?unitcode=BIBE&primarytype=image, no key, the same call the gallery pages make).

Only photos whose own record says "Public domain" with granting rights "Full" are kept, and never one whose credit says
courtesy, copyright, a (c) mark, permission or a contributor. The credit that goes on the card is "NPS Photo / <PhotoCredit>",
which is how nps.gov credits its public-domain images. Writes data (candidates, thumbnails and a numbered contact sheet per
unit) to a scratch folder given on the command line; nothing here edits data/places.json (tools/merge_photos.py does that).

Usage: python -I tools/nps_photos.py <outDir> [CODE ...]
"""
import hashlib, io, json, os, re, sys, time, urllib.request
from PIL import Image, ImageDraw

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = "StarFinder-photo-research (+https://github.com/luxbot01/StarFinder)"
BAD_CREDIT = re.compile(r"courtesy|copyright|\(c\)|©|permission|contribut|used with|all rights|reserved|license|unknown", re.I)
BAD_TEXT = re.compile(r"\b(map|diagram|plan|drawing|sketch|sign|logo|document|letter|portrait|poster|artifact|exhibit|archive|certificate|ceremony|meeting|class|students?|volunteers?|staff|ranger|visitor center|brochure|aerial survey|x-ray|specimen)\b", re.I)
GOOD_TEXT = re.compile(r"landscape|scenic|sunset|sunrise|night|stars?|milky|canyon|river|mountain|desert|camp|trail|lake|beach|dune|bluff|mission|adobe|prairie|bay|island|cavern|cave|rim|vista|overlook|wildflower|bluebonnet", re.I)


def get_json(url):
    for wait in (0, 4, 12):
        time.sleep(wait)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                return json.load(r)
        except Exception as e:  # network or HTTP error: retry, then give up loudly
            err = e
    raise RuntimeError("could not read %s: %s" % (url, err))


def get_bytes(url):
    time.sleep(0.4)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
        return r.read()


def candidates(code, have_pages, want=12, tries=60):
    res, page = [], 1
    while True:
        j = get_json("https://www.nps.gov/npgallery/api/search/execute?unitcode=%s&pagesize=200&primarytype=image&page=%d" % (code, page))
        res += j.get("Results") or []
        if page >= int(j.get("PageCount") or 1) or page >= 6:
            break
        page += 1
    cheap = []
    for r in res:   # the search record has the licence, credit and words; the size needs the asset's own record, fetched only for the few that pass
        a = r["Asset"]
        ci = a.get("ConstraintsInformation") or {}
        credit = (a.get("PhotoCredit") or "").strip()
        text = " ".join([a.get("Title") or "", a.get("Description") or "", a.get("AltText") or "", " ".join(a.get("Keywords") or [])])
        page_url = "https://www.nps.gov/npgallery/AssetDetail/" + a["AssetID"]
        if a.get("PrimaryType") != "image" or ci.get("Constraint") != "Public domain" or ci.get("GrantingRights") != "Full": continue
        if not credit or BAD_CREDIT.search(credit) or BAD_TEXT.search(text) or page_url in have_pages: continue
        cheap.append((-(2 if GOOD_TEXT.search(text) else 0), hashlib.md5(a["AssetID"].encode()).hexdigest(), a, credit, page_url))
    cheap.sort(key=lambda t: t[:2])   # words that read as scenery first, then a fixed shuffle so one photographer's series does not fill the sheet
    out = []
    for neg, _, a, credit, page_url in cheap[:tries]:
        if len(out) >= want: break
        m = get_json("https://www.nps.gov/npgallery/api/asset/metadata/" + a["AssetID"])
        pr = m.get("AssetProperties") or {}
        w, h = pr.get("Width") or 0, pr.get("Height") or 0
        if w < 1600 or h <= 0 or not 1.25 <= w / h <= 2.3: continue
        out.append({"id": a["AssetID"], "title": (a.get("Title") or "").strip(), "alt": (a.get("AltText") or a.get("Description") or "").strip()[:200],
                    "credit": "NPS Photo / " + re.sub(r"^NPS( Photo)?\s*[/:,-]?\s*", "", credit), "w": w, "h": h, "score": -neg,
                    "img": "https://www.nps.gov/npgallery/GetAsset/%s/proxy/hires" % a["AssetID"], "page": page_url})
    return out, len(res), len(cheap)


def sheet(items, thumbs, path):
    cols, tw, th, pad, lab = 4, 300, 200, 8, 34
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGB", (cols * (tw + pad) + pad, rows * (th + lab + pad) + pad), (20, 14, 36))
    d = ImageDraw.Draw(im)
    for i, (it, t) in enumerate(zip(items, thumbs)):
        x, y = pad + (i % cols) * (tw + pad), pad + (i // cols) * (th + lab + pad)
        t = t.copy(); t.thumbnail((tw, th)); im.paste(t, (x + (tw - t.width) // 2, y + (th - t.height) // 2))
        d.text((x + 2, y + th + 2), "#%d %s" % (i, it["title"][:42]), fill=(255, 220, 120))
        d.text((x + 2, y + th + 16), it["credit"][:46], fill=(200, 190, 230))
    im.save(path, quality=80)


def main():
    out = sys.argv[1]; only = [c.upper() for c in sys.argv[2:]]
    os.makedirs(out, exist_ok=True)
    places = json.load(open(os.path.join(REPO, "data", "places.json"), encoding="utf-8"))["places"]
    for p in places:
        if not p["id"].startswith("nps-"): continue
        code = p["id"][4:].upper()
        if only and code not in only: continue
        have = {ph.get("page") for ph in p.get("photos") or []}
        top, total, cheap = candidates(code, have)
        thumbs = []
        for c in top:
            try: thumbs.append(Image.open(io.BytesIO(get_bytes("https://www.nps.gov/npgallery/GetAsset/%s/proxy/lores" % c["id"]))).convert("RGB"))
            except Exception: thumbs.append(Image.new("RGB", (300, 200), (60, 0, 0)))
        json.dump({"place": p["id"], "searched": total, "passedCheapFilters": cheap, "have": len(have), "candidates": top}, open(os.path.join(out, p["id"] + ".json"), "w", encoding="utf-8"), indent=1)
        if top: sheet(top, thumbs, os.path.join(out, p["id"] + ".jpg"))
        print("%s: searched %d, %d pass the licence/credit/words filters, %d shown after the size check (already has %d)" % (p["id"], total, cheap, len(top), len(have)))


if __name__ == "__main__":
    main()
