---
name: yapatar
description: Create a voice-reactive avatar overlay video with a transparent background, for compositing into a screencast in DaVinci Resolve / Premiere / Final Cut. Use when the user wants an animated avatar that pulses with their voice, a talking-head replacement, an audio-reactive logo or waveform overlay, or asks to avoid showing their face on camera.
---

# Yapatar

Turns a voice recording + an avatar image into a **transparent-background video** of the
avatar pulsing with the voice — glow, rings that fire on transients, a spectrum-deformed
outline, a waveform ring. The user composites it over their screencast.

Project root (`$ROOT` below): find it, don't assume it. Try in order —
1. the current working directory, if it contains `src/render.js` and a `package.json` named `yapatar`
2. `~/Projects/yapatar`
3. `find ~ -name render.js -path '*yapatar*' -maxdepth 6 2>/dev/null | head -1`

If none hit, ask the user where they cloned it. Requires `ffmpeg` on PATH and Node 20+.

## First run

```bash
cd $ROOT && [ -d node_modules ] || npm install
```

`--codec hevc` needs `hevc_videotoolbox`, which is **macOS-only**. On Linux use `prores` or
`png`; the renderer checks and says so rather than failing obscurely.

## The loop

The user tunes the look in a browser; you render the file. Both directions are wired
through `settings.json`, so neither of you has to retype values.

**1. Start the preview server** (background — it must keep running):

```bash
cd $ROOT && node src/serve.js
```

**2. Open the preview.** You can preconfigure the look with query params, which is how you
propose a style without touching the user's sliders:

```
http://localhost:8777/preview.html?hueA=200&hueB=310&glow=140&blob=14
```

Params: `style`, `preset`, `hueA` `hueB` (0-360), `bounce` (0-30), `glow` (0-200),
`blob` (0-30), `range` (6-30, lower = more per-syllable movement).

Styles: `pulse` (default), `constellation` (QAM symbol lattice), `waterfall` (radial
spectrogram), `packets` (framed data bursts), `handshake` (carrier lock + symbols).
Palettes: `--preset modem` is the modem.dev teal/cream. Or set `--colorA`/`--colorB` hex.

Tell the user to **bring the Chrome window to the front and press ▶ Play test audio or
🎙 Use microphone** — Chrome pauses the render loop and suspends audio for background tabs,
so a backgrounded preview looks frozen and reads as broken.

**3. The user tunes**, then presses **💾 Save settings for the agent**, which writes
`$ROOT/settings.json`.

**4. Read it back** and render. `render.js` picks up `settings.json` automatically;
explicit flags override it:

```bash
cd $ROOT && node src/render.js --audio ~/take01.wav --avatar ~/me.png --codec hevc
```

It prints the resolved `config:` line — check it matches what the user tuned.

Alternatively the user can press **🎬 Render the final file** in the page and get a download
link without a terminal — the browser uploads the bytes to the local server, which runs the
same renderer. Use that when they have no path handy for their files.

**5. Report the output path**: `out/avatar_alpha.mov` (transparent, and carrying the source
audio so it can be lined up by waveform — remind the user to mute that track once positioned,
or `--no-audio` for a silent overlay) and `out/preview.mp4` (flattened, for eyeballing).

## Choosing a codec

| | size for 30 min | when |
|---|---|---|
| `--codec hevc` | ~1.3 GB | **default choice for anything over a couple of minutes** |
| `--codec prores` | ~27 GB | short clips, or a workflow that demands ProRes 4444 |
| `--codec png` | in between | lossless RGBA, slow to decode |

ProRes is a fixed ~15 MB per second of runtime regardless of content. Warn the user before
rendering a long take as ProRes.

## Options

`--audio` `--avatar` `--outdir` `--fps` `--size` `--codec` `--gain` `--range` `--style`
`--preset` `--colorA` `--colorB` `--hueA` `--hueB` `--bounce` `--glow` `--blob` `--alpha`
`--no-audio` `--no-preview` `--settings <path>`

Point `--audio` at the screen recording itself if the voice is in it — ffmpeg extracts the
audio, which also guarantees sync.

## Alpha

Output is **premultiplied** by default, because Resolve and most NLEs composite that way.
If the user reports a **white halo or a glowing blob** around the avatar, that is straight
alpha being composited as premultiplied. Either re-render with the default `--alpha
premultiplied`, or tell them to set Clip Attributes -> Alpha Mode -> Straight in Resolve.
A dark or muddy halo is the opposite mismatch: try `--alpha straight`.

## Notes

- Renders ~20x faster than realtime (30 min of audio in ~91 s), peak RAM ~1.2 GB at 30 min.
  RAM grows linearly with duration; a multi-hour file would need chunking.
- The avatar is circle-cropped and centred. `assets/avatar.png` is a generated placeholder —
  swap in the user's real image.
- Browsers cannot expose a picked file's real directory, so the preview's generated command
  uses the filename plus a "folder" field the user fills in. Don't promise full paths.
- Requires `ffmpeg` on PATH.
