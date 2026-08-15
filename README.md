# EgoPrism

A dashboard that compares two frozen, task-family-matched EgoVerse subsets and reports which one is more diverse — from **pixels and motion**, not captions or an LLM.

- **Live dashboard:** [egoprism.vercel.app](https://egoprism.vercel.app)
- **Live Modal data API:** [EgoPrism summary endpoint](https://ts5789--egoprism-api-summary.modal.run)
- **Source repository:** [github.com/7dracoder/EgoPrism](https://github.com/7dracoder/EgoPrism)

Vercel is connected to this repository with `main` as the production branch and
`web/` as the project root. Every push to `main` creates a production deployment;
other branches and pull requests receive preview deployments.

**Demo statement:** With identical task-family quotas, equal episode counts, and
matched duration, the multi-source subset covers visual and motion clusters more
evenly than the single-source baseline.

**Data status:** Modal inventoried **22,852 production EgoVerse Zarr episodes**
from Aria, Eva, and Scale and successfully extracted features from **22,849**.
The initial cockpit uses **12,000 independent recordings**—6,000 per subset,
zero duplicated IDs—selected from that cache. Three source episodes were
excluded: one empty image array and two corrupt image blobs. Nothing is expanded
or synthesized to reach the displayed count.

![Hallmark Cobalt EgoPrism dashboard showing subset B winning on visual and motion coverage](assets/dashboard-web.png)

This is Track 2 (Quantitative Diversity Measurement). It is a data-selection signal, not a claim that a higher score trains a better robot.

## Run the Hallmark dashboard

The production UI is a Next.js 16 App Router app in `web/`. It uses Hallmark's
modern-minimal Workbench structure and Cobalt theme as a fixed viewport cockpit:
the decision and four evidence panels stay on one screen with no page-level
vertical scrolling. It fetches the prepared 12,000-episode result from the
read-only Modal summary endpoint. A bundled copy of the same real comparison
keeps the charts, search, and pagination available if Modal is temporarily down.

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Set `MODAL_API_URL` in `web/.env.local` to the endpoint above. Add
`ELEVENLABS_API_KEY` only when testing the spoken answers locally. Both values
are server-only; never prefix either one with `NEXT_PUBLIC_`.

Production verification:

```bash
cd web
npm run typecheck
npm run build
```

## Run the Streamlit reference

From `EgoPrism/` with the project venv (`source ../.venv/bin/activate` if you are in the parent `Modal` folder):

```bash
pip install -r requirements.txt
export EGOPRISM_DATA_ROOT=/path/to/the/fold-clothes-cache
python scripts/extract.py
python scripts/export_web_data.py
streamlit run app.py
```

Open [http://localhost:8501](http://localhost:8501). This preserves the original
local analysis surface; the Vercel dashboard above is the judged presentation UI.

Optional **live briefing** (ElevenLabs, not a judge):

```bash
export ELEVENLABS_API_KEY=...
```

Alternatively, copy `.streamlit/secrets.toml.example` to `.streamlit/secrets.toml`
and put the key there. Never commit that file or expose the key in browser code.
Then click **Play voice briefing**. The spoken copy is the deterministic ranking
already on screen. Audio is cached under `artifacts/audio/`; voice never changes
the score.

Tests:

```bash
pytest -q
```

Inventory and extract the production R2 data with Modal:

```bash
modal run modal_real_pipeline.py::inventory_main
modal run modal_real_pipeline.py::extract_main --publish
python scripts/select_real_comparison.py
modal volume put -f egoverse-data artifacts/features.parquet /artifacts/features.parquet
modal volume put -f egoverse-data artifacts/real-summary.json /artifacts/real-summary.json
```

Deploy the read-only web payload endpoint:

```bash
modal deploy modal_api.py
```

The persistent Modal volume holds the 22,849-episode extraction cache, selected
12,000-episode feature parquet, inventory, and prepared summary. R2 credentials
live only in the private `egoverse-r2` Modal secret.

## What is being compared

The shipped comparison contains five matched task families. Subset A is a
single-source Scale baseline; subset B is a multi-source Aria/Eva/Scale slice.
Selection is deterministic, IDs never overlap, task-family quotas are identical,
and total duration differs by less than 5%.

| | Subset A | Subset B |
|---|---|---|
| Independent episodes | 6,000 | 6,000 |
| Sources | Scale | 1,615 Aria + 1,597 Eva + 2,788 Scale |
| Duration | 110.17 h | 114.78 h |
| Task-family quotas | 2,610 folding/laundry; 1,300 groceries; 900 object-in-container; 500 cup-on-saucer; 690 utensil sorting | Identical |
| Diversity score | 84.63 | 90.79 |
| 95% CI | 83.97–85.12 | 90.31–91.24 |

## Score

1. Standardize visual and motion features on the pooled A+B set.
2. Cluster each family with \(K=\min(8,\lfloor\sqrt{n}\rfloor)\).
3. Normalized entropy \(-\sum p\log p / \log K\).
4. `diversity_score = 50 × visual_entropy + 50 × motion_entropy` (0–100). Visual-only if usable motion is absent.
5. Bootstrap episodes 200 times. Declare a winner only when 95% CIs do not overlap and the gap is ≥ 2 points; otherwise **no clear difference**.

Idle speed threshold: **0.02 m/s**. Eight evenly spaced real front frames per
episode. The current production cache uses an L2-normalized 4×4 color/spatial
grid fingerprint because these Zarr stores do not contain DINO arrays. Stored
DINO vectors remain supported by the local extractor when present. Motion
features are pooled, 0.5%/99.5% winsorized to contain sensor glitches, then
standardized; poses are rewritten into the current head frame when available.

Lab, scene, and other metadata are filters and labels. They are not score inputs.

## How to read the evidence

- Desktop shows four panels simultaneously. Smaller screens use four panel tabs
  while the app still stays inside one viewport.
- The score rows show the 0–100 diversity score, its visual and motion
  components, and a 95% episode-bootstrap interval.
- In the dark visual projection, each mark is a representative episode:
  outlined squares are A, teal circles are B, and the numeral is its visual
  cluster. To keep the fixed cockpit responsive, this panel uses a deterministic
  subset- and cluster-stratified sample of at most 320 points and states the
  sample size in its header. The coverage counts, entropy scores, confidence
  occupancy counts, dataset index, and bootstrap intervals use all 12,000
  independent episodes. Nearby marks have more similar visual fingerprints.
  PCA followed by UMAP produces this 2D inspection
  map when UMAP is available.
- Projection axes have no standalone semantic meaning, and screen distance is
  not the score. Clusters are fit in the standardized feature space; normalized
  cluster-occupancy entropy produces the score.
- The coverage panel shows both visual and motion occupancy. In each row, the
  upper bar is A, the lower bar is B, and the count at right is `A / B`. The
  current comparison uses all 8 clusters on both sides. B wins because its
  occupancy is more even: visual entropy is 0.975 versus 0.915, and motion
  entropy is 0.841 versus 0.777.
- The score panel combines the component bars with a 0–100 confidence-interval
  chart. The episode inspector connects a selected point to its frame, scene,
  lab, cluster, novelty, and idle metrics.

## Use another comparison

Click **Dataset** in the top-right corner. The side drawer exposes the complete
episode index with search and 100-row pagination, and accepts an EgoPrism
comparison JSON up to 25 MB. A valid file immediately replaces the bundled
comparison in all four panels for the current browser tab; **Restore initial
dataset** switches back to the real 12,000-episode comparison.

This upload is intentionally the scored comparison payload, not raw Zarr. Raw
EgoVerse data still needs the Python extraction and clustering pipeline first.
The browser validates project identity, subset summaries, unique episode IDs,
episode counts, cluster ranges, occupancy arrays, and method fields. Uploaded
data stays local to the browser and is not sent to Vercel. Preview images render
from bundled paths, embedded data URIs, or the allowlisted Modal preview host.
Production R2 frames are deny-by-default and require an explicit public-display
allowlist; uncleared episodes show `Preview restricted` rather than leaking data.

The full plain-language walkthrough, including the exact fixture occupancy and
what not to infer from UMAP, is in `../EGOPRISM_COMPLETE_PROJECT_GUIDE.md` in
the parent workspace.

## Layout

```text
EgoPrism/
├── web/                   Hallmark Next.js dashboard + server voice route
├── app.py                 Streamlit reference dashboard
├── modal_api.py           Modal read-only comparison endpoint
├── modal_extract.py       bounded local/volume extractor
├── modal_real_pipeline.py production R2 inventory + distributed extraction
├── src/                   IO, features, metrics, payload
├── scripts/select_real_comparison.py  deterministic 6K-vs-6K selector
├── data/manifests/        subset_a.csv, subset_b.csv
├── tests/
├── artifacts/             cached parquet + previews (generated)
├── summary-slide.html     one-slide story
└── README.md
```

## Limitations

- The dashboard score describes the selected 12,000 production episodes and five
  matched task families; it is not automatically a claim about every EgoVerse
  task or every future collection.
- The lightweight RGB color/spatial fingerprint is useful for screening but is
  less semantic than a freshly generated DINO-family embedding.
- Public production-frame display remains deny-by-default until the dataset
  owner explicitly clears the relevant episodes.
- A higher score is cluster coverage, not guaranteed robot success.
- Missing motion is labeled, not invented.
- ElevenLabs is optional demo audio. It does not score subsets.

## ElevenLabs integration

EgoPrism has two separate voice experiences:

1. The deterministic **Play briefing** control calls text-to-speech from server
   code only—the Next.js route in production or Streamlit locally. It uses the
   George voice, `eleven_flash_v2_5`, and MP3 44.1 kHz / 128 kbps output by
   default. Override it with `EGOPRISM_ELEVEN_VOICE_ID` and
   `EGOPRISM_ELEVEN_MODEL_ID`.
2. The **Voice AI** control opens a compact answer bubble, starts listening,
   maps each spoken question to versioned, verified EgoPrism knowledge, and uses
   ElevenLabs to speak the answer. Only the latest assistant answer is shown as
   text. After each spoken response the microphone opens again automatically,
   continuing until the user presses **End conversation**; ending leaves the
   final answer visible.
   `/api/voice-agent/answer` performs the grounded mapping;
   `/api/voice-agent/speak` performs server-only text-to-speech.

Use a restricted ElevenLabs key with only text-to-speech permission and
conservative account usage limits. The spoken answers come from a fixed topic
set and are CDN-cacheable, which limits both hallucination and repeated cost.
The key is never used from client-side JavaScript and voice is never part of the
diversity calculation.

On Vercel, `ELEVENLABS_API_KEY` is a sensitive Production-only variable.
`MODAL_API_URL` is available to Production, Preview, and Development. The public
`/api/health` route returns configuration booleans only and never returns values.
