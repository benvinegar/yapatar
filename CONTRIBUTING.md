# Contributing

Thanks for taking a look.

## Getting set up

```bash
npm install
npm test
node src/serve.js     # then open http://localhost:8777/preview.html
```

You need **ffmpeg** on your PATH (`brew install ffmpeg`, `apt install ffmpeg`) and Node 20+.

## Adding an effect

Effects are composable layers. Write a function in `src/effects.js`:

```js
export function myEffect(ctx, s, f) { /* draw using s.orbR, s.level, s.spec, s.col */ }
```

`s` carries the scene (`S`, `C`, `orbR`, `level`, `spec`, `wave`, `phase`, `col`, `rings`,
`history`), `f` is the raw frame. Then list it in a style in `src/visual.js`:

```js
export const STYLES = { mine: ['glow', 'myEffect'] };
```

The test suite picks up new styles automatically and checks two things that are easy to get
wrong: that the style actually draws, and that **nothing touches the frame border** — an
effect that reaches the edge gets cut into a hard square once composited over video.

Two rules for anything in `effects.js` or `visual.js`:

- **Canvas2D only.** The same code runs in the browser preview and headless in Node, so no
  DOM APIs beyond the 2D context.
- **No wall-clock time.** Drive animation from the frame index (`f.i`), never `Date.now()`
  or `Math.random()`, or renders stop being reproducible.

## Before opening a PR

- `npm test` passes
- If you touched the renderer, eyeball an actual render — `npm run render` then look at
  `out/preview.mp4`. Alpha bugs in particular do not show up in unit tests.
