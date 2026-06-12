// gifuct-js and gifenc are CJS libs that only run in the browser (canvas/DOM).
// Import them lazily so they never resolve during Astro's server-side render.
// Resolve named exports across the two module shapes these CJS libs produce:
//  - ESM build (browser/Vite): named exports live on the namespace `m`.
//  - CJS build (Node interop): the real exports object hides under `m.default`.
// gifenc's ESM `default` is the GIFEncoder function itself, so we must check a
// known named export first and only fall back to `m.default` as a namespace.
async function loadGifuct() {
  const m: any = await import("gifuct-js");
  const lib = m.parseGIF ? m : m.default ?? m;
  return { parseGIF: lib.parseGIF, decompressFrames: lib.decompressFrames };
}

async function loadGifenc() {
  const m: any = await import("gifenc");
  const lib = m.GIFEncoder ? m : m.default ?? m;
  return {
    GIFEncoder: lib.GIFEncoder,
    quantize: lib.quantize,
    applyPalette: lib.applyPalette,
  };
}

export type FitMode = "cover" | "contain" | "stretch";

/** Overlay characters the user can pick. `src` points at a GIF in /public. */
export type Character = "rabbit" | "cat";

export const CHARACTERS: Record<
  Character,
  { label: string; emoji: string; src: string }
> = {
  rabbit: { label: "Bunny", emoji: "🐰", src: "/vibe-rabbit.gif" },
  cat: { label: "Cat", emoji: "🐱", src: "/vibe-cat.gif" },
};

export interface RabbitFrame {
  /** Full-size RGBA pixels for this frame (gifWidth * gifHeight * 4). */
  data: Uint8ClampedArray;
  /** Frame delay in milliseconds. */
  delay: number;
}

export interface RabbitGif {
  width: number;
  height: number;
  frames: RabbitFrame[];
}

const cache = new Map<string, Promise<RabbitGif>>();

/** Decode an overlay GIF once (per src), accumulating partial patches + disposal into full frames. */
export function loadRabbitFrames(src = "/vibe-rabbit.gif"): Promise<RabbitGif> {
  const cached = cache.get(src);
  if (cached) return cached;
  const promise = (async () => {
    const { parseGIF, decompressFrames } = await loadGifuct();
    const buf = await fetch(src).then((r) => r.arrayBuffer());
    const gif = parseGIF(buf);
    const raw = decompressFrames(gif, true);

    const width = gif.lsd.width;
    const height = gif.lsd.height;

    const stage = document.createElement("canvas");
    stage.width = width;
    stage.height = height;
    const sctx = stage.getContext("2d", { willReadFrequently: true })!;

    const patchCanvas = document.createElement("canvas");
    const pctx = patchCanvas.getContext("2d")!;

    const frames: RabbitFrame[] = [];
    let saved: ImageData | null = null;

    for (const frame of raw) {
      const { width: fw, height: fh, top, left } = frame.dims;

      // disposal 3 = restore-to-previous: snapshot before drawing
      if (frame.disposalType === 3) {
        saved = sctx.getImageData(0, 0, width, height);
      }

      patchCanvas.width = fw;
      patchCanvas.height = fh;
      const patchData = pctx.createImageData(fw, fh);
      patchData.data.set(frame.patch);
      pctx.putImageData(patchData, 0, 0);
      sctx.drawImage(patchCanvas, left, top);

      // capture the composited full frame
      const full = sctx.getImageData(0, 0, width, height);
      frames.push({
        data: full.data,
        delay: frame.delay && frame.delay > 0 ? frame.delay : 100,
      });

      // apply disposal for the next frame
      if (frame.disposalType === 2) {
        sctx.clearRect(left, top, fw, fh);
      } else if (frame.disposalType === 3 && saved) {
        sctx.putImageData(saved, 0, 0);
      }
    }

    return { width, height, frames };
  })();
  cache.set(src, promise);
  return promise;
}

/** Draw a background source (image/gif-frame/video) onto a square ctx using the fit mode. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  iw: number,
  ih: number,
  size: number,
  fit: FitMode,
  bgColor: string
) {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // stretch = fill the square exactly, ignoring aspect ratio
  if (fit === "stretch" || !iw || !ih) {
    ctx.drawImage(src, 0, 0, size, size);
    return;
  }

  const scale =
    fit === "cover"
      ? Math.max(size / iw, size / ih)
      : Math.min(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (size - dw) / 2;
  const dy = (size - dh) / 2;

  ctx.drawImage(src, dx, dy, dw, dh);
}

/**
 * A background to composite behind the bunny. May be static (image) or
 * animated (gif/video); `frameAt(timeMs)` returns the source to draw for a
 * given moment in the bunny's loop. `duration` is null for static sources.
 */
interface Background {
  width: number;
  height: number;
  duration: number | null;
  frameAt(timeMs: number): Promise<CanvasImageSource> | CanvasImageSource;
  cleanup(): void;
}

/** Decode an animated GIF (uploaded as background) into per-frame canvases. */
async function decodeGifBackground(file: Blob): Promise<Background> {
  const { parseGIF, decompressFrames } = await loadGifuct();
  const buf = await file.arrayBuffer();
  const gif = parseGIF(buf);
  const raw = decompressFrames(gif, true);

  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const stage = document.createElement("canvas");
  stage.width = width;
  stage.height = height;
  const sctx = stage.getContext("2d", { willReadFrequently: true })!;
  const patchCanvas = document.createElement("canvas");
  const pctx = patchCanvas.getContext("2d")!;

  const frames: { canvas: HTMLCanvasElement; start: number }[] = [];
  let saved: ImageData | null = null;
  let elapsed = 0;

  for (const frame of raw) {
    const { width: fw, height: fh, top, left } = frame.dims;
    if (frame.disposalType === 3) saved = sctx.getImageData(0, 0, width, height);

    patchCanvas.width = fw;
    patchCanvas.height = fh;
    const pd = pctx.createImageData(fw, fh);
    pd.data.set(frame.patch);
    pctx.putImageData(pd, 0, 0);
    sctx.drawImage(patchCanvas, left, top);

    // snapshot the composited frame to its own canvas
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.drawImage(stage, 0, 0);
    frames.push({ canvas: c, start: elapsed });
    elapsed += frame.delay && frame.delay > 0 ? frame.delay : 100;

    if (frame.disposalType === 2) sctx.clearRect(left, top, fw, fh);
    else if (frame.disposalType === 3 && saved) sctx.putImageData(saved, 0, 0);
  }

  const duration = Math.max(1, elapsed);
  return {
    width,
    height,
    duration,
    frameAt(t) {
      const local = ((t % duration) + duration) % duration;
      // last frame whose start <= local
      let lo = 0;
      for (let i = 0; i < frames.length; i++) {
        if (frames[i].start <= local) lo = i;
        else break;
      }
      return frames[lo].canvas;
    },
    cleanup() {},
  };
}

/** Load an uploaded video as a background, seeking per frame. */
async function decodeVideoBackground(file: Blob): Promise<Background> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("video decode failed"));
  });

  const duration = Math.max(1, (video.duration || 0) * 1000);

  function seek(timeSec: number) {
    return new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
      video.currentTime = timeSec;
    });
  }

  return {
    width: video.videoWidth,
    height: video.videoHeight,
    duration,
    async frameAt(t) {
      const sec = ((t % duration) + duration) % duration / 1000;
      await seek(Math.min(sec, Math.max(0, video.duration - 0.001)));
      return video;
    },
    cleanup() {
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      video.load();
    },
  };
}

/** Build the right Background for a source blob (image / gif / video). */
async function prepareBackground(file: Blob): Promise<Background> {
  if (file.type.startsWith("video/")) return decodeVideoBackground(file);
  if (file.type === "image/gif") return decodeGifBackground(file);

  const bitmap = await createImageBitmap(file);
  return {
    width: bitmap.width,
    height: bitmap.height,
    duration: null,
    frameAt: () => bitmap,
    cleanup: () => bitmap.close?.(),
  };
}

/**
 * Fetch a background from a URL into a blob so it flows through the same
 * pipeline as an upload. Cross-origin hosts must send permissive CORS headers,
 * otherwise the fetch (and later canvas read) is blocked by the browser.
 */
export async function fetchBackground(url: string): Promise<Blob> {
  let res: Response;
  try {
    res = await fetch(url, { mode: "cors" });
  } catch {
    throw new Error(
      "Couldn't fetch that URL (network or CORS blocked). Try a direct image/video link."
    );
  }
  if (!res.ok) throw new Error(`The URL returned ${res.status}.`);

  let blob = await res.blob();
  // Some hosts omit a useful Content-Type; guess from the extension.
  if (!blob.type || blob.type === "application/octet-stream") {
    const ext = new URL(url, location.href).pathname.split(".").pop()?.toLowerCase();
    const guess: Record<string, string> = {
      gif: "image/gif",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      mp4: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
    };
    if (ext && guess[ext]) blob = blob.slice(0, blob.size, guess[ext]);
  }
  if (!blob.type.startsWith("image/") && !blob.type.startsWith("video/")) {
    throw new Error("That link isn't an image or video.");
  }
  return blob;
}

export interface BuildMemeOptions {
  /** Background source: an uploaded file or a blob fetched from a URL. */
  source: Blob;
  size: number;
  fit: FitMode;
  bgColor?: string;
  /** Which overlay character to composite on top. Defaults to the bunny. */
  character?: Character;
  onProgress?: (done: number, total: number) => void;
}

/** Composite the uploaded image behind every overlay frame and encode an animated GIF. */
export async function buildMeme({
  source,
  size,
  fit,
  bgColor = "#ffffff",
  character = "rabbit",
  onProgress,
}: BuildMemeOptions): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const rabbit = await loadRabbitFrames(CHARACTERS[character].src);
  const bg = await prepareBackground(source);

  // canvas holding the current rabbit frame at native gif size
  const rabbitCanvas = document.createElement("canvas");
  rabbitCanvas.width = rabbit.width;
  rabbitCanvas.height = rabbit.height;
  const rctx = rabbitCanvas.getContext("2d")!;

  // output canvas at target size
  const out = document.createElement("canvas");
  out.width = size;
  out.height = size;
  const octx = out.getContext("2d", { willReadFrequently: true })!;

  const encoder = GIFEncoder();
  const total = rabbit.frames.length;
  let elapsed = 0; // ms into the bunny loop, used to sample animated backgrounds

  try {
    for (let i = 0; i < total; i++) {
      const frame = rabbit.frames[i];

      // 1. background sampled at this point in the loop
      const src = await bg.frameAt(elapsed);
      drawBackground(octx, src, bg.width, bg.height, size, fit, bgColor);

      // 2. rabbit frame, crisp-scaled from native size to target
      const fd = rctx.createImageData(rabbit.width, rabbit.height);
      fd.data.set(frame.data);
      rctx.putImageData(fd, 0, 0);
      octx.imageSmoothingEnabled = false;
      octx.drawImage(rabbitCanvas, 0, 0, size, size);

      // 3. quantize + write
      const { data } = octx.getImageData(0, 0, size, size);
      const palette = quantize(data, 256);
      const index = applyPalette(data, palette);
      encoder.writeFrame(index, size, size, { palette, delay: frame.delay });

      elapsed += frame.delay;
      onProgress?.(i + 1, total);
      // yield so the UI can paint the progress bar
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    bg.cleanup();
  }

  encoder.finish();
  return new Blob([encoder.bytes()], { type: "image/gif" });
}
