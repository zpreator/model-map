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
| `cells` | Where it sits on the grid: pairs of `input` (`image`, `text`, `audio`, `video`) and `output` (`label`, `embedding`, `boxes_masks`, `text`, `media`). List only what *this* model does. |
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

## The weekly discovery PR

A scheduled job (`.github/workflows/discover.yml`) opens a PR proposing new models found on the Hugging Face Hub. An AI model picked the family and grid cells; licenses, parameter counts and downloads come from the Hub API. Review it like any other PR: delete the files for proposals you reject (their repos are remembered in `data/decisions.json`), fix cells or families where the AI got it wrong, and leave `verified: false`.

## Code changes

`src/render.ts` builds all page HTML and is shared by the browser and the build-time prerenderer (`scripts/prerender.mjs`), so changes there affect both. Keep it keyboard accessible and check the layout at 380 px wide.
