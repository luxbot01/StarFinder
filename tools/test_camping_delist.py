"""Tests for tools/camping_delist.py:  python -I tools/test_camping_delist.py
A "no" verdict delists with the page's words and source; "yes" and "unclear" never do; nothing is deleted; a second run changes
nothing; and the shipped audit and places.json agree (every "no" is delisted, nothing else is)."""
import copy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from camping_delist import apply

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUDIT = {"places": [
    {"id": "a", "verdict": "no", "quote": "We do not allow camping.", "source": "https://example.org/a", "read": "2026-11-02T22:00:00Z"},
    {"id": "b", "verdict": "yes", "quote": "Campsites.", "source": "https://example.org/b", "read": "2026-11-02T22:00:00Z"},
    {"id": "c", "verdict": "unclear", "quote": "Open 8 to 5.", "source": "https://example.org/c", "read": "2026-11-02T22:00:00Z", "pageDate": "May 1, 2026"}]}
n = 0
def t(name, fn):
    global n; fn(); n += 1; print("ok   ", name)

def t1():
    pl = [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}]
    ch = apply(pl, AUDIT)
    assert ch == ["a"], ch
    assert pl[0]["listed"] is False and pl[0]["delistReason"] == "We do not allow camping."
    assert pl[0]["delistSource"] == {"url": "https://example.org/a", "read": "2026-11-02T22:00:00Z"}
    assert all("listed" not in p for p in pl[1:]) and len(pl) == 4
t("only a no verdict delists; the reason is the page's words; rows are never removed", t1)

def t2():
    pl = [{"id": "a"}, {"id": "b"}]; apply(pl, AUDIT); snap = copy.deepcopy(pl)
    assert apply(pl, AUDIT) == [] and pl == snap
t("a second run changes nothing", t2)

def t3():   # the control: a broken apply that delists everything must be caught by the first test's assertions
    def broken(pl, audit):
        for p in pl: p["listed"] = False
        return [p["id"] for p in pl]
    pl = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    try:
        ch = broken(pl, AUDIT); assert ch == ["a"]; raise SystemExit("control failed: a broken apply passed")
    except AssertionError:
        pass
t("control: an apply that delists everything turns the check red", t3)

def t4():
    audit = json.load(open(os.path.join(REPO, "data", "research", "camping_audit_2026-11-02.json"), encoding="utf-8"))
    places = json.load(open(os.path.join(REPO, "data", "places.json"), encoding="utf-8"))["places"]
    no = {e["id"] for e in audit["places"] if e["verdict"] == "no"}
    off = {p["id"] for p in places if p.get("listed") is False}
    assert no == off, (sorted(no - off), sorted(off - no))
    assert len(audit["places"]) == len(places), "the audit must cover every place"
    for p in places:
        if p.get("listed") is False:
            assert p["delistReason"] and p["delistSource"]["url"].startswith("https://") and p["delistSource"]["read"].startswith("2026-")
t("the shipped data: every no in the audit is delisted with its reason and source, and nothing else is", t4)
print(f"{n} of {n} passed")
