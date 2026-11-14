# References

Everything SEDNA uses or builds on: data, services, the published methods behind the distance focus and the region search, background, and software. Every DOI below was checked against Crossref.

## NASA data

| What | Reference | Link |
| --- | --- | --- |
| SPHEREx Level-2 Spectral Images, Data Release 1 | NASA/IPAC Infrared Science Archive (IRSA), DOI 10.26131/IRSA678 | https://doi.org/10.26131/IRSA678 |
| SPHEREx Level-2 Spectral Images, Quick Release 3 | IRSA, DOI 10.26131/IRSA662 | https://doi.org/10.26131/IRSA662 |
| The same images on AWS Open Data | Bucket `nasa-irsa-spherex`, read directly by SEDNA (HTTP range requests) | https://irsa.ipac.caltech.edu/cloud_access/ |
| SPHEREx at IRSA | Mission page and documentation | https://irsa.ipac.caltech.edu/Missions/spherex.html |
| IRSA SPHEREx tutorials | Notebooks on the data format and access | https://caltech-ipac.github.io/irsa-tutorials/spherex/ |
| The SPHEREx mission | Crill, Werner et al., "SPHEREx: NASA's Near-Infrared Spectrophotometric All-Sky Survey", arXiv:2404.11017 | https://arxiv.org/abs/2404.11017 |
| JPL Horizons | NASA/JPL Solar System Dynamics: positions and distances of Makemake, Haumea, Pluto, Eris and 90377 Sedna, with SPHEREx as the observer (`500@-163182`) | https://ssd.jpl.nasa.gov/horizons/ |

Acknowledgement requested by IRSA: "This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California Institute of Technology, and is funded by the National Aeronautics and Space Administration."

## Space agency partner data

| What | Reference | Link |
| --- | --- | --- |
| ESA Gaia Data Release 3 | Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1 | https://doi.org/10.1051/0004-6361/202243940 |
| Gaia DR3 at ESA | Release page | https://www.cosmos.esa.int/web/gaia/dr3 |
| ESA Gaia Archive | Star positions, proper motions and parallaxes, queried per field | https://gea.esac.esa.int/archive/ |

Gaia DR3 gives SEDNA the star positions for the overlay, the known-star check, the motion tests of the challenge targets and the neighbour warnings of the brightness lens.

This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.

## Other data and services

| What | Reference | Link |
| --- | --- | --- |
| IMCCE SkyBoT | Berthier et al. 2006, ASP Conf. Ser. 351, 367 (2006ASPC..351..367B): which known asteroids, comets and dwarf planets were in a field at a given time | https://ssp.imcce.fr/webservices/skybot/ |
| CDS SIMBAD | Wenger et al. 2000, A&AS 143, 9: what a clicked star is | https://doi.org/10.1051/aas:2000332 |
| CDS VizieR | Ochsenbein et al. 2000, A&AS 143, 23 | https://doi.org/10.1051/aas:2000169 |
| CDS Sesame name resolver | Names typed by people, resolved through SIMBAD, NED and VizieR; SEDNA asks the CfA and IDIA mirrors first | https://cds.unistra.fr/cgi-bin/Sesame |
| NASA/IPAC Extragalactic Database (NED) | Through Sesame | https://ned.ipac.caltech.edu/ |
| AAVSO International Variable Star Index (VSX) | Positions and periods of the variable targets | https://www.aavso.org/vsx/ |
| WiseView | Caselden et al., ASCL 1806.004: the model for the viewer's controls, as the challenge suggests | https://ascl.net/1806.004 |

## The distance focus and the region search

The distance focus and the region search are shift-and-stack, also called digital tracking: exposures are shifted along the motion a body would have and added, so a body too faint for one exposure builds up into a point. SEDNA's own contribution is the interface (one knob, set by distance), its use on SPHEREx single exposures, and the checks against JPL Horizons, control tracks and negated searches (`docs/decision-tests.md`).

| Reference | What SEDNA takes from it | Link |
| --- | --- | --- |
| Bernstein & Khushalani 2000, AJ 120, 3323, "Orbit Fitting and Uncertainties for Kuiper Belt Objects" | Describing a distant body's motion with its inverse distance as a parameter. SEDNA's knob is that parameter, with the orbit reduced to a circular, prograde one in the ecliptic | https://doi.org/10.1086/316868 |
| Bernstein et al. 2004, AJ 128, 1364, "The Size Distribution of Trans-Neptunian Bodies" | Shift-and-stack of many exposures along trial orbits, to find trans-Neptunian objects fainter than any single exposure shows | https://doi.org/10.1086/422919 |
| Heinze, Metchev & Trollo 2015, AJ 150, 125, "Digital Tracking Observations Can Discover Asteroids 10 Times Fainter than Conventional Searches" | Why stacking along a trial motion reaches fainter bodies than looking at single images | https://doi.org/10.1088/0004-6256/150/4/125 |
| Whidden et al. 2019, AJ 157, 119, "Fast Algorithms for Slow Moving Asteroids" (KBMOD) | Searching a whole field over many trial motions with no starting point, as SEDNA's region search does | https://doi.org/10.3847/1538-3881/aafd2d |
| KBMOD software (DiRAC Institute) | An open-source shift-and-stack search for slow-moving bodies | https://github.com/dirac-institute/kbmod |

## Sedna and Planet X

| Reference | Why it matters here | Link |
| --- | --- | --- |
| Brown, Trujillo & Rabinowitz 2004, ApJ 617, 645, "Discovery of a Candidate Inner Oort Cloud Planetoid" | The discovery of 90377 Sedna, the tool's namesake | https://doi.org/10.1086/422095 |
| Trujillo & Sheppard 2014, Nature 507, 471, "A Sedna-like body with a perihelion of 80 astronomical units" | A second Sedna-like body, and the orbital clustering that points to a distant planet | https://doi.org/10.1038/nature13156 |
| Batygin & Brown 2016, AJ 151, 22, "Evidence for a Distant Giant Planet in the Solar System" | The Planet Nine hypothesis behind the challenge's Planet X | https://doi.org/10.3847/0004-6256/151/2/22 |
| Brown & Batygin 2021, AJ 162, 219, "The Orbit of Planet Nine" | The estimate SEDNA quotes for Planet Nine's distance: semi-major axis about 380 au, perihelion about 300 au | https://doi.org/10.3847/1538-3881/ac2056 |

## Software (all open source)

| Software | Reference or link |
| --- | --- |
| Astropy | Astropy Collaboration 2022, ApJ 935, 167, https://doi.org/10.3847/1538-4357/ac7c74 |
| astroquery | Ginsburg et al. 2019, AJ 157, 98, https://doi.org/10.3847/1538-3881/aafc33 |
| NumPy | Harris et al. 2020, Nature 585, 357, https://doi.org/10.1038/s41586-020-2649-2 |
| SciPy | Virtanen et al. 2020, Nature Methods 17, 261, https://doi.org/10.1038/s41592-019-0686-2 |
| FastAPI, Pydantic, Uvicorn, Requests, certifi | The data service |
| React, Vite, TypeScript, Zod, Recharts | The web app |
| Playwright, Vitest, pytest | Checks and tests |
| AWS Lambda Web Adapter | https://github.com/awslabs/aws-lambda-web-adapter, to stream the service's answers from AWS Lambda |
| edge-tts | https://github.com/rany2/edge-tts, the synthetic narration voice of the demo video (Microsoft neural text-to-speech) |
| FFmpeg | https://ffmpeg.org/, to assemble the demo video |
| IBM Plex Sans and Mono | SIL Open Font License, through Fontsource |
| Affinity | https://www.affinity.studio/, the team's visual composition and design of the identity |

Hosting: Vercel (the site) and AWS Lambda (the data service).

## The team's own assets

The SEDNA logo, animations and brand guide (made by the team with Codex's help, see `AI_USAGE.md`), the start page images (rendered from SPHEREx data by `web/scripts/render-landing.py`) and the demo video (recorded from the site by `web/scripts/record-demo.mjs`, narrated by a synthetic voice reading the team's script, `web/scripts/narration.json`).
