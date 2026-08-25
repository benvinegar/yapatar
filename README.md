# Yapper

<p align="center">
  <img src="assets/demo.gif" width="240" alt="An avatar pulsing in time with a voice recording">
</p>

Turn a voice recording + an avatar image into a **transparent-background video** of the
avatar pulsing with the voice — glow, expanding rings on transients, a spectrum-deformed
outline and a waveform scope ring. Drop the file into DaVinci Resolve (or Premiere / FCP)
on a track above your screencast, scale it into a corner, done. No keying, no green screen.

## Quick start

```bash
npm install
node src/make-avatar.js                 # placeholder avatar (replace assets/avatar.png)
node src/render.js --audio assets/voice.wav --avatar assets/avatar.png
```

Produces:

| file | what |
|---|---|
| `out/avatar_alpha.mov` | ProRes 4444 w/ alpha, **silent** — this is the overlay |
| `out/preview.mp4` | flattened on a dark background + audio, just for eyeballing |

## Live preview (tune the look)

```bash
node src/serve.js                # serves the page AND persists your settings
open http://localhost:8777/preview.html
```

Chrome pauses the render loop for background tabs, so **bring the window to the front**
before pressing play — otherwise it looks frozen.

Press **💾 Save settings for the agent** and the current values land in `settings.json`,
which `render.js` picks up automatically (explicit CLI flags still win). Open the page with
query params to preconfigure it: `preview.html?hueA=200&glow=140`.

Sliders for hue, bounce, glow, blob amount and sensitivity, driven by a file **or your
microphone**. `src/visual.js` is shared by the preview and the renderer, so what you tune
is exactly what renders.

## Options

```
--audio    path    audio (or video) file to react to      default assets/voice.wav
--avatar   path    image, centre-cropped into the circle  default assets/avatar.png
--outdir   path    output directory                       default out
--fps      n       frame rate — match your timeline       default 30
--size     n       square output in px                    default 512
--codec    c       prores | hevc | png                    default prores
--gain     n       multiply reactivity                    default 1
--range    n       dB range: lower = more per-syllable     default 13
--hueA/--hueB n    gradient hues 0-360                    default 190 / 285
--bounce   n       avatar scale with loudness, 0-30        default 9
--glow     n       glow intensity, 0-200                   default 100
--blob     n       spectrum deformation, 0-30              default 9
--no-preview       skip the flattened mp4

Every one of these matches a slider in `preview.html`, which prints the exact command
for your current settings with a copy button — tune visually, paste, render.
```

### Codec choice

Measured on 18.9 s @ 512×512 / 30 fps:

| `--codec` | size | notes |
|---|---|---|
| `prores` | 286 MB | ProRes 4444, 16-bit alpha. Safest, works everywhere. |
| `hevc` | 14 MB | Apple HEVC w/ alpha. **~20× smaller**, 8-bit alpha, 4:2:0 colour. macOS NLEs read it fine. |
| `png` | 112 MB | Lossless RGBA in a .mov. Slow to decode. |

ProRes is roughly 15 MB/s of runtime, so a 30-minute take is ~27 GB — use `--codec hevc`
for anything long, or render at the size the overlay actually appears at.

## Long recordings

Measured on this machine, 512x512 @ 30 fps, a real 30-minute (1815 s) file:

| | render time | output size | peak RAM |
|---|---|---|---|
| `--codec hevc` | 91 s | **1.3 GB** | 1.2 GB |
| `--codec prores` | ~100 s | **~27 GB** | 1.2 GB |

Render time is fine either way — about 20x faster than realtime. **Size is the thing that
bites:** ProRes 4444 is a fixed ~15 MB per second of runtime regardless of content, so a
half-hour take is 27 GB. Use `--codec hevc` for anything long; it's the same picture with
8-bit alpha instead of 16-bit, which no one will see in a corner overlay.

RAM is ~1.2 GB at 30 minutes because the whole decoded PCM plus per-frame features are held
at once. That's comfortable, but it grows linearly — a multi-hour file would need chunking.

## Workflow

1. Record voice + screen as usual.
2. Extract or point at the voice track: `--audio take01.wav` (a video file works too —
   ffmpeg pulls the audio out).
3. Render at your timeline's fps: `--fps 30`.
4. In Resolve: import `avatar_alpha.mov`, drop it on video track 2 above the screencast.
   Alpha is honoured automatically — no need to set a composite mode. Scale/position into
   a corner. The clip is silent; keep using your original audio track.
5. Because the render is frame-locked to the audio file, it stays in sync as long as the
   overlay starts at the same timecode as that audio.

## Using it from Claude Code

This project doubles as a plugin. `skills/yapper/SKILL.md` teaches an agent the
whole loop: start the server, open a preconfigured preview, wait for you to tune and save,
then render with your values. It's symlinked into `~/.claude/skills/`, so it's live now —
just ask for a voice-reactive avatar overlay.

To share it, `.claude-plugin/plugin.json` makes the repo installable as a plugin.

## Licence

MIT.

## How it works

- `src/audio.js` — ffmpeg decodes to mono f32 PCM; per video frame a 2048-sample Hann
  window gives RMS loudness and a 64-bin log-spaced spectrum (60 Hz–8 kHz). Loudness is
  **auto-calibrated per clip**: the 97th percentile becomes "full pulse", 13 dB below it
  becomes rest. Without that, ordinary speech pins the visual at maximum and nothing
  appears to react. Then fast-attack / slow-release smoothing, so it moves like speech.
- `src/visual.js` — pure Canvas2D, no DOM, so the identical code runs in the browser
  preview and headless in Node via `@napi-rs/canvas`. Deterministic: driven by frame
  index, never by wall-clock, so renders are reproducible.
- `src/render.js` — pipes raw RGBA frames straight into ffmpeg's stdin. ~10× faster than
  realtime (18.9 s of audio renders in 2 s).

The layout keeps a deliberate margin: glow and expanding rings are sized so they never
touch the frame edge, which would show as a hard clipped square once composited.
