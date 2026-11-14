// The one door to the SEDNA data service. Screens and clients never know which side answered.
//
// VITE_DATA_SOURCE selects it (nothing else reads the variable):
//   live  every request goes to the service;
//   demo  every request is answered from web/public/demo, recorded from the live service by
//         scripts/bake-demo.mjs, so the site runs with no service at all;
//   auto  (default) the service if it answers at start-up, otherwise the prepared cases; a live
//         request that fails on the network also falls back to its prepared answer when there is one.
// Code written with AI assistance (Claude); see AI_USAGE.md.
import { ApiError } from "./api-error";

export type DataSource = "live" | "demo" | "auto";
export type Active = "live" | "demo";

const CONFIGURED: DataSource = (["live", "demo", "auto"] as const).find((s) => s === import.meta.env.VITE_DATA_SOURCE) ?? "auto";
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
const DEMO_BASE = `${import.meta.env.BASE_URL}demo/`;

type Manifest = {
  schemaVersion: number;
  release: string;
  dataThrough: string;
  cases: { id: string; label: string; url: string }[];
  responses: Record<string, string>;
};

let manifestPromise: Promise<Manifest | null> | null = null;
let livePromise: Promise<boolean> | null = null;
let active: Active | null = CONFIGURED === "auto" ? null : CONFIGURED;
const listeners = new Set<(a: Active) => void>();

function setActive(a: Active) {
  if (active === a) return;
  active = a;
  listeners.forEach((l) => l(a));
}

/** Which side is answering, as soon as it is known, and whenever it changes. */
export function onSourceChange(listener: (a: Active) => void): () => void {
  listeners.add(listener);
  if (active) listener(active);
  return () => listeners.delete(listener);
}

export function loadManifest(): Promise<Manifest | null> {
  manifestPromise ??= fetch(`${DEMO_BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .catch(() => null);
  return manifestPromise;
}

/** The prepared cases, for the start page and for the message shown when a view is not among them. */
export async function preparedCases() {
  return (await loadManifest())?.cases ?? [];
}

function liveAvailable(): Promise<boolean> {
  livePromise ??= (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
      return r.ok && (r.headers.get("content-type") ?? "").includes("json");
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  })();
  return livePromise;
}

async function fromLive(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { signal });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("SERVICE_UNREACHABLE", "The SEDNA data service did not answer. Try again in a moment.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    throw new ApiError(detail?.code ?? (response.status >= 500 ? "SERVICE_UNREACHABLE" : "ERROR"), detail?.message ?? `The data service returned an error (${response.status}).`);
  }
  return body;
}

async function fromDemo(path: string, signal?: AbortSignal): Promise<unknown> {
  const manifest = await loadManifest();
  const file = manifest?.responses[path];
  if (!manifest || !file) {
    const names = manifest ? manifest.cases.map((c) => c.label).join(", ") : "none";
    throw new ApiError("NOT_PREPARED", `The data service is offline and this view is not among the prepared cases. Prepared: ${names}.`);
  }
  const r = await fetch(`${DEMO_BASE}${file}`, { signal });
  if (!r.ok) throw new ApiError("NOT_PREPARED", "A prepared case is missing from this build.");
  return r.json();
}

/** GET a service path such as "/api/stack?ra=...". Resolves to the parsed JSON body. */
export async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  if (CONFIGURED === "demo") return fromDemo(path, signal);
  if (CONFIGURED === "live") return fromLive(path, signal);
  if (!(await liveAvailable())) {
    setActive("demo");
    return fromDemo(path, signal);
  }
  setActive("live");
  try {
    return await fromLive(path, signal);
  } catch (err) {
    if (err instanceof ApiError && err.code === "SERVICE_UNREACHABLE" && (await loadManifest())?.responses[path]) {
      setActive("demo");
      return fromDemo(path, signal);
    }
    throw err;
  }
}
