# The five challenge targets

The challenge asks to test the tool on Barnard's Star, Epsilon Indi B, WISE 0855−0714, RW Aurigae and R Draconis. This page records what SPHEREx shows for each, how it was measured, and where the method reaches its limits. Every number here can be reproduced with the scripts in `probes/`.

## Summary

| Target | What the challenge tests | Result | Verdict |
| --- | --- | --- | --- |
| Epsilon Indi B | A nearby brown-dwarf pair moving 4.7″/yr | Measured motion 6.25″ against 6.24″ predicted by Gaia DR3 over 1.37 years (detector 2); within 0.07–0.45″ in all six detectors | **Passed** |
| Barnard's Star | The fastest known stellar proper motion | Measured 10.3–11.6″ against 10.0–10.7″ predicted over one year, direction within 1–9°; the core is partly saturated | **Passed, with saturation** |
| WISE 0855−0714 | The coldest known brown dwarf, fast and faint | At 4.4–5 µm it moves 8.9″ against 8.0″ predicted; at 0.75–3.8 µm a fixed background star dominates and nothing moves | **Passed at 4.4–5 µm only, as expected** |
| RW Aurigae | A young star with irregular dimming | Faded 0.5–0.75 mag at 2.4–5 µm between September 2025 and September 2026, while comparison stars stayed within 0.01 mag | **Change detected** |
| R Draconis | A Mira variable | Pulsation recovered from the unsaturated wings, each spectral channel compared with itself: period 235 days (192–312) against 246 days from AAVSO; brightest within 6–22 days of the predicted maximum | **Recovered, noisy** |

## How the motion was measured (first three targets)

1. **Position.** Each target's catalogue position is propagated to every visit with its proper motion and parallax (Gaia DR3 for Barnard's Star and Epsilon Indi B; the challenge coordinate and Luhman (2014) for WISE 0855).
2. **Frames.** All exposures of a visit are resampled onto one north-up grid fixed on the sky and averaged per detector.
3. **Registration check.** In every frame, 14–121 Gaia DR3 stars that barely move (under 30 mas/yr, G between 12 and 16) are centroided and compared with their catalogue positions. The median offset corrects the frame; the scatter is the registration error. Offsets were at most 0.06 pixel (0.4″).
4. **Target.** The target is centroided near its predicted position. Saturated pixels are missing in SPHEREx images, so a saturated core is centred on its wings.
5. **Blind check.** The same centroids were repeated starting from the grid centre in every visit, with no knowledge of the motion. The results did not change.

Script: `probes/p11_motion_targets.py TARGET 10` → `docs/targets/TARGET.png` and `.json`

### Epsilon Indi B

- Gaia DR3 6412596012146801152 (G = 18.0), 402″ from Epsilon Indi A. The two brown dwarfs, about 0.7″ apart, appear as one source.
- Four visits from May 2025 to September 2026; peak S/N 22–1,740 per visit and detector; never saturated.

| Detector | From → to | Years | Predicted | Measured | Difference | Registration error |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | 2025-04-26 → 2026-04-26 | 1.00 | 4.68″ | 4.94″ | 0.45″ | ±0.35″ |
| D2 | 2025-05-16 → 2026-09-30 | 1.37 | 6.24″ | 6.25″ | 0.07″ | ±0.21″ |
| D3 | 2025-05-20 → 2026-09-25 | 1.35 | 6.14″ | 6.23″ | 0.10″ | ±0.26″ |
| D4 | 2025-04-26 → 2026-04-26 | 1.00 | 4.68″ | 4.40″ | 0.40″ | ±0.42″ |
| D5 | 2025-05-16 → 2026-09-30 | 1.37 | 6.24″ | 6.08″ | 0.16″ | ±0.40″ |
| D6 | 2025-05-20 → 2026-09-25 | 1.35 | 6.14″ | 6.24″ | 0.23″ | ±0.52″ |

- At every visit the target sits within 0.15 pixel (0.9″) of its predicted position.
- **Reading:** SPHEREx's 6.15″ pixels measure a one-pixel motion to a few hundredths of a pixel when the source is bright and isolated.

### Barnard's Star

- Gaia DR3 4472832130942575872. Three visits: August 2025, March 2026, September 2026.

| Detector | Predicted | Measured | Difference | Direction | Saturated core pixels |
| --- | --- | --- | --- | --- | --- |
| D1 | 9.99″ | 10.42″ | 0.73″ | −3° | up to 2 |
| D2 | 10.63″ | 10.32″ | 0.32″ | −1° | up to 4 |
| D3 | 10.69″ | 11.57″ | 1.33″ | −5° | up to 3 |
| D4 | 9.99″ | 11.46″ | 1.59″ | +3° | up to 4 |
| D5 | 10.63″ | 10.55″ | 1.58″ | −9° | 0 |
| D6 | 10.31″ | 10.45″ | 0.88″ | −5° | 0 |

- The registration error is ±0.2″ in every detector, so the larger differences come from the star itself: partial saturation and the bright, undersampled core bias the centroid.
- **Reading:** the motion is unmistakable (1.7 pixels in a year, in the right direction), but a saturated star is measured to about 10 %, not to 1 %.

### WISE 0855−0714

- The challenge coordinate refers to about 2010; propagated with 8.1″/yr, the object sits 120″ from it in 2025–2026.
- Three visits: May 2025 (few exposures), November 2025, May 2026.

| Detector | Wavelength | Measured motion | Predicted | What is measured |
| --- | --- | --- | --- | --- |
| D1 | 0.75–1.09 µm | 0.37″ | 8.08″ | A fixed background star |
| D2 | 1.10–1.62 µm | 0.31″ | 8.18″ | The same star |
| D3 | 1.63–2.41 µm | 0.78″ | 8.04″ | The same star |
| D4 | 2.42–3.82 µm | 1.07″ | 8.08″ | The same star, fading |
| D5 | 3.83–4.41 µm | 6.28″ | 8.18″ | A blend of both |
| D6 | 4.42–5.00 µm | 8.93″ | 8.04″ | WISE 0855 (S/N 5–17) |

- In D6 the source lies within 0.3 pixel of the predicted position at all three visits; in D1 it drifts from 1.8 to 0.6 pixel away, because the star stays put while the prediction moves.
- **Reading:** this is the infrared signature the challenge describes. At short wavelengths WISE 0855 is invisible and a background star sits almost on top of it; at 4.4–5 µm the star fades and the brown dwarf appears and moves as predicted. The first visit has S/N 5 in D6, so its single positions are uncertain.

## How the brightness was measured (last two targets)

1. **The core is often saturated.** SPHEREx marks saturated pixels as missing, so the star's centre cannot be measured.
2. **The wings are not.** The flux in a ring 3 to 7 pixels from the centre scales with the star's total brightness.
3. **Calibration check.** The flux of unsaturated Gaia stars in the same frames shows how stable the calibration is between frames.
4. **Same wavelength only.** Because the wavelength changes along each detector, a frame is compared only with frames of the same detector (whole visits) or the same spectral channel (single exposures).

### RW Aurigae

- Three visits: September 2025, February–March 2026, September 2026. The binary (1.4″) is blended into one source. The core was not saturated in the visit averages.
- Script: `probes/p12_brightness_targets.py rwaur` → `docs/targets/rwaur.png`

| Detector | March 2026 vs September 2025 | September 2026 vs September 2025 | Comparison stars (rms) |
| --- | --- | --- | --- |
| D1 (0.75–1.09 µm) | −0.10 mag | −0.21 mag | 0.009 mag |
| D2 (1.10–1.62 µm) | −0.26 mag | −0.22 mag | 0.008 mag |
| D3 (1.63–2.41 µm) | −0.12 mag | −0.05 mag | 0.008 mag |
| D4 (2.42–3.82 µm) | +0.20 mag | +0.53 mag | 0.012 mag |
| D5 (3.83–4.41 µm) | +0.20 mag | +0.73 mag | 0.013 mag |
| D6 (4.42–5.00 µm) | +0.40 mag | +0.75 mag | 0.003 mag |

(Negative is brighter.)

- **Reading:** RW Aurigae's infrared glow at 2.4–5 µm faded steadily by 0.5–0.75 mag, while the star at 0.75–2.4 µm brightened slightly. The change is 40–250 times the scatter of the comparison stars. It fits warm circumstellar dust thinning, but SPHEREx alone does not prove the cause.

### R Draconis

- In SPHEREx's northern deep field: 2,589 exposures over 17 months.
- **First attempt, failed:** averaging all exposures in 10-day bins gave jumps of up to 4 mag. Each bin samples different spectral channels, and a Mira's spectrum is full of molecular bands, so the method mixed wavelength with time.
- **Second attempt:** every exposure measured on its own, grouped by detector and spectral channel (17 channels of about 120 rows per detector), each channel compared only with itself. 1,087 points in 38 channels.
- Script: `probes/p13_rdra_channels.py` → `docs/targets/rdra_channels.png`

| Detector | Points | Amplitude at the AAVSO period | Brightest relative to the predicted visual maximum | Scatter after the fit |
| --- | --- | --- | --- | --- |
| D1 | 575 | 1.49 mag | +6 days | 0.44 mag |
| D2 | 25 | 1.95 mag | +9 days | 0.60 mag |
| D3 | 205 | 1.79 mag | +22 days | 0.56 mag |
| D4 | 282 | 0.33 mag | not recovered | 0.74 mag |

- **Period from the data alone** (Lomb–Scargle, D1 and D3 together): 235 days, half-power range 192–312 days; AAVSO VSX gives 246.12 days. D1 alone picks a 133-day alias, because of gaps in the sampling.
- **Reading:** the 246-day pulsation is visible and in phase with the AAVSO prediction. Single points scatter by about half a magnitude, so this is a light curve for the eye, not precision photometry. D4 shows no clear pulsation.

## The brightness lens in the product

The R Draconis lesson became the product's method for any point (`service/sedna/science/photometry.py`, `/api/brightness`):

1. **Exact wavelength.** Each exposure's wavelength at the point comes from the pipeline's own spectral WCS (extension WCS-WAVE), evaluated once per detector. `probes/p14_wavelength.py` showed the map is identical in exposures months apart and across releases. It replaced the "row ÷ 120" approximation and corrected the detector ranges (D1 is 0.735–1.126 µm, not 0.75–1.09).
2. **Native pixels.** Every exposure is measured on its own pixels at the position given by its own WCS: a 2-pixel aperture, or the 3–7 pixel wings when more than a fifth of the exposures have a saturated core.
3. **Like with like.** Exposures are grouped into 17 channels per detector (equal steps in log wavelength) and into time bins (one per visit, or 10-day slices in the deep fields). A median polish splits the magnitudes into a channel term (the spectrum) and a time term (the change). Only channels seen in two or more bins count. Changes are relative to the median over bins.
4. **Spectrum.** For unsaturated points, every exposure of a time bin is one point at its own wavelength. For saturated stars no spectrum is shown, because the wings widen with wavelength.

Results as the tool shows them:

| Target | Lens result | Earlier result above |
| --- | --- | --- |
| RW Aurigae, September 2025 → September 2026 | D1 −0.52, D2 −0.36, D3 −0.08, D4 +0.17, D5 +0.72, D6 +0.72 mag; spectrum rising from 0.1 Jy at 0.75 µm to about 2 Jy at 5 µm | D1 −0.21, D2 −0.22, D3 −0.05, D4 +0.53, D5 +0.73, D6 +0.75 mag |
| R Draconis, April 2025 → September 2026 (wings, 1,151 of 2,589 exposures) | Varies by up to 2.3 mag; D3 1.85 mag fainter in June 2026 than in April 2025 | Amplitude 1.5–1.95 mag at the AAVSO period |

- **Where they agree:** D3, D5 and D6 of RW Aurigae, and R Draconis's amplitude.
- **Where they differ:** RW Aurigae's D1, D2 and D4, by 0.1–0.35 mag. The earlier numbers compare visit averages. Each average mixes whichever channels that visit happened to sample, and D4 spans 2.4–3.9 µm, where the spectrum changes steeply. The lens compares each channel only with itself, so its values are the ones to trust; the gap shows how much a channel mix can bias a broad-band comparison.
- **Tests:** synthetic images and measurements in `service/tests/test_photometry.py` (aperture flux against the analytic value, saturated cores, a red spectrum fading by 0.5 mag seen through different channels in each bin); chart definitions against a recorded response in `web/src/lib/brightness.test.ts`.

## Corrections made while building this matrix

- Epsilon Indi B's position in the tool was a rough 2000-era value; it now uses Gaia DR3 6412596012146801152.
- R Draconis's position was off by about 33″ (5 pixels); it now uses AAVSO VSX. RW Aurigae's position was refined the same way.
- An earlier note said Barnard's Star saturates in every channel. The visit averages show 0–4 saturated pixels in its core, depending on the detector.
