# Vibe Bunny Telegram Bot — Plan

## Context

The web app composites an uploaded image/gif/video behind an animated rabbit GIF and re-encodes an animated GIF, all **in the browser** (canvas, `createImageBitmap`, `<video>` seeking). Goal: a Telegram bot that does the same so users generate the meme from a chat.

Key shift: a bot runs in **Node** = no DOM/canvas. The compositing logic is portable, but the browser primitives must be swapped for server equivalents. Transport = **webhook** (chosen).

## Reused as-is (already Node-safe)

- **`gifuct-js`** — decode rabbit GIF frames (parse/decompress need no DOM).
- **`gifenc`** — encode output GIF (pure JS).
- The composite + quantize loop from `src/lib/gif.ts` — same algorithm.

## Browser → Node swaps

| Web primitive | Node replacement |
|---|---|
| `document.createElement("canvas")` / ctx | **`@napi-rs/canvas`** (`createCanvas`, `getContext`) |
| `createImageBitmap(blob)` | `loadImage(buffer)` from `@napi-rs/canvas` |
| `<video>` seek-per-frame | **ffmpeg** extracts frames from mp4 (`fluent-ffmpeg` + `ffmpeg-static`) |
| `fetch(url)` (CORS-limited) | server-side `fetch` — **no CORS limit** |
| `URL.createObjectURL` | work with `Buffer` directly |

## Proposed structure (monorepo)

```
vibe-bunny-generator/
  web/                 # current Astro app (move existing src/, public/, configs here)
  bot/                 # new Node service
    src/
      index.ts         # grammY bot + webhook server
      render.ts        # Node port of the composite/encode pipeline
      background.ts    # image / gif / video(ffmpeg) → frame provider
      rabbit.ts        # load + decode resources/vibe-rabbit.gif once at boot
    package.json
    tsconfig.json
  shared/
    composite.ts       # canvas-agnostic core: takes a CanvasFactory + frame providers
  resources/vibe-rabbit.gif   # shared asset (bot reads from disk, no fetch)
```

Rationale: extract the pure algorithm into `shared/composite.ts` parameterized by a tiny canvas interface, so web (`@/lib/gif.ts`) and bot (`bot/src/render.ts`) both call it with their own canvas backend. If a full monorepo refactor is too much, the bot can instead copy the ~120 lines of pipeline and just swap the canvas calls.

## Bot library + transport

- **grammY** (modern, typed) — `npm i grammy`.
- Token from **@BotFather**, stored in env `BOT_TOKEN`.
- **Webhook** (chosen): grammY `webhookCallback` mounted on an HTTP server.
  - Local Node server (e.g. `Bun`/`node:http` or `hono`/`express`) listening on `PORT`.
  - Needs a **public HTTPS URL**. Options: a small VPS behind nginx/Caddy (auto-TLS), or a platform (Fly.io / Render / Railway / Cloudflare Tunnel for dev).
  - Register once: `bot.api.setWebhook("https://<host>/<secret-path>")`.
  - Use a secret path or `secret_token` header to reject forged calls.

## Render pipeline (`render.ts`)

1. **Boot**: read `resources/vibe-rabbit.gif` from disk → `gifuct` decode → accumulate frames (same patch + disposal logic as web) → keep RGBA frames + delays in memory (decode once, reuse for every request).
2. **Background source** from the incoming buffer/url + mime:
   - image → `loadImage(buffer)` → static frame provider.
   - gif → `gifuct` decode → per-frame canvases, sampled by time (port of `decodeGifBackground`).
   - video/mp4 → **ffmpeg**: extract N frames (e.g. fps matched to the 10s/250-frame loop, `-vf fps=25`) to PNGs or piped rawvideo → `loadImage` each → time-sampled provider.
3. **Composite** per rabbit frame at target `size` with `fit` (cover/contain/stretch) — identical to `drawBackground` + crisp upscale of the rabbit.
4. **Encode** with `gifenc` (`quantize` → `applyPalette` → `writeFrame`) → `Buffer`.

## Chat UX (`index.ts`)

- `/start` → welcome + how-to.
- User sends **photo / animation(gif) / video / document(image)** OR a **text URL** → bot:
  1. resolves file via `ctx.getFile()` → download from `https://api.telegram.org/file/bot<token>/<path>` (or fetch the URL).
  2. detect kind from mime/extension.
  3. `await render(...)` → GIF buffer.
  4. reply with the result.
- **Options** via inline keyboard or command args: size (256/512/768/1024), fit (cover/contain/stretch). Default 512 / cover. Keep state per-chat in memory (or a small store).
- Progress: send a "generating… 🐰" placeholder, edit/replace when done (Telegram has no progress bar).

### Telegram GIF caveat
Telegram "GIFs" are **mp4 animations**. To get inline autoplay, convert the final GIF → mp4 with ffmpeg and `sendAnimation`. Without ffmpeg, `sendDocument` with a `.gif` filename works but plays only on tap/download. Decision: if ffmpeg is already a dep (for video input), reuse it to also emit mp4 for nicer playback.

## Dependencies

- `grammy`, `@napi-rs/canvas`, `gifuct-js`, `gifenc`.
- Optional (video + nicer output): `fluent-ffmpeg`, `ffmpeg-static` (bundles a binary, no system install).
- HTTP: `hono` or `express` for the webhook endpoint (or grammY's built-in adapter).

## Deployment notes

- No longer a static site for the bot part — needs a **long-running Node process** + public HTTPS.
- Env: `BOT_TOKEN`, `WEBHOOK_URL`, `PORT`, `WEBHOOK_SECRET`.
- Performance: 250 frames at 1024px is heavier on CPU; cap default size to 512 in chat, allow opt-in to 1024. Decode the rabbit once at boot. Consider a simple queue to avoid parallel heavy renders starving the event loop (offload to a worker thread if needed).
- Security: validate file size/type before rendering; reject huge videos; rate-limit per user.

## Open decisions (resolve before building)

1. Monorepo refactor (extract `shared/`) vs. standalone `bot/` that copies the pipeline.
2. Video support now (adds ffmpeg) or images/gifs first.
3. Hosting target (VPS vs Fly/Render/Railway) — drives webhook URL + TLS setup.
4. Output format: `.gif` document vs mp4 `sendAnimation`.

## Verification (when built)

1. `BOT_TOKEN=… ` run bot, set webhook, confirm `getWebhookInfo` shows no errors.
2. Send a photo → receive animated meme; check rabbit moves + background composited.
3. Send a GIF and an mp4 → animated background tracks the loop.
4. Send a direct image URL → works (no CORS).
5. Try each size/fit option.
6. Load test: a couple of concurrent renders don't block the webhook from acking (Telegram retries on timeout).
