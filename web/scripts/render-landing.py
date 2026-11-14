"""Images for the start page, rendered from real SPHEREx data with the app's own asinh stretch.

Reads the prepared cases in web/public/demo and, for the full-bleed background, a 30 arcmin stack from the
data service. Writes web/public/landing/*.png|jpg and web/src/lib/landing-film.json.

    .venv/Scripts/python web/scripts/render-landing.py [service url]   (default http://127.0.0.1:8000)

Code written with AI assistance (Claude); see AI_USAGE.md.
"""
import base64
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

WEB = Path(__file__).resolve().parent.parent
API = WEB / "public" / "demo" / "api"
OUT = WEB / "public" / "landing"
FILM_JSON = WEB / "src" / "lib" / "landing-film.json"
SERVICE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
ICE = (143, 182, 201)  # --ice
NEG, ZERO, POS = np.array([74, 144, 226]), np.array([17, 19, 23]), np.array([232, 131, 58])  # lib/render.ts

INDEX = json.loads((WEB / "public" / "demo" / "index.json").read_text())["responses"]


def prepared(path):
    return json.loads((WEB / "public" / "demo" / INDEX[path]).read_text())


def dec64(s):
    return np.frombuffer(base64.b64decode(s), dtype="<f4")


def frames_of(stack):
    n = stack["grid"]["size"]
    return {(f["visit"], f["detector"]): dec64(f["data"]).reshape(n, n) for f in stack["frames"]}, n


def mean_of(fr, dets):
    ims = [im for (v, d), im in fr.items() if d in dets]
    return np.nanmean(np.stack(ims), axis=0)


def limits(im, lo_p=0.25, hi_p=0.995):
    v = im[np.isfinite(im)]
    return float(np.quantile(v, lo_p)), float(np.quantile(v, hi_p))


def stretch(im, lo, hi, soft=4.0):
    t = np.clip((np.nan_to_num(im, nan=lo) - lo) / (hi - lo), 0, 1)
    return np.arcsinh(soft * t) / np.arcsinh(soft)


def screen(a):  # the grid's row 0 is south: flip for the screen
    return a[::-1]


def gray(a, scale):
    img = Image.fromarray((screen(a) * 255).astype(np.uint8), "L")
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST).convert("RGB")


def crop_center(img, w, h=None):
    h = h or w
    W, H = img.size
    return img.crop(((W - w) // 2, (H - h) // 2, (W + w) // 2, (H + h) // 2))


def ring(img, x, y, r):
    ImageDraw.Draw(img).ellipse([x - r, y - r, x + r, y + r], outline=ICE, width=2)


OUT.mkdir(parents=True, exist_ok=True)

# 1. Makemake crossing its field: one single exposure per pass (shortest wavelength), ice ring at the SkyBoT position
film = prepared("/api/film?ra=199.94124&dec=21.48776&fov=6&visit=0")
mover = next(m for m in prepared("/api/movers?ra=199.94124&dec=21.48776&fov=6")["movers"] if m["name"] == "Makemake")
n, pix = film["grid"]["size"], film["grid"]["pixelScaleArcsec"]
cube = dec64(film["data"]).reshape(len(film["frames"]), n, n)
ra0, de0 = film["center"]["ra"], film["center"]["dec"]
track = mover["track"]
t_in, t_out = track[0]["mjd"], track[-1]["mjd"]
groups = []
for i, f in enumerate(film["frames"]):
    if not t_in <= f["mjd"] <= t_out:
        continue
    if groups and f["mjd"] - film["frames"][groups[-1][-1]]["mjd"] <= 1 / 24:
        groups[-1].append(i)
    else:
        groups.append([i])
pick = [min(g, key=lambda i: (film["frames"][i]["detector"], film["frames"][i]["mjd"])) for g in groups]
S, c = 8, (n - 1) / 2
tiles, meta = [], []
for i in pick:
    f = film["frames"][i]
    ra = np.interp(f["mjd"], [p["mjd"] for p in track], [p["ra"] for p in track])
    de = np.interp(f["mjd"], [p["mjd"] for p in track], [p["dec"] for p in track])
    col = c - (ra - ra0) * np.cos(np.radians(de0)) * 3600 / pix
    row = (n - 1) - (c + (de - de0) * 3600 / pix)
    tile = gray(stretch(cube[i], -0.8, 12.0), S)  # each exposure is divided by its own noise: one fixed stretch
    ring(tile, (col + 0.5) * S, (row + 0.5) * S, 26)
    tiles.append(tile)
    meta.append({"date": f["date"], "mjd": round(f["mjd"], 5), "detector": f["detector"], "obsid": f["obsid"]})
sprite = Image.new("RGB", (n * S * len(tiles), n * S))
for k, t in enumerate(tiles):
    sprite.paste(t, (k * n * S, 0))
sprite.save(OUT / "makemake-film.png", optimize=True)
FILM_JSON.write_text(json.dumps({
    "body": mover["name"], "number": mover["number"], "distanceAu": mover["distanceAu"], "vMag": mover["vMag"],
    "fovArcmin": film["grid"]["size"] * pix / 60, "sprite": "landing/makemake-film.png", "frames": meta,
}, indent=1) + "\n")

# 2. The full-bleed background: 30' around Barnard's Star, all visits, detectors 1-2 / 3-4 / 5-6 as blue / green / red
url = f"{SERVICE}/api/stack?ra=269.44629&dec=4.76792&fov=30"
with urllib.request.urlopen(url, timeout=600) as r:
    big = json.loads(r.read())
fr, nb = frames_of(big)
chans = []
for dets in ((5, 6), (3, 4), (1, 2)):
    m = mean_of(fr, dets)
    lo, hi = limits(m, 0.30, 0.9985)
    chans.append(stretch(m, lo, hi, 6.0))
rgb = np.stack([screen(ch) for ch in chans], axis=-1)
lum = rgb.mean(axis=-1, keepdims=True)
rgb = lum + 0.55 * (rgb - lum)  # restrained colour
sky = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB").resize((nb * 6, nb * 6), Image.LANCZOS)
sky.save(OUT / "sky-barnard-30.jpg", quality=86)

# 3. The missions and Sedna
bar, _ = frames_of(prepared("/api/stack?ra=269.44629&dec=4.76792&fov=6"))
last = max(v for v, _ in bar)
diff = bar[(last, 2)] - bar[(0, 2)]
lim = float(np.quantile(np.abs(diff[np.isfinite(diff)]), 0.995)) or 1
t = np.clip(np.nan_to_num(diff) / lim, -1, 1)[..., None]
walk = Image.fromarray(screen(np.where(t < 0, ZERO + (NEG - ZERO) * -t, ZERO + (POS - ZERO) * t)).astype(np.uint8), "RGB")
crop_center(walk.resize((walk.width * 8, walk.height * 8), Image.NEAREST), 288).save(OUT / "mission-walk.png", optimize=True)

wise, _ = frames_of(prepared("/api/stack?ra=133.76012&dec=-7.24224&fov=6"))
halves = []
for det in (1, 6):
    m = mean_of(wise, (det,))
    halves.append(crop_center(gray(stretch(m, *limits(m)), 8), 288).crop((72, 0, 216, 288)))
pair = Image.new("RGB", (288, 288))
pair.paste(halves[0], (0, 0))
pair.paste(halves[1], (144, 0))
ImageDraw.Draw(pair).line([(144, 0), (144, 288)], fill=(2, 3, 5), width=2)
pair.save(OUT / "mission-infrared.png", optimize=True)

mk, _ = frames_of(prepared("/api/stack?ra=199.94124&dec=21.48776&fov=6"))
crop_center(gray(stretch(mk[(0, 3)], *limits(mk[(0, 3)])), 8), 288).save(OUT / "mission-distance.png", optimize=True)

sed = prepared("/api/follow?body=sedna")
st = dec64(sed["combined"]["stack"]).reshape(sed["stampSize"], sed["stampSize"])
img = Image.fromarray((screen(stretch(st, *limits(st, 0.20, 0.999))) * 255).astype(np.uint8), "L")
img = img.resize((img.width * 14, img.height * 14), Image.NEAREST).convert("RGB")
ring(img, img.width / 2, img.height / 2, 34)
img.save(OUT / "sedna-stack.png", optimize=True)

# 4. The five challenge targets: a strip of sky centred on each, in the detector its prepared case opens on
CASES = {"barnard": ("269.44629&dec=4.76792", 2), "wise0855": ("133.76012&dec=-7.24224", 6), "epsindib": ("331.09645&dec=-56.80060", 2),
         "rwaur": ("76.95660&dec=30.40129", 2), "rdra": ("248.16724&dec=66.75502", 2)}
W, H = 36, 14
for name, (pos, det) in CASES.items():
    st = prepared(f"/api/stack?ra={pos}&fov=6")
    m = screen(mean_of(frames_of(st)[0], (det,)))
    k = st["grid"]["size"] // 2
    cut = m[k - H // 2: k + H // 2, k - W // 2: k + W // 2]
    lo, hi = limits(cut, 0.25, 0.997)
    yy, xx = np.mgrid[0:H, 0:W]
    cut = np.where(np.isnan(cut) & (np.hypot(yy - H / 2 + 0.5, xx - W / 2 + 0.5) < 3), hi, cut)  # a saturated core is bright, not empty
    img = Image.fromarray((stretch(cut, lo, hi) * 255).astype(np.uint8), "L").resize((W * S, H * S), Image.NEAREST).convert("RGB")
    ring(img, W * S / 2, H * S / 2, 30)
    img.save(OUT / f"target-{name}.png", optimize=True)

print(f"{len(meta)} film frames, background {sky.size[0]} px, written to {OUT}")
