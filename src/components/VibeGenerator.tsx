import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { buildMeme, type FitMode } from "@/lib/gif";

const SIZES = [112, 256, 512, 768, 1024];

export default function VibeGenerator() {
  const [file, setFile] = React.useState<File | null>(null);
  const [bgUrl, setBgUrl] = React.useState<string | null>(null);
  const [size, setSize] = React.useState(512);
  const [fit, setFit] = React.useState<FitMode>("cover");
  const [bgColor, setBgColor] = React.useState("#ffffff");
  const [dragging, setDragging] = React.useState(false);

  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [resultUrl, setResultUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLInputElement>(null);

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      setError("Eso no parece una imagen 🙈 Sube un PNG/JPG.");
      return;
    }
    setError(null);
    setResultUrl(null);
    setFile(f);
    setBgUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  }

  async function generate() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    setResultUrl(null);
    try {
      const blob = await buildMeme({
        file,
        size,
        fit,
        bgColor,
        onProgress: (done, total) => setProgress(Math.round((done / total) * 100)),
      });
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      console.error(e);
      setError("Algo explotó al generar el GIF 💥 Prueba con otra imagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-xl p-6 sm:p-8 animate-pop">
      <header className="text-center mb-6">
        <h1 className="text-3xl sm:text-4xl font-black tracking-tight">
          <span className="inline-block animate-float">🐰</span>{" "}
          <span className="bg-gradient-to-r from-vibe-pink via-vibe-purple to-vibe-cyan bg-clip-text text-transparent">
            Vibe Bunny Generator
          </span>
        </h1>
        <p className="mt-1 text-sm font-semibold text-gray-500">
          Pon tu imagen de fondo al conejo vibrante y descarga el meme 🎉
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
          accept="image/*"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <p className="font-bold text-vibe-purple">
          {file ? `📸 ${file.name}` : "Arrastra una imagen o haz click"}
        </p>
        <p className="text-xs text-gray-400">PNG · JPG · WEBP</p>
      </div>

      {/* Live preview */}
      <div className="mt-5 flex justify-center">
        <div className="checker relative h-56 w-56 overflow-hidden rounded-2xl ring-4 ring-white shadow-inner">
          {bgUrl ? (
            <img
              src={bgUrl}
              alt="fondo"
              className="absolute inset-0 h-full w-full"
              style={{ objectFit: fit, backgroundColor: bgColor }}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-gray-400 text-sm font-semibold">
              vista previa
            </div>
          )}
          <img
            src="/vibe-rabbit.gif"
            alt="conejo"
            className="absolute inset-0 h-full w-full [image-rendering:pixelated]"
            style={{ objectFit: "fill" }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
            Tamaño del meme
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
              Encaje
            </label>
            <div className="inline-flex rounded-xl bg-white/70 p-1">
              {(["cover", "contain"] as FitMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setFit(m)}
                  className={[
                    "rounded-lg px-4 py-1.5 text-sm font-bold capitalize transition-all",
                    fit === m
                      ? "bg-vibe-pink text-white shadow"
                      : "text-gray-500 hover:text-gray-700",
                  ].join(" ")}
                >
                  {m === "cover" ? "Recortar" : "Completa"}
                </button>
              ))}
            </div>
          </div>

          {fit === "contain" && (
            <div>
              <label className="block text-xs font-black uppercase tracking-wide text-gray-500 mb-2">
                Relleno
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
          disabled={!file || busy}
          onClick={generate}
        >
          {busy ? `Generando… ${progress}%` : "✨ Generar GIF ✨"}
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
          <p className="mb-3 font-black text-gray-700">¡Tu meme está listo! 🥳</p>
          <div className="checker mx-auto mb-4 inline-block overflow-hidden rounded-xl ring-4 ring-white">
            <img
              src={resultUrl}
              alt="meme generado"
              width={224}
              height={224}
              className="block h-56 w-56 object-contain [image-rendering:auto]"
            />
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <a href={resultUrl} download="vibe-bunny.gif">
              <Button>⬇️ Descargar GIF</Button>
            </a>
            <Button variant="outline" onClick={generate} disabled={busy}>
              🔁 Regenerar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
