# Documentation

- [Forecast verification setup](verification.md)
- [weeWX integration](../weewx/README.md)

## Publishing this as a website

GitHub Pages can serve either the docs or a live demo of the panels
themselves — the second is far more persuasive.

**To publish the live panels:** Settings → Pages → Source: *Deploy from a
branch*, branch `main`, folder `/ (root)`. Your panels appear at
`https://yourname.github.io/fenland/`. Remember to commit a `config.js`
with your location, since `.gitignore` excludes it by default — either remove
that line or commit a public-safe copy under a different name and load it
from `index.html`.

**Screenshots.** Drop them into `docs/img/` and uncomment the block near the
top of the README. Worth capturing: the ensemble spaghetti with the models
diverging, the forecast tab with the temperature line colour-banded, and the
climate tab during something unusual — a drought or a heatwave makes the
point far better than an average week.
