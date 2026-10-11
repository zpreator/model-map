# Contributing

Thanks for helping keep the map accurate. Everything on the site comes from JSON files in `data/`, so most contributions are a small pull request.

## Quick start

```bash
npm install
npm run validate   # schema + cross-reference checks
npm run build      # validate, test, type-check, build, prerender
npm run dev        # local site at http://localhost:5173/model-map/
```

CI runs `npm run build` on every pull request. A PR that fails validation can't be merged, so run it locally first.

## Ground rules

- **Never invent facts.** If you don't know a license, parameter count or tier, leave it `null` (or `[]` for `tiers`). The site shows "unknown", which is better than a guess.
- **Cite where a value came from** in the entry's `notes` (model card, paper, repo license file).
- **`verified` stays `false`** unless you have checked the license text, parameter counts and tier as described on the [methodology page](https://zpreator.github.io/model-map/methodology/). Say what you checked in `notes`.
- **No benchmark scores, prices or rankings.** They are out of scope for the map.

## Add or correct a model

1. Pick the file: `data/models/<id>.json` (new files: lowercase, hyphenated id; the filename must match `id`).
2. Fill in the fields, following [`schema/model.schema.json`](schema/model.schema.json):

| Field | What to put |
|---|---|
| `name` | The specific model or generation, e.g. `SAM 3`. One entry per generation, not per size. |
| `family` | Id of a file in `data/families/`. Display grouping only; the entry does not inherit anything from it. |
| `cells` | Where it sits on the grid: pairs of `input` (`image`, `text`, `audio`, `video`) and `output` (`label`, `embedding`, `boxes_masks`, `text`, `image`, `audio`, `video`). List only what *this* model does. |
| `developer` | Who built it: the Hub organization for open models, the provider for hosted ones. |
| `summary`, `summary_source` | 1-2 plain sentences (max 300 characters, no links or markup): what it is, what problem it solves, why it exists. `summary_source` is `ai` for machine-written text and `curated` once a person has written or approved it. |
| `hf_task` | The Hugging Face pipeline tag, which must exist in `data/tasks.json`. `null` for API-only models. |
| `tiers` | Subset of `cpu_edge`, `gpu_8gb`, `gpu_24gb`, `datacenter`, `api`. Cover the sizes the entry spans. `[]` if unknown. |
| `license`, `open_weights`, `hf_repo` | From the repo; `null` when unknown. A Hub license tag of `other` should be read in full, not copied. |
| `feeds_into` | Ids of models it commonly pairs with downstream. |
| `verified` | `false` unless checked (see above). |
| `source` | `curated` for hand-written entries. |

3. If it needs a new family, add `data/families/<id>.json` with `id`, `name` and a one-line `summary` (or `null`).
4. Optionally add the model to a problem's steps in `data/problems/*.json`.
5. Run `npm run build`, then open a pull request.

## Add a problem preset

Create `data/problems/<id>.json` with a `title`, a one-or-two-sentence `description` (used for search results), ordered `steps` (each a `label` and candidate model ids), and an optional `note`. Every id must exist in `data/models/`. The validator checks this.

## Teach the problem box new words

The "describe your own problem" box is keyword matching driven by `data/lexicon.json` (schema in `schema/lexicon.schema.json`). If a phrasing it misses should work, add the word to the right place: an `actions[].stems` list for what the user wants to do, or `modalities` for what they have. A plain stem matches the whole word plus simple endings; a trailing `~` matches any word starting with it; spaces match phrases. Add a case to `tests/interpret.test.mjs` for anything you fix.

## The weekly discovery PR

A scheduled job (`.github/workflows/discover.yml`) opens a PR proposing new models found on the Hugging Face Hub. An AI model picked the family and grid cells for Hub models and wrote short summaries from the model cards; developers, licenses, parameter counts and downloads come from the Hub API, and hosted models come from OpenRouter's catalogue. Review it like any other PR: delete the files for proposals you reject (their repos are remembered in `data/decisions.json`), fix cells, families or summaries where the AI got it wrong (set `summary_source` to `curated` once you've edited a summary, and the job will never overwrite it), and leave `verified: false`.

## Code changes

`src/render.ts` builds all page HTML and is shared by the browser and the build-time prerenderer (`scripts/prerender.mjs`), so changes there affect both. Keep it keyboard accessible and check the layout at 380 px wide.
