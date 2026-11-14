# Project page: text to paste

> **Notas para a equipe (não colar):**
> 1. **Link do vídeo:** subir `docs/video/sedna-demo-30s.mp4` (28,8 s, narrado, com legendas na imagem) no YouTube (Não listado ou Público) e colar o link em *Link to Project Demo*. Testar numa janela anônima. Na descrição do YouTube, repetir: "Narration: synthetic voice (Microsoft neural text-to-speech). Logo and animations made with AI assistance."
> 2. **Origem da ideia:** resolvido. A ideia do distance focus é do Alan; a IA analisou a viabilidade (pesquisa e testes de decisão em dados reais). O campo *Use of Super Intelligence* abaixo diz isso.
> 3. **Repositório público** antes de enviar (o link aparece na descrição).
> 4. **FortiGuard:** pedir a classificação de `sednaspace.earth` (https://www.fortiguard.com/faq/wfratingsubmit), como o guia recomenda.
> 5. Marcar "Terms and Conditions" e "Confirm All Work is Original".
> 6. *High-Level Project Summary* tem limite de 1.500 caracteres (o texto abaixo tem 1.428).

---

## Project Name

SEDNA: Explore the Unseen

## High-Level Project Summary

SEDNA is a public web tool that turns NASA SPHEREx's repeated all-sky infrared images into short films of any patch of sky, so anything that moved or changed stands out, and then helps measure it. Type a name or coordinates: SEDNA aligns every SPHEREx visit of that field, blinks them, and marks known stars (ESA Gaia DR3) and asteroids (IMCCE SkyBoT), so a real change can be told from a known source. It answers the challenge as a WiseView for SPHEREx, and adds what blinking cannot do for distant worlds: a distance focus. Turn one knob and SEDNA shifts and stacks the single exposures for each trial distance; at the right one, a moving body snaps into a sharp point (Makemake: 48.9 au against 52.4 au from JPL Horizons). Applied to a whole region, it finds moving worlds unaided: Makemake and Haumea in each of their visits, with no false candidate in 40 control searches. The same idea finds 90377 Sedna, invisible in any single exposure, at S/N 9.8 in 161 stacked along its orbit. Everything runs on real data, every claim is checked against catalogues, and misses are reported as misses.

Why SEDNA: 90377 Sedna was discovered on 14 November 2003 by comparing pictures of the same patch of sky taken hours apart, the same idea this challenge is built on, and this hackathon began on the same date, 23 years later. Its distant, detached orbit is one of the clues behind the search for a Planet X. SEDNA is named after it.

## Link to Project Demo

[YouTube link, 28.5 seconds]

## Link to Final Project

https://sednaspace.earth

## Detailed Project Description

**What it does**

- **Watch any patch of sky change.** Type a position or any object's name ("Orion Nebula", "Betelgeuse"; resolved through CDS Sesame) and SEDNA shows every SPHEREx visit of that field, aligned on one north-up grid with one brightness stretch for all dates: blink, difference (later minus earlier) and sum, in six detectors from 0.75 to 5 µm. A full-screen sky map pans and zooms, with sharp pixels where motion is judged.
- **Known or new?** Gaia DR3 stars are drawn where they were on each date; clicking a star says what it is (SIMBAD: name, type, distance) and how far it should have moved. For every field, SEDNA asks IMCCE SkyBoT which known asteroids, comets and dwarf planets crossed it, and opens the single exposures at the moment of the crossing.
- **Distance focus.** A distant body jumps out of the frame between SPHEREx visits, so a blink of fixed coordinates only shows a point that vanished. Within one visit, its motion is set almost entirely by its distance (SPHEREx's own parallax plus its orbit). SEDNA shifts and stacks the exposures for 73 trial distances; the knob shows where the image is sharpest, with a confidence verdict.
- **Search a region.** Someone looking at a region does not know where an unseen body is, so SEDNA also searches the whole field with no starting point: every exposure, stars removed, is shifted as a whole for each trial distance and stacked. The search map shows where something stands out; each candidate gets a distance, IMCCE SkyBoT's name if it is known, and one click to the distance focus. The same search on the negated exposures tells how strong noise alone gets in that field.
- **Next visit.** From that distance, SEDNA predicts where the body will be months later, degrees away, and searches the whole predicted region in the next visit's exposures.
- **Find Sedna.** Stacked along its known orbit, with the stars removed using the same sky from other visits, 90377 Sedna (83 au, V = 20.8) appears in each visit and in all three together.
- **Brightness and spectrum.** Click any star to measure it in every exposure: its light curve per detector and its 0.75–5 µm spectrum, with each exposure's wavelength from the pipeline's own spectral map, saturated stars measured in their wings, and a warning when a Gaia neighbour shares the aperture. Data download as CSV.
- **For a first visit,** three one-minute missions (watch Barnard's Star walk, see WISE 0855 appear only in the infrared, measure a dwarf planet's distance), the five challenge targets one click away, a parallax ruler, shareable links and an embeddable view.

**How it works**

SEDNA reads the public SPHEREx bucket on AWS directly. It keeps its own index of every exposure (272,963 pointings, April 2025 to October 2026), built from the files' headers, so a position lookup takes about 40 ms and does not depend on the archive's search services, which were down during the event. For a field it reads only the header and the rows it needs from each file (HTTP range requests), resamples every exposure with its exact WCS, subtracts its background and averages each visit with outlier rejection. A data service (Python, FastAPI, astropy) does this live, about 400 exposures in about 10 seconds for a new field; the web app (React, TypeScript) draws it. The prepared cases for the challenge targets and missions are stored as files, so the site works instantly and keeps working even when the service sleeps.

**Validation on real data** (details in the repository, `docs/decision-tests.md` and `docs/target-matrix.md`)

- Makemake is detected in 21 of 21 single exposures at the positions JPL Horizons predicts (median S/N 16).
- Distance focus: Makemake 48.9 / 56.0 / 51.2 au against 52.4–52.8 au; Haumea 48.9 against 49.4 au; Pluto 34.2 against 35.5 au. Eris is too faint, and one Pluto visit was 40 % off; the tool says "uncertain" or "no focus" instead of guessing.
- Region search, not told where to look: Makemake and Haumea found in each of their three visits, Pluto and Eris once each (8 of 11 visits, distances within 10 % of JPL Horizons), with no other candidate; nothing on the five challenge fields (two visits each) and 30 random fields. Sedna (S/N 4–5 per visit) stays at noise level, as the page says.
- Next visit: Makemake found again 208 and 161 days later, 2.5″ and 2.8″ from JPL Horizons, although the predictions were 16′ and 8′ off. Haumea and Pluto are honest misses (an inclined or eccentric orbit breaks the one-parameter model).
- Sedna: S/N 9.8 from 161 exposures; none of 200 control tracks with the same motion comes close (highest 2.8); a single exposure reaches S/N 0.7.
- Challenge targets: Epsilon Indi B's motion measured 6.25″ against 6.24″ from Gaia DR3 over 1.37 years; Barnard's Star moves 10–12″ a year as predicted; WISE 0855 appears and moves only at 4.4–5 µm; RW Aurigae faded 0.5–0.75 mag at 2.4–5 µm in a year while comparison stars stayed within 0.01 mag; R Draconis's pulsation recovered (235 days against 246 days from AAVSO).

**Benefits and goals**

SPHEREx maps the whole sky every six months in 102 colours, but its data come as hundreds of thousands of calibrated files. SEDNA lets a student, a citizen scientist or an astronomer see and measure change in that sky in seconds, with the context needed to avoid false discoveries. Next, we hope to add a way to report and review candidates, as WiseView's users did for WISE, to combine visits months apart in the region search so fainter bodies stand out, to follow each new SPHEREx release, and to cross-check asteroid tracks with CSA's NEOSSat observations.

**Tools and languages**

Python (FastAPI, astropy, astroquery, NumPy, SciPy), TypeScript (React, Vite, Zod, Recharts), Playwright and Vitest for checks, pytest for the science code. Hosted on Vercel (site) and AWS Lambda (data service, in a US East region near the SPHEREx bucket). Open source (MIT): https://github.com/Alan007BR/sedna

## Use of Super Intelligence (SI)

Yes. We used Claude Code (Anthropic) and Codex (OpenAI) as coding and writing assistants, under the team's direction and review:

- **Code:** most source files were written or edited with AI assistance; each such file says so in its header comment, and `AI_USAGE.md` in the repository describes where and how.
- **Research support:** summarising public documentation of the SPHEREx archive, the challenge and related tools, and checking whether the team's idea of a distance focus was feasible with SPHEREx data.
- **Tests and checks:** writing probe scripts and tests, and reading their results.
- **Visual identity:** Codex helped create the SEDNA logo, its animations and the brand guide.
- **Demo video:** a recording of the published site, made by a script written with AI help. The narration voice is synthetic (Microsoft neural text-to-speech reading our script), and a label on every frame says so, together with the AI-assisted logo and animations. It contains no AI-generated images and no music.

No scientific content is generated by AI: every image, spectrum, light curve and measurement comes from processing real SPHEREx data, checked against Gaia DR3, JPL Horizons and IMCCE SkyBoT. The idea of focusing the sky by distance came from the team; the AI helped check that it was feasible. The team chose the challenge, decided what to build and what to cut, ran the decision tests on real data and judged their results.

## NASA Data

- **NASA SPHEREx Level-2 Spectral Images**, Data Release 1 (DOI 10.26131/IRSA678) and Quick Release 3 (DOI 10.26131/IRSA662), from the NASA/IPAC Infrared Science Archive (IRSA), read from the AWS Open Data bucket `nasa-irsa-spherex`: the images, their WCS and their spectral (wavelength) maps. "This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration."
- **IRSA documentation and the SPHEREx tutorial notebooks** (https://caltech-ipac.github.io/irsa-tutorials/spherex/), for the data format and access.
- **JPL Horizons** (NASA/JPL Solar System Dynamics): positions and distances of Makemake, Haumea, Pluto, Eris and Sedna, with SPHEREx as the observer (`500@-163182`).

## Space Agency Partner Data and Other References

**Space agency partner data**
- **ESA Gaia DR3** (Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1), through the ESA Gaia archive: star positions and proper motions for the overlay, the known-star check, the motion tests of the challenge targets and the neighbour warnings of the brightness lens.

**Other data and services**
- IMCCE SkyBoT (Berthier et al. 2006, ASP Conf. Ser. 351, 367): known Solar System bodies in each field.
- CDS SIMBAD (Wenger et al. 2000, A&AS 143, 9), VizieR (Ochsenbein et al. 2000, A&AS 143, 23) and Sesame, through the CDS, CfA and IDIA sites; NASA/IPAC Extragalactic Database (NED) through Sesame.
- AAVSO International Variable Star Index (VSX): positions and periods of the variable targets.
- WiseView (Caselden & Westin, http://byw.tools/wiseview): the model for the viewer's controls, as the challenge suggests.

**Background references**
- Brown, Trujillo & Rabinowitz 2004, ApJ 617, 645: the discovery of 90377 Sedna.
- Batygin & Brown 2016, AJ 151, 22: the Planet Nine hypothesis.
- Bernstein et al. 2004, AJ 128, 1364: shift-and-stack searches for faint trans-Neptunian objects, the established technique behind the distance focus.
- SPHEREx mission overview: arXiv:2404.11017.

**Software (all open source)**
- Astropy (Astropy Collaboration 2022, ApJ 935, 167), astroquery, NumPy, SciPy, FastAPI, Pydantic, Uvicorn, Requests, certifi.
- React, Vite, TypeScript, Zod, Recharts, Playwright, Vitest.
- AWS Lambda Web Adapter; hosting on Vercel and AWS Lambda.
- IBM Plex Sans and Mono fonts (SIL Open Font License), through Fontsource.

**Our own assets:** the SEDNA logo, animations and brand guide (made by the team with Codex's help), the start page images (rendered from SPHEREx data by `web/scripts/render-landing.py`) and the demo video (recorded from the site by `web/scripts/record-demo.mjs`, narrated by a synthetic voice reading our script, `web/scripts/narration.json`).
