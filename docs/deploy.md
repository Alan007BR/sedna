# Deploying SEDNA

SEDNA runs as two independent parts, so a problem with one never takes the other down:

| Part | Where | What it serves |
| --- | --- | --- |
| Site | Vercel (Hobby plan), project `sednaspace`, at https://sednaspace.earth and https://sednaspace.vercel.app | The web app and every prepared case (`web/public/demo`) as static files |
| Data service | AWS Lambda, function `sedna-api` in `us-east-2`, behind a public function URL | Live reads of any position from the SPHEREx bucket |

## How the two parts meet

The site is built with `VITE_API_BASE` set to the function URL. In the default `auto` mode (`web/src/lib/transport.ts`):

- a prepared case (the five challenge targets, the missions, Sedna, the distance controls) is always answered from its file: instant, available while the service sleeps, and free;
- anything else goes to the service; if the service cannot be reached, the screen says so and lists the prepared cases;
- the site wakes the service in the background when it opens, and waits up to 25 seconds for a cold start before calling it unreachable.

## Data service on AWS Lambda

The service is a container image (`deploy/aws/Dockerfile`): Python 3.12, the service code, the folded sky index (`data/index/compact.npz`) and the wavelength map. The AWS Lambda Web Adapter runs the same uvicorn server as locally and streams responses, so large answers (single exposures of a 15′ field, about 9.5 MB) are not cut at Lambda's 6 MB limit. Lambda's file system is read-only except `/tmp`, so `SEDNA_CACHE_DIR=/tmp/sedna-cache` (see `service/sedna/paths.py`).

Settings: 3008 MB of memory, 300 s timeout, 2 GB of `/tmp`, x86_64. The SPHEREx bucket is in `us-east-1`; this account's organization allows only `us-east-2`, next door, and reading a public AWS Open Data bucket costs the reader nothing.

To deploy or update (AWS CLI v2 logged in with `aws login`, Docker in WSL):

```powershell
powershell -ExecutionPolicy Bypass -File deploy\aws\deploy.ps1
```

The script creates what is missing (image repository, execution role, function, public function URL with streaming) and otherwise updates the image and settings. It prints the function URL and its health check.

## Site on Vercel

From `web/`, with the Vercel CLI logged in:

```sh
npx vercel deploy --prod --build-env VITE_API_BASE=<function url>
```

`web/vercel.json` sets the build, redirects `www.sednaspace.earth` to `sednaspace.earth`, and caches the prepared cases and start page images. The project is not connected to Git on purpose: nothing changes the published site unless someone deploys it.

DNS for `sednaspace.earth` (at Porkbun): `A @ 216.198.79.1`, `A @ 64.29.17.1`, `CNAME www be14c2f12a9aacb8.vercel-dns-017.com`.

## Checks

```sh
cd web
node scripts/check-live.mjs https://sednaspace.earth <function url>   # live service, large responses, no service calls for prepared cases
node scripts/check-demo.mjs <site built with the service unreachable> # every prepared flow offline
```

## Free-tier budget

Measured on this service: exploring a new position with every tool costs about 73 s of CPU and 90 s of wall time. Lambda's always-free allowance (400,000 GB-seconds a month) is about 37 hours at 3 GB, so even 20 judges each exploring several new fields use a few percent of it. Prepared cases cost nothing, since they never reach the service.

Code and text written with AI assistance (Claude); see AI_USAGE.md.
