# Hosting the Beacon relay server

The relay server is what lets phones and the desktop Hub reach each other over the internet, get live reports and receive push alerts. It runs from the `server/` folder of this repo. You can host it on **Railway** (steps below) or **Render** (see the last section).

Nothing here needs real secrets in the repo. Set them as variables on the host.

## What you need

- A GitHub account with this repo pushed to it.
- A Railway account (railway.com). Sign in yourself; nobody else can do it for you.
- Pricing and free credits change. Check railway.com/pricing before you start, including what a Volume (for the data) costs.

## Railway, step by step

1. **Create the project.** In Railway, choose *New Project*, then *Deploy from GitHub repo*, and pick this repo. Railway will ask for a service.
2. **Set the Root Directory to `server`.** Open the service's settings and set the root directory to `server`. This makes Railway build the server, not the whole repo. The Node version comes from `server/.node-version` (24), and `server/railway.json` sets the start command (`npm start`) and the health check (`/healthz`).
3. **Add a Volume at `/data`.** In the service, add a Volume and set its mount path to `/data`. This is where the database, uploaded photos and the server's signing key are kept. Without a Volume, everything is lost on every redeploy.
4. **Set the variables.** In the service's Variables tab:
   - `BEACON_DATA` = `/data`
   - `MOD_TOKEN` = a long random string (see below). Moderator pages and endpoints are off without it.
   - Optional: `ANTHROPIC_API_KEY`, for AI pre-screening of photo reports. Without it every report goes to human moderators.
   - Optional: `FIREBASE_SERVICE_ACCOUNT_JSON`, for real push notifications. Paste the whole service-account JSON, or its base64. Without it, pushes are only logged.

   To make a long random `MOD_TOKEN`, run `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` on your computer and paste the output. Keep it secret.
5. **Generate a public domain.** In the service's networking settings, generate a domain. Railway serves it over HTTPS.
6. **Check it works.** Open `https://<your-domain>/healthz` in a browser. You should see `{"ok":true,"uptime":...,"version":"1.0.0"}`. If you see an error, open the deploy logs. The log prints a warning if `BEACON_DATA` is not `/data` on Railway.
7. **Point the apps at it.**
   - Phone: Beacon app, *Settings*, *Server*. Enter `https://<your-domain>`.
   - Desktop Hub: *Connections*, *Phones*, *Relay server*. Enter `https://<your-domain>`, press *Save relay*, then *Check*.

## Variables reference

| Variable | Needed | Purpose |
|---|---|---|
| `BEACON_DATA` | yes, `/data` | Where the database, media and server key live. Must be the Volume. |
| `MOD_TOKEN` | recommended | Unlocks `/mod` and the moderator API. Use a long random value. |
| `ANTHROPIC_API_KEY` | optional | AI pre-screening of reports. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional | Real push notifications (JSON or base64). |
| `PORT` | no | Railway sets it. Do not change it. |

## What is stored, and for how long

- **On the Volume:** members and family links, the database, uploaded report photos, and `server-key.json` (the server's signing key).
- **Mail between hubs and phones:** the server keeps only opaque encrypted blobs. Mail older than 24 hours is dropped when the recipient next fetches it.
- **Readable by the server owner:** citizen reports, SOS calls, board posts, family locations and push tokens. Only the blobs in mail are encrypted end to end. Whoever runs the server can read everything else. Tell family members that.

## Rotating the server signing key

The server signs official alerts with `server-key.json`. Apps pin its public key. To rotate it, stop the service, delete `server-key.json` from the Volume (or `BEACON_DATA`), and start it again. A new key is created. **Every app then sees a different key and must re-pin it**, so phones and Hubs will refuse the server's signed alerts until they re-pair or re-pin. Do this only when you think the key is compromised.

Without a Volume the key is recreated on every deploy, which has the same effect each time. That is one more reason to attach the Volume.

## Rotating `MOD_TOKEN`

Change the variable and redeploy. Anyone with the old token loses access at once. Moderators need the new one.

## Render

Render can host the server from the same repo with the Blueprint in `render.yaml` at the repo root.

What you need to know first:

- **Persistent disks need a paid instance.** The `disk` in `render.yaml` only works on a paid web service. Free instances have an ephemeral filesystem: everything is lost on each deploy or restart.
- **Free instances spin down when idle**, so the first request after a pause is slow. Use a paid instance for real use.
- You must **sign in to Render and connect GitHub yourself**. Nobody else can do that for you.

Steps:

1. In Render, choose *New*, then *Blueprint*, connect GitHub, and pick this repo. Render reads `render.yaml`.
2. Pick a **paid** plan for the `beacon-server` service. The Blueprint does not pin a plan name; choose one in the dashboard if Render asks.
3. Fill in the secrets Render asks for at creation: `ANTHROPIC_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_JSON`, if you use them. `MOD_TOKEN` is generated for you; open the service's environment page to read it. `BEACON_DATA` is `/data`, and the disk named `data` is mounted there.
4. Wait for the deploy, then open `https://<your-service>.onrender.com/healthz`.
5. Point the phone and the desktop Hub at that address, as in the Railway steps.

Things this guide does not confirm: the exact Render dashboard labels and the plan names, and whether `NODE_VERSION` in `render.yaml` is honoured (the `.node-version` file in `server/` also pins Node 24). Check Render's Blueprint docs if a step does not match the screen.
