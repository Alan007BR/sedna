<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/logos/svg/sedna-horizontal-tagline-on-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/brand/logos/svg/sedna-horizontal-tagline-on-light.svg">
    <img src="docs/brand/logos/svg/sedna-horizontal-tagline-on-light.svg" alt="SEDNA — Explore the Unseen." width="640">
  </picture>
</p>

<p align="center">
  <a href="https://sednaspace.earth"><strong>Open SEDNA</strong></a> ·
  <a href="#what-it-does">Features</a> ·
  <a href="#validation">Validation</a> ·
  <a href="#run-it-locally">Run locally</a> ·
  <a href="docs/deploy.md">Deployment</a> ·
  <a href="docs/brand/README.md">Brand identity</a>
</p>

**Watch the SPHEREx sky change over time, and focus it by distance.** Live at **https://sednaspace.earth** (also https://sednaspace.vercel.app).

SEDNA is a web tool for the NASA Space Apps Challenge 2026 challenge *Planet X and SPHEREx*. Type a sky position or a name, and SEDNA shows NASA SPHEREx images of that patch as a short sequence in time, so anything that moved or changed stands out.

It adds one thing no blink viewer has: a **distance focus**. A world in the outer Solar System jumps out of the frame between SPHEREx visits, so comparing fixed coordinates only shows a point that vanished. Its day-to-day motion is set almost entirely by its distance. Turn the focus knob, and SEDNA shifts and stacks the single exposures for each trial distance: at the right one, the body becomes a sharp point and the stars smear away.

Named after 90377 Sedna, found on 14 November 2003 by comparing images of the same patch of sky.

## What it does

- **One screen to start.** The start page fits one screen on laptops and phones: a real 30′ SPHEREx field drifting slowly behind, Makemake crossing a field in ten single exposures, the search, the five challenge targets and the missions, each with its own real image. The brand intro from the [motion kit](docs/brand/motion/) plays once a session and can be skipped; the kit's orbiting mark covers the longer waits. Nothing moves for visitors who ask for reduced motion.
- **Find Sedna.** 90377 Sedna, 83 au away at magnitude 20.8, is invisible in any single SPHEREx exposure (S/N 0.7). Stacked along its orbit over 161 exposures, with the stars removed using the same sky from other visits, it appears as a point at S/N 9.8, in each of its three visits; none of 200 control tracks comes close. The page says plainly why this works (the orbit is known) and what it means for fainter, unknown worlds.
- **Three one-minute missions** for a first visit: watch Barnard's Star walk, see WISE 0855 appear only in the infrared, and measure Makemake's distance with the focus knob. Each step advances only when the person has done it, every claim is a measured result, and a mission can be shared as a link (`?mission=walk`).
- **Any position or name, fast.** Type coordinates, or any object's name as people write it ("Orion Nebula", "m42", "betelgeuse"): CDS Sesame finds it in SIMBAD, NED or VizieR, through its mirrors, and fast stars are moved by their proper motion to SPHEREx's dates. SEDNA keeps its own index of every SPHEREx exposure (272,963 detector-1 frames, April 2025 to October 2026), built from the public archive bucket: a lookup takes about 40 ms and does not depend on the archive's search services, and a new 6′ field (about 400 exposures) is read in about 10 seconds.
- **Aligned visits.** Exposures are resampled onto one north-up grid and averaged per visit and detector, with one brightness stretch for all dates.
- **Compare.** Blink, difference (later minus earlier) and sum; the six detectors from 0.75 to 5 µm; fields of view from 4 to 15 arcmin.
- **Full screen.** "Full screen" (or F) turns the view into a sky map you drag and zoom around the pointer, up to 24 screen pixels per SPHEREx pixel. The data window keeps a sharp edge inside a blurred, darkened mirror of itself that never carries values, and every control is a small glass widget at the edges that fades while the sky plays. Marks keep their screen size at every zoom. Full screen is the whole tool, not a reduced one: all five modes, detectors, fields of view and overlays are in the widgets, and clicking a star, the brightness lens, the known-mover notes, the parallax ruler, the missions and the single-exposure, distance-focus and Sedna panels open in a details drawer beside the sky.
- **Known or new?** Gaia DR3 stars drawn at their position on each date, a click tells you whether a point is a known star, and SIMBAD adds what it is: its usual name, type, spectral type, distance and other designations (Barnard's Star: BY Dra variable, M4V, 1.83 pc, HIP 87937, GJ 699), with links to its SIMBAD page and its Gaia DR3 record. Most faint stars are only in Gaia, and the card says so. For every field, SEDNA asks IMCCE SkyBoT which known asteroids, comets and dwarf planets crossed it during each visit, explains that moving bodies smear out of visit averages, and opens the single exposures at the moment of the crossing with the body ringed.
- **Brightness and spectrum.** Click any star (or open a variable star) to measure it in every exposure: how its brightness changed over time, per detector, and its 0.75–5 µm spectrum on a chosen date. Each exposure's wavelength comes from the pipeline's own spectral map, and each spectral channel is compared only with itself, so a spectrum full of molecular bands is not mistaken for a change. Saturated stars are measured in their wings. Every value can be downloaded as CSV.
- **Single exposures.** Every exposure of a visit in time order. Pause, click any point, and measure its distance with the focus.
- **Distance focus.** Three steps: watch the point walk among the stars, turn the knob until it snaps into focus, check the distance against JPL Horizons.
- **Next visit.** From the focus distance, SEDNA predicts where the body will be at SPHEREx's next visit, months later and degrees away, then follows the whole predicted region in that visit's exposures. Makemake is found again 2.5″ and 2.8″ from JPL Horizons' position, although the prediction itself was 16′ and 8′ off. Misses are reported as misses.
- **Parallax ruler.** On any field and pair of visits, shows how far a body at 50, 100, 300 or 500 au, or a star at 2 pc, would move: the reason a blink of fixed coordinates cannot catch a distant world.
- **Shareable and embeddable.** The URL reproduces the view, and there is a direct link to the same sky in WiseView. "Copy embed code" gives an iframe of the view (`/embed/?ra=...&dec=...`), which fits a 400 × 300 frame: the sky, a minimal timeline and a link back.
- **Works offline.** The site tries the data service and, if it does not answer, runs on prepared cases recorded from it: the three missions, the five challenge targets, the distance controls and a blind search on Makemake's field. The footer says which one is answering; a view that is not prepared says so and lists the prepared ones.

## Validation

- **The five challenge targets:** see [docs/target-matrix.md](docs/target-matrix.md). Epsilon Indi B's motion is measured within 0.07″ of Gaia DR3 over 1.37 years; WISE 0855 appears and moves only at 4.4–5 µm; RW Aurigae's infrared glow faded by 0.5–0.75 mag in a year; R Draconis's 246-day pulsation is recovered from its unsaturated wings.
- **The distance focus:** see [docs/decision-tests.md](docs/decision-tests.md). Haumea 48.9 au against 49.4 au from JPL Horizons, Pluto 34.2 against 35.5, Makemake 48.9 against 52.4. Eris is too faint in single exposures, and an eccentric orbit can throw the estimate off by up to 40 %; the tool says so with a confidence verdict.

## Run it locally

Requirements: Python 3.12+ and Node 22+.

```sh
# data service
python -m venv .venv
.venv/Scripts/pip install -r service/requirements.txt      # on macOS/Linux: .venv/bin/pip
cd service
../.venv/Scripts/python -m uvicorn sedna.api:app --port 8000

# web app, in another terminal
cd web
npm install
npm run dev        # http://127.0.0.1:5173
```

No data service at hand? `npm run dev:demo` runs the whole site on the prepared cases in `web/public/demo`, and so does a static build (`npm run build`, then `npm run preview`) when the service is offline. The published site answers the prepared cases from these files even when the service is up, and asks the service only for anything else; [docs/deploy.md](docs/deploy.md) describes the deployment (site on Vercel, data service on AWS Lambda).

To record the prepared cases again, run the data service and `npm run dev`, then `npm run bake:demo`: it drives the app through every demo flow and saves the service's answers. `node scripts/check-demo.mjs [app url]` then checks every prepared flow, the start page fitting one screen, the intro, the offline message and the embed, with the service stopped.

The start page's images are rendered from the prepared cases and one 30′ stack, with the app's own stretch: run the data service, then `.venv/Scripts/python web/scripts/render-landing.py` from the repository root. `node scripts/shot-landing.mjs [app url] [folder]` takes screenshots at eight screen sizes and says whether each fits without scrolling.

The folded sky index ships in `data/index/compact.npz`. To rebuild it from the bucket:

```sh
cd service
../.venv/Scripts/python -m sedna.archive.build_index dr1 2025W00 2026W99 --detectors 1
../.venv/Scripts/python -m sedna.archive.build_index qr3 2026W00 2026W99 --detectors 1
../.venv/Scripts/python -c "from sedna.archive.skyindex import SkyIndex; SkyIndex.build_compact()"
```

## How it is built

| Part | Folder | What it does |
| --- | --- | --- |
| Archive access | `service/sedna/archive/` | Range reads from the public SPHEREx bucket, the sky index, JPL Horizons, Gaia DR3 |
| Science | `service/sedna/science/` | Alignment, visit stacks, the distance focus, centroids and brightness |
| Data service | `service/sedna/api.py` | FastAPI endpoints for stacks, films, focus and catalogues |
| Web app | `web/` | React and Vite |
| Probes | `probes/` | The scripts behind every result in `docs/` |

## Data and credits

- **NASA SPHEREx** Level-2 spectral images, Data Release 1 and Quick Release 3, from the NASA/IPAC Infrared Science Archive, read from the AWS Open Data bucket `nasa-irsa-spherex`. DOIs: [10.26131/IRSA678](https://doi.org/10.26131/IRSA678) (DR1 Spectral Images) and [10.26131/IRSA662](https://doi.org/10.26131/IRSA662) (QR3).
  This work makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration.
- **ESA Gaia DR3**, through the ESA Gaia archive.
- **JPL Horizons** (SPHEREx as observer, `500@-163182`) and **IMCCE SkyBoT** for Solar System bodies.
- **AAVSO VSX** for the variable stars' positions and periods.
- **WiseView** (Caselden & Westin) as the model for the viewer's controls.
- Software: Astropy, Astroquery, NumPy, SciPy, Matplotlib, FastAPI, React, Vite, IBM Plex fonts.

## Use of AI

Built with AI coding assistants. See [AI_USAGE.md](AI_USAGE.md).

## License

Code: MIT ([LICENSE](LICENSE)). Data products keep their own terms.
