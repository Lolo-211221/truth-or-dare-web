# Truth or Dare — web rooms

Browser game: create a room (6-character code). Two modes:

- **Shared deck (classic):** everyone writes truths & dares, the server shuffles, then cards play **one at a time** (round robin).
- **Pick & write:** each turn, the active player chooses **Truth or Dare**, then **one random other player** has time to write that prompt for them; then the active player answers or completes the dare.

Truths use a typed answer (with a shared read delay); dares use **I finished the dare**.

## Local development

From the repo root:

```bash
npm install
npm run dev
```

- Client: [http://localhost:5173](http://localhost:5173) (Vite proxies WebSocket traffic to the API)
- Server: [http://localhost:3001](http://localhost:3001)

Open two browsers (or a normal window + private window) to test create/join and play.

### Friends on the same Wi‑Fi (local dev)

`http://localhost:5173` only works **on your computer**. Other people must use your machine’s **LAN address**:

1. Start the app: `npm run dev` (Vite is configured with `host: true` so it listens on the network).
2. On your Mac, find your IP: **System Settings → Network → Wi‑Fi → Details → IP address**, or run `ipconfig getifaddr en0` in Terminal (sometimes `en1` on newer Macs).
3. On their phone or laptop (same Wi‑Fi), open **`http://THAT_IP:5173`** (example: `http://192.168.1.42:5173`).
4. Share the **room link** from the lobby — it will use that same host so Socket.IO stays on the same origin.

If it still fails, check **Firewall** (macOS may block incoming connections to Node). For **guest Wi‑Fi** or **AP isolation**, devices cannot talk to each other; use a tunnel or deploy instead.

### Friends not on your network

`npm run dev` is not on the public internet. Use **production deploy** (section below) or a tunnel (e.g. [ngrok](https://ngrok.com/) pointing at port **5173** for dev, or **3001** if you run `npm start` and expose that port).

## Production build

```bash
npm run build
npm start
```

This builds the React app into `client/dist`, then runs `node server/dist/index.js`, which serves the static files and Socket.IO on the **same port** (default **3001**, or **`PORT`** from the environment).

## Deploy (Railway, Fly.io, Render, etc.)

1. **Root directory:** repository root (where the root `package.json` lives).
2. **Install + build:** `npm ci` (or `npm install`) then **`npm run build`** — this must produce **`client/dist`**. The repo includes [`nixpacks.toml`](./nixpacks.toml) so Nixpacks-based hosts run that automatically.
3. **Start command:** `npm start`
4. **`PORT`:** leave unset on Railway/Render; the platform injects it. The server listens on **`0.0.0.0`** so the proxy can reach the container.
5. **Health check (optional):** use path **`/health`** (returns plain `ok`).
6. **WebSockets:** same origin as the site; Socket.IO path is **`/socket.io`**.

If the site shows **“Application failed to respond”** on Railway, it was often **binding to localhost only** (fixed in server code) or **skipping the client build** so nothing useful is served — check deploy logs for `Static UI: ...`.

**Truth answer read time:** after someone submits a Truth, the next card waits **10 seconds** by default so everyone can read. Override on the server with env **`TRUTH_ANSWER_DISPLAY_MS`** (milliseconds, clamped between 3000 and 120000).

**Pick & write author timer:** default **90 seconds** to write the prompt. Override with **`AUTHOR_PROMPT_MS`** (clamped between 15000 and 300000).

No separate static host is required: one Node process serves both the SPA and real-time traffic.

### Netlify (frontend only)

Netlify is great for the **Vite build** (HTML/JS/CSS), but it **cannot** host this app’s **Socket.IO** game server (you need a long‑lived Node process with WebSockets).

**Typical setup:**

1. Deploy the **API** somewhere that runs Node 24/7 with WebSockets (Railway, Render, Fly.io, a VPS, etc.): use `npm run build` + `npm start` there, or build only the server workspace if you prefer.
2. Connect the **same Git repo** to Netlify (this repo includes [`netlify.toml`](./netlify.toml)).
3. In Netlify → **Site configuration → Environment variables**, add:
   - **`VITE_SOCKET_URL`** = your API’s public URL, e.g. `https://truth-or-dare-api.up.railway.app` (**no** trailing slash).

The client will connect Socket.IO to that host; the server already allows cross‑origin access (`cors` / Socket.IO `origin: true`).

If you only deploy to Netlify and **skip** step 1–3, the UI will load but **rooms will not work**.

## Limits (MVP)

- 2 truths and 2 dares per player; 200 characters per card; 20 players max per room.
- Rooms live in **memory** only (lost on restart).
- Simple per-IP rate limiting on create/join.
