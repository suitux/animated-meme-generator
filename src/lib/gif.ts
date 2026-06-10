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

let cache: Promise<RabbitGif> | null = null;

/** Decode the rabbit GIF once, accumulating partial patches + disposal into full frames. */
export function loadRabbitFrames(src = "/vibe-rabbit.gif"): Promise<RabbitGif> {
  if (cache) return cache;
  cache = (async () => {
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
  return cache;
}

/** Draw an uploaded image onto a square ctx using cover/contain. */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap | HTMLImageElement,
  size: number,
  fit: FitMode,
  bgColor: string
) {
  const iw = img.width;
  const ih = img.height;

  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // stretch = fill the square exactly, ignoring aspect ratio
  if (fit === "stretch") {
    ctx.drawImage(img, 0, 0, size, size);
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

  ctx.drawImage(img, dx, dy, dw, dh);
}

export interface BuildMemeOptions {
  file: File;
  size: number;
  fit: FitMode;
  bgColor?: string;
  onProgress?: (done: number, total: number) => void;
}

/** Composite the uploaded image behind every rabbit frame and encode an animated GIF. */
export async function buildMeme({
  file,
  size,
  fit,
  bgColor = "#ffffff",
  onProgress,
}: BuildMemeOptions): Promise<Blob> {
  const { GIFEncoder, quantize, applyPalette } = await loadGifenc();
  const rabbit = await loadRabbitFrames();
  const bitmap = await createImageBitmap(file);

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

  for (let i = 0; i < total; i++) {
    const frame = rabbit.frames[i];

    // 1. background
    drawBackground(octx, bitmap, size, fit, bgColor);

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

    onProgress?.(i + 1, total);
    // yield so the UI can paint the progress bar
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  encoder.finish();
  bitmap.close?.();
  return new Blob([encoder.bytes()], { type: "image/gif" });
}
