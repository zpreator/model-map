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
| `src/interpret.ts`, `data/lexicon.json` | The "describe your own problem" box: keyword matching, no AI (see below) |
| `src/lightest.ts` | The "lightest setup" calculation (tested in `tests/`) |
| `scripts/prerender.mjs` | Writes a real HTML file per page, plus `sitemap.xml`, `robots.txt`, `404.html` |
| `tools/discover.mjs` | Weekly job that proposes new models (see below) |

Pages: the home map, one page per problem (`/problems/<id>/`), one per Hugging Face task that has models (`/tasks/<id>/`), and a methodology page. Presets and task links are real links that navigate in place without a reload.

### Add a model

Short version: add `data/models/<id>.json`, point `family` at a file in `data/families/`, run `npm run build`, open a PR. Leave unknown fields `null` and `verified: false`. Full field guide in [CONTRIBUTING.md](CONTRIBUTING.md).

### Hardware filter

"Show models that fit on" (Any, CPU / edge, 8 GB, 24 GB, Datacenter) hides every model whose lightest option is heavier than the chosen tier, and hides chips left with no fitting model. API-only and unknown-size models are excluded unless you tick the two boxes that appear. With a problem selected, non-fitting candidates are struck through and a line says whether every step has an option that fits. The choice is kept in the URL (`?fit=gpu_8gb&api=1&unknown=1`), so filtered views can be shared. `fitsWithin` in `src/lightest.ts` holds the rule and is tested.

### Describe your own problem

The text box turns a sentence into ordered steps and candidate models without any AI or network call. `src/interpret.ts` matches words against `data/lexicon.json`: verbs say what a step does (transcribe, sort, count, find similar, summarize, generate) and nouns say what it works on (photos, documents, recordings, video). It then looks up which models on the map cover that input-to-output pair, ranked by recent downloads with older models discounted. It also shows the words it matched, flags things the map does not cover (spreadsheets, forecasting), suggests a related preset, and lists models whose names mention your words. Links are shareable as `#ask=...`.

It is plain keyword matching, so unusual phrasing can miss; the fix is to add words to the lexicon, not code. `npm run validate` checks the lexicon's shape and `tests/interpret.test.mjs` pins the behaviour.

### Lightest setup

For each step of a problem, take the lightest tier among its candidates; the overall setup is the heaviest of those. `api` is not on the hardware scale (it needs no hardware but brings cost and privacy trade-offs), so API-only steps are reported separately. Steps with no tier data are reported as unknown.

## Weekly discovery

`.github/workflows/discover.yml` runs on Mondays. `tools/discover.mjs`:

1. queries the Hugging Face Hub API for the most downloaded and trending open models per task, and filters out fine-tunes, quantized copies, test repos and low-download noise,
2. asks an OpenAI model which family and grid cells each remaining candidate belongs in (or whether to ignore it). All general-purpose language models go under the single **Open LLMs** family,
3. pulls the most-used hosted text models from OpenRouter into **Closed LLMs**, and the newest hosted image and audio generators (a couple per lab, so one lab's variants don't crowd out the others) into **Closed image models** and **Closed audio models**. Generators are picked by release date because OpenRouter's usage ranking never shows them, and they are placed by what they generate. OpenRouter only lists models it routes to, so the job also reads OpenAI's own model list (using the same API key) for what OpenRouter lacks: gpt-image, Sora, text-to-speech, realtime voice and transcription. That list has only ids and dates, so rules in `tools/discover.config.json` (`openai_media`) classify models by id pattern; dated snapshots collapse onto their alias and the summary is based on the rule's category description, since the API gives no card. The model catalogue is a documented API; the usage ranking is read from the public rankings page, which is undocumented, so if its format changes the job falls back to release date and says so in the PR,
4. writes a 1-2 sentence summary for each new entry (and for older entries that lack one) from sanitized card text, marked `summary_source: "ai"`,
5. opens a pull request for a person to review. Everything proposed is `verified: false`.

Developers, licenses, parameter counts, downloads and modalities come from the APIs, never from the model. Tier estimates come from the size of the weight files (safetensors; otherwise .bin/.pt/.onnx, taking the largest checkpoint), and an unknown tier records why in `tier_note`. `node tools/retier.mjs` recomputes them for machine-added, unverified entries (add `--ids=a,b` to include hand-curated ones).

Setup: add a repository secret `OPENAI_API_KEY` (and optionally `HF_TOKEN`), and enable *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*. Run it by hand from the Actions tab; tick **backfill** to summarize every existing entry in one go (otherwise at most 40 per run). Try it locally without a key: `node tools/discover.mjs --no-llm` lists candidates, and `DISCOVER_FAKE_LLM=1 node tools/discover.mjs --dry-run` exercises the pipeline with canned answers. `--dry-run` with a key runs the real model steps and writes nothing. The model defaults to `gpt-6-luna`; override with `DISCOVER_MODEL`.

## Deploy

Pushes to `main` build and deploy to GitHub Pages through `.github/workflows/ci.yml`. Pull requests run the same build without deploying. The deployed URL lives in `site.json`; change it there (or set `SITE_URL`) for a custom domain, and the base path, canonical links, Open Graph tags and sitemap follow.

## Decisions worth knowing

- **Flat entries, family as a label.** An early draft inherited properties from a family; that breaks when a newer version changes inputs or outputs (SAM 3 adds video and text prompts). Entries are independent and the family only groups chips.
- **Tiers are coarse, unverified estimates** until a person marks an entry `verified`. See the [methodology page](https://zpreator.github.io/model-map/methodology/).
- **No Open Graph image yet.** Pages have title, description and URL tags only.

## License

[MIT](LICENSE). By contributing you agree your contribution is released under the same license.
