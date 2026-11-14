# Decision tests on real SPHEREx data

Before building the interface we ran tests on real data to decide what SEDNA could honestly promise. Each test lists the script that reproduces it. Scripts live in `probes/`.

## Summary

| # | Question | Result | Status |
| --- | --- | --- | --- |
| 1 | Does a known distant object appear in single SPHEREx exposures where JPL Horizons predicts it? | Makemake is detected in 21 of 21 detector-1 exposures, median peak S/N 16 | Passed |
| 2 | Can one unknown, distance, reproduce the apparent track? | Yes, once a circular orbit is assumed. Distance recovered within 1–20 % for five bodies | Passed with a stated assumption |
| 2b | Does the distance focus work on real pixels? | Makemake's stack is sharpest at 48.3 au; JPL Horizons gives 52.4 au | Passed |
| 3 | Can cutouts be read straight from the public bucket, fast? | 0.09 s per exposure; 21 cutouts in 2.0 s | Passed |
| 4 | Is WISE 0855 visible in detector 6? | Yes: S/N 11 in detector 6 and 12 in detector 5 at the propagated position, with a field star one pixel away | Passed, with blending |
| 5 | Can a saturated variable star be followed from its unsaturated wings? | Yes, per detector and per channel: R Draconis's period recovered as 235 d (192–312) against 246.12 d in AAVSO VSX | Passed, see [target-matrix.md](target-matrix.md) |

The full results for the five challenge targets are in [target-matrix.md](target-matrix.md).

## An unplanned finding: SEDNA needs its own sky index

During the hackathon the IRSA search services (TAP and SIA) returned HTTP 502 or timed out. The public bucket on AWS kept working.

- The first 28,800 bytes of every Level-2 file hold the full celestial WCS, the observation time and the observation ID.
- Reading that header takes about 0.26 s, and 48 parallel readers index about 115 files per second.
- SEDNA therefore builds its own index of exposures directly from the bucket and does not depend on the IRSA search services at all.

Scripts: `service/sedna/archive/build_index.py`, `probes/p3_s3_layout.py`.

## Test 1 — a known distant object in single exposures

- **Method:** ask JPL Horizons for Makemake's apparent position with SPHEREx itself as the observer (`500@-163182`) at the mid-time of each exposure; convert to a pixel with the exposure's WCS; read a 25 × 25 pixel cutout by HTTP range request.
- **Result:** 21 detector-1 exposures between MJD 60834 and 60863 contain the predicted position. Makemake is at the predicted pixel in all 21, with peak S/N from 6 to 24 (median 16). Field stars shift around it from day to day.
- **Script:** `probes/p4_known_mover.py Makemake 136472 200.0 21.4` → `probes/p4_makemake.png`

## Test 2 — one unknown for the apparent track

Compared the true track from JPL Horizons with two models seeded at one instant.

| Body | True distance (au) | Pure parallax: recovered | Parallax + circular orbit: recovered | Track error within ±5 days |
| --- | --- | --- | --- | --- |
| Haumea | 49.6 | 57.7 | 49.2 | 0.8 px |
| Makemake | 52.6 | 55.2 | 50.2 | 1.4 px |
| Sedna | 82.8 | 126.0 | 91.0 | 1.2 px |
| Eris | 95.3 | 126.6 | 106.8 | 2.1 px |
| Pluto | 34.9 | 59.2 | 28.1 | 4.2 px |

- **Pure parallax is not enough.** SPHEREx observes near quadrature, where the parallactic rate is low and the body's own orbital motion matters as much.
- **Parallax plus a circular, prograde, in-ecliptic orbit works.** The distance error is 1–10 % for low-eccentricity bodies and 12–20 % for Eris and Pluto.
- **Consequence for the product:** the distance focus states this assumption on screen and reports its result as an estimate.
- **Script:** `probes/p5_one_knob.py`; model in `service/sedna/science/parallax.py`

## Test 2b — the distance focus on real pixels

- **Method:** seed the model on Makemake's position in one exposure only. For each of 60 trial distances from 25 to 400 au, shift the other 18 exposures to where the object would be and take the median.
- **Result:** the stack is sharpest at 48.3 au with a peak S/N of 46. With no shift the same measure is 2. Half-maximum range: 40 to 61 au. JPL Horizons gives 52.4 au.
- **Note:** exposures come in groups of four taken within minutes, so a bright star can survive the median when two groups fall close in time.
- **Script:** `probes/p6_focus_real.py Makemake 136472 200.0 21.4` → `probes/p6_focus_makemake.png`

## The distance focus as the product runs it

Run on every visit of four known bodies with detectors 1–4, a six-day window, 72 trial distances from 25 to 600 au, and the model seeded on the body's position in the first exposure. Each case takes 4 to 6 seconds.

| Body | Visit | Exposures | JPL Horizons (au) | Focus (au) | Half-maximum range | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Makemake | 1 | 35 | 52.4 | 48.9 | 47–51 | Clear |
| Makemake | 2 | 47 | 52.8 | 56.0 | 54–61 | Clear |
| Makemake | 3 | 52 | 52.4 | 51.2 | 47–51 | Clear |
| Haumea | 1 | 51 | 49.4 | 48.9 | 49–49 | Clear |
| Haumea | 2 | 36 | 49.9 | none | — | No focus: a fixed source sits at the starting point |
| Haumea | 3 | 37 | 49.4 | 48.9 | 49–51 | Clear |
| Pluto | 1 | 4 | 35.2 | none | — | No focus: four exposures within minutes |
| Pluto | 2 | 49 | 35.0 | 48.9 | 34–61 | Uncertain: 40 % off |
| Pluto | 3 | 50 | 35.5 | 34.2 | 30–37 | Clear |
| Pluto | 4 | 9 | 35.2 | 32.7 | 29–56 | Uncertain |
| Eris | 1 | 38 | 95.5 | 143 | 64–600 | No focus: a fixed source nearby |
| Eris | 2 | 36 | 95.4 | 73 | 67–143 | No focus: too faint |
| Eris | 3 | 43 | 95.6 | 131 | 80–187 | Uncertain |

- **Where it works:** Makemake and Haumea, in five of six visits, within 1–7 % of the true distance.
- **Where it is weak:** Pluto's eccentric orbit gives one result 40 % off, and Eris (V = 18.6) is too faint in single exposures for a firm distance.
- **How the product says so:** every result carries a verdict (clear, uncertain, no focus) with its reason, computed from the peak sharpness, the sharpness with no shift, the width of the peak, and the number and span of exposures.
- **Script:** `probes/p10_focus_bodies.py`; code in `service/sedna/science/focus.py` and `service/sedna/focus_service.py`

## The parallax ruler

For any pair of visits, the ruler shows where a body seen at one point would be at the second date, at 50, 100, 300 and 500 au and at 2 pc, with the same model as the distance focus (`/api/parallax-ruler`, `science/parallax.py`).

- On Makemake's field, between 13 June and 30 December 2025: 2.8° at 50 au, 1.3° at 100 au, 25′ at 300 au and 15′ at 500 au, that is 28, 13, 4.1 and 2.4 fields of view away. A star at 2 pc shifts by 1.0″. Only bodies beyond about 2,100 au stay inside a 6′ field.
- **Why it matters:** a blink of fixed coordinates cannot follow a world in the outer Solar System. The ruler makes that visible on any field and points to the distance focus.
- **Tests:** `service/tests/test_ruler_next_visit.py` (no shift for the same date, shifts falling with distance, a star at 2 pc under 1″, larger fields holding nearer bodies).

## Next-visit check

After the distance focus, SEDNA predicts where the body will be at SPHEREx's next visit and looks for it there (`service/sedna/next_visit_service.py`, `/api/next-visit`, `/api/next-visit-at`).

- **The prediction is a region.** Against JPL Horizons, the model's position 5–7 months later is off by 5–16′ when the jump is 1.6–2.8°. The region covers distances within ±10 % of the focus result and 36′ around them.
- **The search.** Up to 20 exposures of the next visit are stacked twice: fixed on the sky and following the body at the focus distance. A detection must reach S/N 7 in the difference (followed minus fixed, smoothed 3 × 3), lie within 8′ of the predicted arc, avoid the trails of bright stars, have no negative lobe beside it (a star shifted by a pixel leaves one), and appear in both halves of the exposures.
- **How the rules were set.** The first version took the brightest peak and found star residuals 7–25′ from Makemake. Each rule above removed one kind of false detection seen in the data. The negative-lobe limit (1.0) separates Makemake (0.2 and 0.7) from every false candidate above S/N 7 (1.3 to 65).

| Body | Visit | Focus (au) | JPL (au) | Days ahead | Jump | Prediction off by | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Makemake | 1 | 48.9 | 52.4 | 208 | 2.8° | 16.0′ | **Found**, S/N 9, 2.5″ from JPL |
| Makemake | 2 | 56.0 | 52.8 | 161 | 1.6° | 8.3′ | **Found**, S/N 10, 2.8″ from JPL |
| Haumea | 1 | 48.9 | 49.4 | 208 | 2.8° | 5.0′ | Not found |
| Pluto | 2 | 48.9 (uncertain) | 35.0 | 206 | 2.8° | 76′ | Not found |
| Pluto | 3 | 34.2 | 35.5 | 158 | 2.4° | 13.4′ | Not found (9 exposures) |
| Makemake 3, Haumea 3, Pluto 4, Eris 3 | | | | | | | Not observed again in the indexed data |

- **No false detections** in the five searches.
- **Why the misses:** Pluto's visit-2 focus was 40 % off, which put the prediction 76′ away, outside the region. Pluto's visit 3 had only 9 exposures. Haumea sits inside the region but does not stand out when followed (S/N 1.6 at its true position); the model's circular, in-ecliptic orbit gets its motion wrong (Haumea's orbit is inclined 28°), which blurs it within the window. That is a limit of the one-parameter model, stated on screen.
- **For a point the person picked:** the same check on the point picked in Makemake's field found it again, and IMCCE SkyBoT named it Makemake, 2.6″ away.
- **Script:** `probes/p15_next_visit.py` → `probes/p15_next_visit.json`

## 90377 Sedna, the namesake

Can SPHEREx see the world this tool is named after? Sedna is 83 au away and shines at V = 20.8 (JPL Horizons), about thirty times fainter than Makemake.

- **Method.** JPL Horizons gives Sedna's position, seen from SPHEREx, at each of the 322 exposures that cover it in three visits. Each exposure is put in units of its own noise; the stars are removed with a static sky made from 241–279 exposures of the same patch taken in other visits, months away, when Sedna was degrees off; stamps centred on Sedna are stacked with outlier rejection. Control: the same stamps along 200 tracks with Sedna's motion, shifted 1–4′ in random directions.
- **Result, 0.73–2.44 µm (detectors 1–3), where reflected sunlight is strongest:**

| Set | Exposures | S/N at Sedna | Control tracks as high or higher |
| --- | --- | --- | --- |
| Visit 1 (Aug 2025) | 52 | 4.8 | 0 of 200 |
| Visit 2 (Jan 2026) | 52 | 3.3 | 2 of 200 |
| Visit 3 (Aug 2026) | 57 | 5.6 | 0 of 200 |
| All visits | 161 | **9.8** | 0 of 200 (highest 2.8) |

- A typical single exposure reaches S/N 0.7. At 2.4–5 µm Sedna is not seen (S/N 1.8 for all visits), as expected for reflected sunlight.
- **How the method was reached.** A first stack without subtracting the stars gave S/N 4.9, but the image showed faint stars beside Sedna: near quadrature Sedna moves only a few pixels within a visit, so the stars do not average out. A static sky from the same visit removed the stars but left too few exposures (S/N 3.3). Taking the static sky from other visits kept every exposure and removed the stars cleanly.
- **What it means.** SPHEREx sees Sedna when its exposures are stacked along a known orbit. Finding a body this faint and still unknown needs its track first, which is what the distance focus does for brighter bodies. A hypothetical Planet Nine is expected to be fainter still in reflected light; SEDNA states that limit instead of promising it.
- **Script:** `probes/p16_sedna.py` → `probes/p16_sedna.png`, `probes/p16_sedna.json`; in the product: `service/sedna/follow_service.py`, `/api/follow?body=sedna`, "Find Sedna" on the start page.

## Test 3 — cutouts straight from the bucket

- IMAGE pixels are uncompressed big-endian float32 starting at byte 28,800 (pipeline 7.0.5), so a strip of rows is one range request.
- 21 cutouts of 25 rows: 2.0 s in total with 16 parallel readers. 19 strips of 141 rows: 2.1 s.
- **Script:** `service/sedna/archive/s3.py`

## Test 4 — WISE 0855 by detector

- **Method:** propagate the challenge coordinate with the published proper motion (the object is 120 arcsec from its catalogue position), look up the exposures in SEDNA's index, and stack the cutouts of one visit per detector.
- **Result, visit of October 2025 (125 cutouts read in 4.2 s):**

| Detector | Exposures | Peak S/N near the predicted position | Where the peak is |
| --- | --- | --- | --- |
| D1 | 18 | 54 | One pixel away: a field star |
| D2 | 24 | 62 | One pixel away: the same star |
| D3 | 21 | 41 | One pixel away |
| D4 | 18 | 18 | One pixel away |
| D5 | 25 | 12 | Exactly at the predicted position |
| D6 | 19 | 11 | Exactly at the predicted position |

- **Reading:** a field star sits about one pixel from WISE 0855 in 2025. It dominates below 4 µm and fades toward long wavelengths, while a source appears exactly at the predicted position in detectors 5 and 6. This is consistent with WISE 0855 being visible only at 4–5 µm, but the two are blended at SPHEREx resolution.
- **Consequence for the product:** the per-detector switch must show the predicted marker, and the difference between visits is the honest way to separate the moving source from the star.
- **Script:** `probes/p8_wise0855.py 1` → `probes/p8_wise0855_v1.png`

## The sky index, complete

- 272,963 exposures of detector 1 from April 2025 through October 2026 (`dr1` and `qr3` releases), built from the bucket headers.
- Detectors 2 and 3 sit 2,262 and 4,549 pixels from detector 1; detectors 4, 5 and 6 see the same fields as 1, 2 and 3. One index locates all six (`probes/p7_detector_geometry.py`).
- A position lookup over the whole mission takes about 42 ms.
- Visits found for the challenge targets: WISE 0855 three, Barnard's Star three, Epsilon Indi B four, RW Aurigae three, R Draconis two long ones (2,585 detector images).

## Where the control objects were, seen from SPHEREx

From JPL Horizons, first date of the range queried:

| Body | Heliocentric distance (au) | V magnitude |
| --- | --- | --- |
| Pluto | 35.3 | 14.5 |
| Haumea | 49.9 | 17.2 |
| Makemake | 52.7 | 17.1 |
| Sedna | 83.2 | 20.8 |
| Eris | 95.6 | 18.6 |

Script: `probes/p1_ephemeris.py`
