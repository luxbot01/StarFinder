# StarFinder

A free map of dark skies and campsites across Texas. Every Texas state park, state natural area and
state historic site (89), every National Park Service unit in Texas with a place to visit (15), and the
national forests and grasslands (9), plus three Oklahoma favourites from the first version: 116 places,
each rated by how much of the night sky you can expect to see there.

Open `StarFinder.html` through any static web server (for example `python -m http.server`); opening the
file directly will not load the data.

## What the stars mean

Each place gets the modelled brightness of the sky straight overhead (mag/arcsec²), the faintest star
a naked eye should see there, and the share of a pristine sky's stars that remain visible. The star
rating is that share in half stars, 20 percentage points per star. These are model estimates for a
clear, moonless night, not measurements.

## How the sky glow is made (`tools/`)

1. `fetch_gibs.py` downloads NASA GIBS tiles of the VIIRS Black Marble gap-filled, BRDF-corrected
   Day/Night Band radiance (VNP46A2) for 12 nights, Aug 10 to Oct 28 2026, at the native ~500 m, over
   110.25°W to 87.75°W and 20.25°N to 40.5°N (1,080 tiles, 91 MB, kept outside the repo).
2. `skyglow.py` decodes each grey level through GIBS's own colormap (`gibs_dnb_colormap.xml`, 180
   classes of 0.1 nW/cm²/sr, saturating at 38.2), takes the per-pixel median over the nights, removes a
   0.3 nW floor, and spreads every lit pixel's light by K(d) = (d² + 3²)^-1.25 · e^(-d/100 km) out to
   350 km (Walker's d^-2.5 law with a near-field core and an extinction tail), by FFT.
3. `probe.py` fixes the scale: Enchanted Rock SNA and South Llano River SP, both published Bortle 3,
   are set to an artificial-to-natural ratio of 0.2. Big Bend National Park then reads 22.00,
   McDonald Observatory 21.96, and downtown Austin, Dallas and Houston 18.16, 17.87 and 17.77.
4. `build_data.py` writes `data/places.json` and the overlay tiles in `tiles/sky/{z}/{x}/{y}.png`
   (zoom 4 to 9, 1,366 tiles, 5.4 MB).

Known limits: VIIRS sees little of the blue in white LEDs; bright city cores saturate at 38.2;
the Bortle scale is a whole-sky judgement by eye and this is the zenith only.

## The seven-day forecast (`app/forecast.js`)

Opening a place (its card, or its pin's pop-up) fetches that park's forecast; nothing is fetched before.
The source is the US National Weather Service API (`api.weather.gov`): `/points/{lat},{lon}` gives the
forecast grid and the park's time zone (kept a week), then the gridpoint data gives, per local day: the
day's high and that night's low, the highest chance of precipitation, the amounts of rain, snow and ice
(summed over the day, inches), the sky cover by the hour, and the forecast's own weather types, including
`hail` and the `small_hail` / `large_hail` attributes. The icon follows from those: hail only when the
forecast names hail, storm, freezing rain or sleet, rain and snow, snow, rain, or clear, partly cloudy and
cloudy from the daytime sky cover. "Clearest night" is the lowest mean cloud cover from 9 PM to 3 AM; the
moon's lit fraction comes from the mean synodic month (it reads 99.8% and 100% at the two 2026 lunar
eclipses). If NWS does not answer, Open-Meteo is asked (`api.open-meteo.com`, WMO weather codes; its US
models do not forecast hail), and its credit sits beside the data. Answers are kept in `localStorage` for
30 minutes; offline, a copy up to 12 hours old is shown and labelled, and a failed card retries by itself
when the browser comes back online. The icons are drawn in the file, by us.

## Park data (`data/research/`)

Twelve researcher batches in one fixed schema (`HAIKU_BRIEF.md`), merged and checked:
`verify.py` re-read every TPWD park page's printed latitude and longitude (88 of 89 within 0.5 km;
Cooper's two units differ by 6.8 km and the TPWD point is used), and `verify2.py` compared the NPS and
Forest Service points with Wikipedia's coordinates.

## Sources and licences

| What | Source | Licence |
|---|---|---|
| Night-time radiance and the live lights layer | NASA GIBS, VIIRS SNPP Gap-Filled BRDF Corrected DNB Radiance | NASA data, no restrictions; credit NASA |
| Base map | OpenFreeMap dark style (OpenMapTiles schema) | Map data © OpenStreetMap contributors, ODbL |
| Map engine | MapLibre GL JS 5.24.0 | BSD-3-Clause |
| Park facts | TPWD, NPS and USDA Forest Service pages; Wikipedia where no official point exists | facts, each linked |
| Dark Sky Places | DarkSky International | as published |
| Photos | Wikimedia Commons, linked | each file's own licence |
| Seven-day forecast | National Weather Service API, gridpoint forecast | US government open data, free for any use; credit NWS |
| Forecast when NWS does not answer | Open-Meteo.com | data CC BY 4.0, "Weather data by Open-Meteo.com" shown beside it; their free service is for non-commercial sites |

Not used, and why: the World Atlas of Artificial Night Sky Brightness (Falchi et al. 2016) is
CC BY-NC 4.0; David Lorenz's 2025 atlas publishes no licence; lightpollutionmap.info's tiles are not
openly licensed; the earlier ArcGIS overlay had no stated licence. NASA's VNP46A4 annual composite
would be better than a 12-night median, but downloading it needs a NASA Earthdata login.

## Tests

With the site served on port 4317 (`python -m http.server 4317`):
`node tools/shoot_wx.mjs <outDir>` walks 13 sizes in Chromium and 9 in WebKit (phones, fold cover and inner
screen, landscape, tablet, laptop, 1440, 1920, 21:9 and a portrait monitor) and reports console errors,
failed responses, the search capsule's sizes, the forecast's seven days and any clipped column;
`node tools/test_wx_paths.mjs <outDir>` makes each failure happen on purpose (NWS down, both down,
offline and back, the cache, an expired copy offline). `tools/shoot.mjs` and `tools/shoot_pop.mjs` are
the earlier layout passes.

Code: Apache-2.0 (see LICENSE).
