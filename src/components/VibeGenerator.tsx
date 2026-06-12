import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  buildMeme,
  fetchBackground,
  CHARACTERS,
  type FitMode,
  type Character,
} from "@/lib/gif";

const SIZES = [112, 256, 512, 768, 1024];
const CHARACTER_KEYS = Object.keys(CHARACTERS) as Character[];

export default function VibeGenerator() {
  const [source, setSource] = React.useState<Blob | null>(null);
  const [sourceName, setSourceName] = React.useState("");
  const [bgUrl, setBgUrl] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [loadingUrl, setLoadingUrl] = React.useState(false);
  const [size, setSize] = React.useState(512);
  const [character, setCharacter] = React.useState<Character>("rabbit");
  const [fit, setFit] = React.useState<FitMode>("cover");
  const [bgColor, setBgColor] = React.useState("#ffffff");
  const [dragging, setDragging] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const isVideo = !!source && source.type.startsWith("video/");

  function useSource(blob: Blob, name: string) {
    setError(null);
    setResultUrl(null);
    setSource(blob);
    setSourceName(name);
    setBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(blob);
    });
  }

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/") && !f.type.startsWith("video/")) {
      setError("That doesn't look like an image or video 🙈 Upload a PNG/JPG/GIF/MP4.");
      return;
    }
    useSource(f, f.name);
  }

  async function loadFromUrl() {
    const link = url.trim();
    if (!link) return;
    setLoadingUrl(true);
    setError(null);
    try {
      const blob = await fetchBackground(link);
      const name =
        new URL(link, location.href).pathname.split("/").pop() || "link";
      useSource(blob, name);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load that link.");
    } finally {
      setLoadingUrl(false);
    }
  }

  async function generate() {
    if (!source) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setResultUrl(null);
    try {
      const blob = await buildMeme({
        source,
        size,
        fit,
        bgColor,
        character,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      });
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      console.error(e);
      setError("Something blew up generating the GIF 💥 Try another image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-xl p-6 sm:p-8 animate-pop">
      <header className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
          <span className="inline-block animate-float">
            {CHARACTERS[character].emoji}
          </span>{" "}
          <span className="bg-gradient-to-r from-vibe-pink via-vibe-purple to-vibe-cyan bg-clip-text text-transparent">
            Vibe {CHARACTERS[character].label} Generator
          </span>
        </h1>
        <p className="mt-1 text-sm font-semibold text-gray-500">
          Drop your image behind the vibey {CHARACTERS[character].label.toLowerCase()} and download the meme 🎉
        </p>
      </header>

      {/* Dropzone */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pickFile(e.dataTransfer.files?.[0]);
        }}
        className={[
          "cursor-pointer rounded-2xl border-4 border-dashed p-4 text-center transition-colors",
          dragging
            ? "border-vibe-pink bg-vibe-pink/10"
            : "border-vibe-purple/40 hover:border-vibe-purple/70 bg-white/50",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <p className="font-bold text-vibe-purple">
          {sourceName ? `📸 ${sourceName}` : "Drag an image or video, or click"}
        </p>
        <p className="text-xs text-gray-400">PNG · JPG · GIF · WEBP · MP4 · WEBM</p>
      </div>

      {/* Or load from a URL */}
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadFromUrl();
            }}
            placeholder="…or paste an image / video URL"
            className="h-11 flex-1 rounded-2xl border-2 border-vibe-purple/30 bg-white/70 px-4 text-sm font-semibold text-gray-700 outline-none placeholder:text-gray-400 focus:border-vibe-purple"
          />
          <Button
            variant="outline"
            onClick={loadFromUrl}
            disabled={!url.trim() || loadingUrl}
          >
            {loadingUrl ? "Loading…" : "🔗 Load"}
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Link must be a direct file and allow cross-origin (CORS).
        </p>
      </div>

      {/* Live preview */}
      <div className="mt-5 flex justify-center">
        <div className="checker relative h-56 w-56 overflow-hidden rounded-2xl ring-4 ring-white shadow-inner">
          {bgUrl && isVideo ? (
            <video
              src={bgUrl}
              autoPlay
              muted
              loop
              playsInline
              className="absolute inset-0 h-full w-full"
              style={{
                objectFit: fit === "stretch" ? "fill" : fit,
                backgroundColor: bgColor,
              }}
            />
          ) : bgUrl ? (
            <img
              src={bgUrl}
              alt="background"
              className="absolute inset-0 h-full w-full"
              style={{
                objectFit: fit === "stretch" ? "fill" : fit,
                backgroundColor: bgColor,
              }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm font-semibold">
              preview
            </div>
          )}
          <img
            src={CHARACTERS[character].src}
            alt={CHARACTERS[character].label}
            className="absolute inset-0 h-full w-full [image-rendering:pixelated]"
            style={{ objectFit: "fill" }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
            Character
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CHARACTER_KEYS.map((key) => {
              const c = CHARACTERS[key];
              const active = character === key;
              return (
                <button
                  key={key}
                  onClick={() => {
                    setCharacter(key);
                    setResultUrl(null);
                  }}
                  className={[
                    "flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition-all active:scale-95",
                    active
                      ? "bg-gradient-to-r from-vibe-pink to-vibe-purple text-white shadow ring-2 ring-vibe-purple/40"
                      : "bg-white/70 text-gray-600 hover:bg-white",
                  ].join(" ")}
                >
                  <span className="text-lg">{c.emoji}</span>
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
            Meme size
          </label>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={[
                  "rounded-xl px-3 py-2 text-sm font-bold transition-all active:scale-95",
                  size === s
                    ? "bg-gradient-to-r from-vibe-purple to-vibe-cyan text-white shadow"
                    : "bg-white/70 text-gray-600 hover:bg-white",
                ].join(" ")}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
              Fit
            </label>
            <div className="inline-flex rounded-xl bg-white/70 p-1">
              {(["cover", "contain", "stretch"] as FitMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFit(m)}
                  className={[
                    "rounded-lg px-3 py-1.5 text-sm font-bold capitalize transition-all",
                    fit === m
                      ? "bg-vibe-pink text-white shadow"
                      : "text-gray-500 hover:text-gray-700",
                  ].join(" ")}
                >
                  {m === "cover"
                    ? "Crop"
                    : m === "contain"
                      ? "Fit"
                      : "Stretch"}
                </button>
              ))}
            </div>
          </div>

          {fit === "contain" && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
                Fill
              </label>
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-xl border-2 border-white bg-white/70 p-1"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-xl bg-red-100 px-3 py-2 text-sm font-semibold text-red-600">
          {error}
        </p>
      )}

      {/* Generate */}
      <div className="mt-6">
        <Button
          size="lg"
          className="w-full"
          disabled={!source || busy}
          onClick={generate}
        >
          {busy ? `Generating… ${progress}%` : "✨ Generate GIF ✨"}
        </Button>
        {busy && (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full bg-gradient-to-r from-vibe-pink to-vibe-cyan transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Result */}
      {resultUrl && (
        <div className="mt-6 animate-pop rounded-2xl bg-gradient-to-br from-vibe-yellow/40 to-vibe-cyan/30 p-4 text-center">
          <p className="mb-3 font-black text-gray-700">Your meme is ready! 🥳</p>
          <div className="checker mx-auto mb-4 inline-block overflow-hidden rounded-xl ring-4 ring-white">
            <img
              src={resultUrl}
              alt="generated meme"
              width={224}
              height={224}
              className="block h-56 w-56 object-contain [image-rendering:auto]"
            />
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={resultUrl} download="vibe-bunny.gif">
              <Button>⬇️ Download GIF</Button>
            </a>
            <Button variant="outline" onClick={generate} disabled={busy}>
              🔁 Regenerate
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
