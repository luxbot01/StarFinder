#!/usr/bin/env python3
"""Tests for tools/burnbans.py, run before every scheduled fetch:  python -I tools/test_burnbans.py
Each test plants a county it knows the answer for. The control at the end breaks the code on purpose and expects the
planted-positive test to turn red, so a test that cannot fail does not pass quietly."""
import json, sys, traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import burnbans as bb  # noqa: E402

TX = json.loads((HERE.parent / "data" / "tx_counties.json").read_text(encoding="utf-8"))
NOW = datetime(2026, 11, 2, 12, 0, 0, tzinfo=timezone.utc)
STAMP = "10/30/2026 8:18:37 AM"


def mk(names, stamp=STAMP, count=None, xml_names=None, xml_stamp=None, doctype=False):
    n = len(names) if count is None else count
    txt = ("﻿%d Texas Burn Bans - %s\r\n" % (n, stamp) + "".join(x + "\r\n" for x in names)).encode("utf-16-le")
    assert txt[:2] == b"\xff\xfe"   # the leading U+FEFF encodes to the BOM, like the real file
    xn = names if xml_names is None else xml_names
    body = "<?xml version='1.0' encoding='utf-16'?> <rss version='2.0'><channel><title>Texas Burn Bans</title><item><title>\r\n%d Texas Burn Bans - %s</title><description>\r\n%s\r\n</description></item></channel></rss>" % (
        len(xn), xml_stamp or stamp, ", ".join(xn))
    if doctype:
        body = "<!DOCTYPE x [<!ENTITY a 'b'>]>" + body
    return txt, b"\xff\xfe" + body.encode("utf-16-le")


def P(pid, county):
    return {"id": pid, "county": county}


PLACES = [P("tx-colorado-bend", "San Saba"), P("tx-inks-lake", "Burnet"), P("tx-dewitt", "DeWitt"), P("ok-turner-falls", None),
          P("nps-lamr", "Hutchinson (the NRA also spans Moore and Potter, per Wikipedia)"), P("tx-purtis-creek", "Henderson and Van Zandt"),
          P("tx-eagle", "El Paso"), P("tx-lasalle", "La Salle")]
OVR = dict(bb.OVERRIDES)


def run(names, **kw):
    t, x = mk(names, **{k: v for k, v in kw.items() if k in ("stamp", "count", "xml_names", "xml_stamp", "doctype")})
    return bb.build(t, x, PLACES, TX, kw.get("prev"), NOW, accept_drop=kw.get("accept_drop", False))


def expect_fail(fn, label):
    try:
        fn()
    except bb.Fail:
        return
    raise AssertionError("expected Fail: " + label)


def t_planted_positive():
    r = run(["SAN SABA", "BURNET"])["places"]
    assert r["tx-colorado-bend"]["status"] == "ban" and r["tx-colorado-bend"]["banned"] == ["San Saba"], r["tx-colorado-bend"]
    r = run(["LAMPASAS"])["places"]   # the second county of Colorado Bend alone is enough
    assert r["tx-colorado-bend"]["status"] == "ban" and r["tx-colorado-bend"]["banned"] == ["Lampasas"], r["tx-colorado-bend"]


def t_clean_negative():
    r = run(["BURNET", "TRAVIS"])["places"]
    assert r["tx-colorado-bend"]["status"] == "none" and r["tx-colorado-bend"]["banned"] == []
    assert r["tx-colorado-bend"]["counties"] == ["San Saba", "Lampasas"]
    assert r["tx-inks-lake"]["status"] == "ban"
    r = run([])["places"]               # a list with no counties at all is a valid "none anywhere" list
    assert all(v["status"] in ("none", "not_covered") for v in r.values())


def t_names_and_multicounty():
    r = run(["DEWITT", "EL PASO", "LA SALLE", "VAN ZANDT", "POTTER"])["places"]
    assert r["tx-dewitt"]["status"] == "ban"                      # DEWITT vs DeWitt
    assert r["tx-eagle"]["status"] == "ban" and r["tx-lasalle"]["status"] == "ban"
    assert r["tx-purtis-creek"]["banned"] == ["Van Zandt"] and r["tx-purtis-creek"]["counties"] == ["Henderson", "Van Zandt"]
    assert r["nps-lamr"]["counties"] == ["Hutchinson", "Moore", "Potter"] and r["nps-lamr"]["banned"] == ["Potter"]
    assert r["ok-turner-falls"] == {"counties": [], "status": "not_covered", "banned": []}


def t_refusals():
    expect_fail(lambda: run(["SAN SABA", "BURNET"], count=5), "count mismatch (a truncated file)")
    expect_fail(lambda: run(["SAN SABA"], xml_names=["SAN SABA", "BURNET"]), "txt and xml disagree on the names")
    expect_fail(lambda: run(["SAN SABA"], xml_stamp="10/31/2026 8:18:37 AM"), "txt and xml disagree on the date")
    expect_fail(lambda: run(["SAN SABA", "ATLANTIS"]), "not a county")
    expect_fail(lambda: run(["SAN SABA", "SAN SABA"]), "listed twice")
    expect_fail(lambda: run(["SAN SABA"], doctype=True), "DOCTYPE")
    t, x = mk(["SAN SABA"])
    expect_fail(lambda: bb.build(b"\xff\xfe" + "<html>moved</html>".encode("utf-16-le"), x, PLACES, TX, None, NOW), "garbage header")
    expect_fail(lambda: bb.build(b"", x, PLACES, TX, None, NOW), "empty file")
    expect_fail(lambda: bb.build(t, x, PLACES + [P("tx-nowhere", "Narnia")], TX, None, NOW), "a place county that is not a Texas county")


def t_big_drop():
    prev = {"banCount": 149}
    expect_fail(lambda: run(["SAN SABA"] * 1 + ["BURNET", "TRAVIS"], prev=prev), "149 to 3 counties overnight")
    run(["SAN SABA", "BURNET", "TRAVIS"], prev=prev, accept_drop=True)       # taken by hand
    run(["SAN SABA", "BURNET", "TRAVIS"], prev={"banCount": 4})              # a small list moves freely


def t_stamp():
    assert bb.stamp_to_iso("10/30/2026 8:18:37 AM") == "2026-10-30T08:18:37-05:00"
    assert bb.stamp_to_iso("11/2/2026 2:05:00 PM") == "2026-11-02T14:05:00-06:00"
    assert bb.stamp_to_iso("1/15/2027 12:00:00 AM") == "2027-01-15T00:00:00-06:00"
    assert bb.stamp_to_iso("3/8/2026 1:30:00 AM") == "2026-03-08T01:30:00-06:00"   # before the second Sunday of March 2026 turns clocks
    assert bb.stamp_to_iso("3/8/2026 3:00:00 AM") == "2026-03-08T03:00:00-05:00"


def t_heartbeat_logic():
    a = run(["SAN SABA"])
    b = dict(a, checked="2026-11-02T18:00:00Z")
    assert bb.same_but_checked(a, b) and not bb.same_but_checked(a, run(["SAN SABA", "BURNET"])) and not bb.same_but_checked(None, a)
    assert bb.age_hours("2026-11-02T00:00:00Z", NOW) == 12.0


TESTS = [t_planted_positive, t_clean_negative, t_names_and_multicounty, t_refusals, t_big_drop, t_stamp, t_heartbeat_logic]


def control():
    """Break the matching on purpose: the planted-positive test must go red, or it proves nothing."""
    real = bb.key
    bb.key = lambda n: n   # an exact string compare, so DEWITT no longer meets DeWitt
    try:
        t_names_and_multicounty()
    except (AssertionError, bb.Fail):
        return True
    finally:
        bb.key = real
    return False


def main():
    bad = 0
    for t in TESTS:
        try:
            t()
            print("ok   ", t.__name__)
        except Exception:
            bad += 1
            print("FAIL ", t.__name__)
            traceback.print_exc()
    ok = control()
    print("ok   " if ok else "FAIL ", "control: a broken matcher turns the name test red")
    bad += 0 if ok else 1
    print("%d of %d passed" % (len(TESTS) + 1 - bad, len(TESTS) + 1))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
