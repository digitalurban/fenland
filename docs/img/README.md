# Screenshots

Captured live from https://digitalurban.github.io/fenland/ on 2 August 2026 —
during the drought, which is why the climate tab reads the way it does.

Replace any of them by capturing a new one and saving over the file; the
README references them by name.

| File | What to capture | Notes |
|---|---|---|
| `dashboard.jpg` | The whole front page | The hero shot. Catch it in interesting weather if you can — a gale or a heatwave sells it better than a calm Tuesday |
| `gauges.jpg` | The two wind dials plus the readout row | Displayed at 480px wide and floated right, so crop tight |
| `forecast.jpg` | Forecast tab, scrolled to the 48-hour chart | Shows the colour-banded temperature line to best effect |
| `ensemble.jpg` | Ensemble tab, temperature spaghetti | Best when the models disagree — the fan of members is the whole point |
| `climate.jpg` | Climate tab, top of the page | The hero cards plus the cumulative rainfall chart. A drought or a record month makes the case far better than an average one |

## Capturing them on a Mac

`⌘⇧4` then drag, or `⌘⇧4` then space to grab a whole window. They land on the
Desktop; move them here and commit.

For a clean full-page shot without browser chrome, Chrome's DevTools does it
properly: `⌥⌘I` → `⌘⇧P` → type "screenshot" → *Capture full size screenshot*.

## Keep them reasonable

GitHub renders these at about 900px wide. Anything over ~400KB each just makes
the repo slow to clone for no visible benefit — resize before committing:

```bash
sips -Z 1600 dashboard.jpg          # built into macOS, no install needed
```
