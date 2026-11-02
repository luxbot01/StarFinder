#!/usr/bin/env python3
"""Turn the helpers' choice files (photo NUMBERS per place) into photo records for tools/merge_photos.py.
The licence, author and links come from the candidate files tools/commons_photos.py wrote from Commons' own metadata,
never from the choosers. The credit is the author's name only (a link, a residence or a '(c) ... some rights reserved'
wrapper is dropped; the licence is shown beside it by the card).
Usage: python -I tools/build_commons_picks.py <dir with choice*.json and <place>.json> <out.json>
"""
import glob, json, os, re, sys

def credit_name(artist):
    s = re.sub(r"https?://\S+", "", artist)
    s = re.sub(r"^\(c\)\s*", "", s, flags=re.I)
    s = re.sub(r",?\s*some rights reserved.*$", "", s, flags=re.I)
    s = re.sub(r"\s+from\s+[A-Z][\w .,'-]+$", "", s)
    return re.sub(r"\s+", " ", s).strip(" ,;")

def main():
    d, out = sys.argv[1], sys.argv[2]
    choice = {}
    for f in sorted(glob.glob(os.path.join(d, "choice*.json"))):
        choice.update(json.load(open(f, encoding="utf-8")))
    recs = {}
    for pid, c in choice.items():
        cand = json.load(open(os.path.join(d, pid + ".json"), encoding="utf-8"))["candidates"] if c["pick"] else []
        recs[pid] = [{"img": cand[i]["img"], "page": cand[i]["page"], "credit": credit_name(cand[i]["artist"]), "license": cand[i]["license"], "source": "Wikimedia Commons"} for i in c["pick"]]
    json.dump(recs, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("places with picks %d, photos %d" % (sum(1 for v in recs.values() if v), sum(len(v) for v in recs.values())))

if __name__ == "__main__":
    main()
