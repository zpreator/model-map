# Model Map

An interactive map of the ML model landscape, from small building blocks like ResNet18 up to flagship LLMs. It answers one question: **which model fits my problem?**

**Live site:** https://zpreator.github.io/model-map/

Models sit where their *input* (columns: image, text, audio, video) meets their *output* (rows: label or score, embedding, boxes or masks, text, media). Chips are colored by the lightest deployment tier that runs them. Pick a problem preset to see it as ordered steps with candidate models and the lightest setup that covers it.

It is a static site: no backend, no scraping at runtime, no GPU work. There are no benchmark numbers, prices or accounts. It is built for understanding: once you know the right *family*, you pick a checkpoint on [Hugging Face](https://huggingface.co).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173/model-map/
npm run build      # validate data, run tests, type-check, build, prerender every page into dist/
npm test
```

Requires Node 22+.

## How it works

| Path | What |
|---|---|
| `data/models/*.json` | One file per model (e.g. SAM 3), each with its own cells, tiers and license |
| `data/families/*.json` | Display grouping: one chip per family. Holds no technical properties |
| `data/problems/*.json` | Problem presets: ordered steps, each with candidate model ids |
| `data/tasks.json` | Hugging Face task taxonomy, generated from `@huggingface/tasks` (`npm run gen:tasks`) |
| `schema/*.json` | JSON Schemas; `scripts/validate.mjs` also checks references between files |
| `src/render.ts` | All page HTML, shared by the browser and the prerenderer |
| `src/lightest.ts` | The "lightest setup" calculation (tested in `tests/`) |
| `scripts/prerender.mjs` | Writes a real HTML file per page, plus `sitemap.xml`, `robots.txt`, `404.html` |
| `tools/discover.mjs` | Weekly job that proposes new models (see below) |

Pages: the home map, one page per problem (`/problems/<id>/`), one per Hugging Face task that has models (`/tasks/<id>/`), and a methodology page. Presets and task links are real links that navigate in place without a reload.

### Add a model

Short version: add `data/models/<id>.json`, point `family` at a file in `data/families/`, run `npm run build`, open a PR. Leave unknown fields `null` and `verified: false`. Full field guide in [CONTRIBUTING.md](CONTRIBUTING.md).

### Lightest setup

For each step of a problem, take the lightest tier among its candidates; the overall setup is the heaviest of those. `api` is not on the hardware scale (it needs no hardware but brings cost and privacy trade-offs), so API-only steps are reported separately. Steps with no tier data are reported as unknown.

## Weekly discovery

`.github/workflows/discover.yml` runs on Mondays. `tools/discover.mjs`:

1. queries the Hugging Face Hub API for the most downloaded and trending models per task,
2. filters out fine-tunes, quantized copies, test repos and low-download noise,
3. asks an OpenAI model which family and grid cells each remaining candidate belongs in (or whether to ignore it),
4. writes proposed entries (always `verified: false`) and opens a pull request for a person to review.

Licenses, parameter counts and downloads come from the Hub API, never from the model. Drafted family summaries appear in the PR description only; they are not written to the data files.

Setup: add a repository secret `OPENAI_API_KEY` (and optionally `HF_TOKEN`), and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. Try it locally without a key: `node tools/discover.mjs --no-llm` lists candidates; `--dry-run` runs the model step and writes nothing. The model defaults to `gpt-6-luna` (OpenAI's small, efficient tier); override with `DISCOVER_MODEL`.

## Deploy

Pushes to `main` build and deploy to GitHub Pages through `.github/workflows/ci.yml`. Pull requests run the same build without deploying. The deployed URL lives in `site.json`; change it there (or set `SITE_URL`) for a custom domain, and the base path, canonical links, Open Graph tags and sitemap follow.

## Decisions worth knowing

- **Flat entries, family as a label.** An early draft inherited properties from a family; that breaks when a newer version changes inputs or outputs (SAM 3 adds video and text prompts). Entries are independent and the family only groups chips.
- **Tiers are coarse, unverified estimates** until a person marks an entry `verified`. See the [methodology page](https://zpreator.github.io/model-map/methodology/).
- **No Open Graph image yet.** Pages have title, description and URL tags only.
- **No license file yet.** Choose one before accepting outside contributions.
