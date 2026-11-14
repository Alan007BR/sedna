// Coordinate parsing and tangent-plane geometry.
// Code written with AI assistance (Claude); see AI_USAGE.md.

export type Parsed =
  | { kind: "coords"; ra: number; dec: number }
  | { kind: "name"; query: string }
  | { kind: "invalid"; reason: string };

const NUM = "[+\\-\\u2212]?\\d+(?:\\.\\d+)?";

function sexagesimal(text: string): number[] | null {
  const parts = text
    .replace(/−/g, "-")
    .replace(/[hdms°′″'":]/gi, " ")
    .trim()
    .split(/\s+/)
    .map(Number);
  return parts.length >= 1 && parts.length <= 3 && parts.every(Number.isFinite) ? parts : null;
}

function toDegrees(parts: number[], negative: boolean): number {
  const [a, b = 0, c = 0] = parts.map(Math.abs);
  const value = a + b / 60 + c / 3600;
  return negative ? -value : value;
}

/** Accepts "133.795 -7.245", "08:55:10.831 -07:14:42.53", "08h55m10.831s -07d14m42.53s", or an object name. */
export function parseTarget(input: string): Parsed {
  const text = input.trim().replace(/−/g, "-");
  if (!text) return { kind: "invalid", reason: "Type a name or coordinates, for example 133.795 -7.245" };

  const decimal = text.match(new RegExp(`^(${NUM})[\\s,]+(${NUM})$`));
  if (decimal) {
    const ra = Number(decimal[1]);
    const dec = Number(decimal[2]);
    if (ra < 0 || ra >= 360) return { kind: "invalid", reason: "Right Ascension must be between 0 and 360 degrees" };
    if (dec < -90 || dec > 90) return { kind: "invalid", reason: "Declination must be between -90 and +90 degrees" };
    return { kind: "coords", ra, dec };
  }

  const split = text.match(/^(.+?)[\s,]+([+-].+)$/);
  if (split && /\d/.test(split[1]) && /[:hms\s]/.test(split[1])) {
    const raParts = sexagesimal(split[1]);
    const decParts = sexagesimal(split[2].replace(/^[+-]/, ""));
    if (raParts && decParts) {
      const ra = toDegrees(raParts, false) * 15;
      const dec = toDegrees(decParts, split[2].startsWith("-"));
      if (ra >= 360 || raParts[0] >= 24) return { kind: "invalid", reason: "Right Ascension in hours must be below 24" };
      if (Math.abs(dec) > 90) return { kind: "invalid", reason: "Declination must be between -90 and +90 degrees" };
      return { kind: "coords", ra, dec };
    }
  }
  if (/^[\d\s.:+-]+$/.test(text)) return { kind: "invalid", reason: "Could not read these coordinates. Try 133.795 -7.245 or 08:55:10.8 -07:14:42" };
  return { kind: "name", query: text };
}

const RAD = Math.PI / 180;

/** Grid pixel (column, row) of a sky position on a north-up TAN grid; row 0 is south, column 0 is east. */
export function skyToGrid(ra: number, dec: number, center: { ra: number; dec: number }, size: number, scaleArcsec: number) {
  const ra0 = center.ra * RAD;
  const dec0 = center.dec * RAD;
  const a = ra * RAD;
  const d = dec * RAD;
  const cosc = Math.sin(dec0) * Math.sin(d) + Math.cos(dec0) * Math.cos(d) * Math.cos(a - ra0);
  const xi = (Math.cos(d) * Math.sin(a - ra0)) / cosc;
  const eta = (Math.cos(dec0) * Math.sin(d) - Math.sin(dec0) * Math.cos(d) * Math.cos(a - ra0)) / cosc;
  const half = (size - 1) / 2;
  return { x: half - (xi / RAD) * 3600 / scaleArcsec, y: half + (eta / RAD) * 3600 / scaleArcsec };
}

/** Sky position of a grid pixel (small-field approximation, good to well under a pixel for fields below 1 degree). */
export function gridToSky(x: number, y: number, center: { ra: number; dec: number }, size: number, scaleArcsec: number) {
  const half = (size - 1) / 2;
  const dec = center.dec + ((y - half) * scaleArcsec) / 3600;
  const ra = center.ra - ((x - half) * scaleArcsec) / 3600 / Math.cos(center.dec * RAD);
  return { ra: (ra + 360) % 360, dec };
}

export function formatSexagesimal(ra: number, dec: number): string {
  const h = ra / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  const sign = dec < 0 ? "−" : "+";
  const ad = Math.abs(dec);
  const dd = Math.floor(ad);
  const dm = Math.floor((ad - dd) * 60);
  const ds = ((ad - dd) * 60 - dm) * 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(hh)}:${pad(mm)}:${ss.toFixed(2).padStart(5, "0")} ${sign}${pad(dd)}:${pad(dm)}:${ds.toFixed(1).padStart(4, "0")}`;
}

/** Decimal year of an MJD. */
export function mjdToYear(mjd: number): number {
  return 2000 + (mjd - 51544.5) / 365.25;
}
