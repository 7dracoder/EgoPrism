# EgoPrism

A dashboard that compares two frozen, task-matched EgoVerse subsets and reports which one is more diverse — from **pixels and motion**, not captions or an LLM.

- **Live dashboard:** [egoprism.vercel.app](https://egoprism.vercel.app)
- **Live Modal data API:** [EgoPrism summary endpoint](https://ts5789--egoprism-api-summary.modal.run)
- **Source repository:** [github.com/7dracoder/EgoPrism](https://github.com/7dracoder/EgoPrism)

Vercel is connected to this repository with `main` as the production branch and
`web/` as the project root. Every push to `main` creates a production deployment;
other branches and pull requests receive preview deployments.

**Demo statement:** For the same task and similar dataset size, this tool shows that subset B covers more distinct visual contexts and manipulation patterns than subset A.

**Data status:** The included 32 episodes are deterministic, schema-faithful
synthetic fixtures. They are valid for exercising the complete product and
scoring method, but the fixture result is not a scientific claim about real
EgoVerse data. Use an approved real slice before making that claim.

![Hallmark Cobalt EgoPrism dashboard showing subset B winning on visual and motion coverage](assets/dashboard-web.png)

This is Track 2 (Quantitative Diversity Measurement). It is a data-selection signal, not a claim that a higher score trains a better robot.

## Run the Hallmark dashboard

The production UI is a Next.js 16 App Router app in `web/`. It uses Hallmark's
modern-minimal Workbench structure and Cobalt theme as a fixed viewport cockpit:
the decision and four evidence panels stay on one screen with no page-level
vertical scrolling. It fetches the read-only Modal summary endpoint and falls
back to a bundled deterministic payload if Modal is temporarily unavailable.

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
python scripts/make_fixtures.py
python scripts/extract.py
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

Cloud extract (CPU by default, writes into the `egoverse-data` volume at `/data`):

```bash
modal run modal_extract.py
```

Deploy the read-only web payload endpoint:

```bash
modal deploy modal_api.py
```

The bundled demo data is versioned, so a stale demo fixture on the persistent
volume is refreshed automatically. Unknown volume data is treated as real and
is never overwritten.

GPU is not on the default path. `gpu_ready` exists as an optional probe if you later need to generate embeddings that are missing from the zarr.

## What is being compared

Both subsets are **fold-clothes**, 16 episodes each, ~3s clips, 30 FPS, `human_bimanual` with camera intrinsics.

| | Subset A | Subset B |
|---|---|---|
| Scenes | 1 kitchen | 8 kitchens |
| Labs | 1 | 4 |
| Motion | short, high-idle | longer, varied, mixed coordination |

Swap the CSV manifests and `.zarr` stores to point at a real EgoVerse slice. The reader already expects `images.front_1`, optional `dino.front_img_1`, and whichever of `left/right.obs_ee_pose` plus `obs_head_pose` exists.

## Score

1. Standardize visual and motion features on the pooled A+B set.
2. Cluster each family with \(K=\min(8,\lfloor\sqrt{n}\rfloor)\).
3. Normalized entropy \(-\sum p\log p / \log K\).
4. `diversity_score = 50 × visual_entropy + 50 × motion_entropy` (0–100). Visual-only if usable motion is absent.
5. Bootstrap episodes 200 times. Declare a winner only when 95% CIs do not overlap and the gap is ≥ 2 points; otherwise **no clear difference**.

Idle speed threshold: **0.02 m/s**. Eight evenly spaced front frames per episode. DINO vectors are L2-normalized, then mean-pooled. Poses are rewritten into the current head frame when head pose exists.

Lab, scene, and other metadata are filters and labels. They are not score inputs.

## How to read the evidence

- Desktop shows four panels simultaneously. Smaller screens use four panel tabs
  while the app still stays inside one viewport.
- The score rows show the 0–100 diversity score, its visual and motion
  components, and a 95% episode-bootstrap interval.
- In the dark visual projection, each mark is an episode: outlined squares are
  A, teal circles are B, and the numeral is its visual cluster. Nearby marks
  have more similar image embeddings. PCA followed by UMAP produces this 2D
  inspection map when UMAP is available.
- Projection axes have no standalone semantic meaning, and screen distance is
  not the score. Clusters are fit in the standardized feature space; normalized
  cluster-occupancy entropy produces the score.
- The coverage panel shows both visual and motion occupancy. In each row, the
  upper bar is A, the lower bar is B, and the count at right is `A / B`. The
  fixture has A in 1/5 visual clusters and B in 5/5.
- The score panel combines the component bars with a 0–100 confidence-interval
  chart. The episode inspector connects a selected point to its frame, scene,
  lab, cluster, novelty, and idle metrics.

## Use another comparison

Click **Dataset** in the top-right corner. The side drawer shows the complete
episode index and accepts an EgoPrism comparison JSON up to 25 MB. A valid file
immediately replaces the bundled fixture in all four panels for the current
browser tab; **Restore bundled demo** switches back.

This upload is intentionally the scored comparison payload, not raw Zarr. Raw
EgoVerse data still needs the Python extraction and clustering pipeline first.
The browser validates project identity, subset summaries, unique episode IDs,
episode counts, cluster ranges, occupancy arrays, and method fields. Uploaded
data stays local to the browser and is not sent to Vercel. Preview images render
when the payload uses a bundled `/episodes/...` path or an embedded data URI;
otherwise the inspector displays a clear placeholder.

The full plain-language walkthrough, including the exact fixture occupancy and
what not to infer from UMAP, is in `../EGOPRISM_COMPLETE_PROJECT_GUIDE.md` in
the parent workspace.

## Layout

```text
EgoPrism/
├── web/                   Hallmark Next.js dashboard + server voice route
├── app.py                 Streamlit reference dashboard
├── modal_api.py           Modal read-only comparison endpoint
├── modal_extract.py       Modal CPU extractor
├── src/                   IO, features, metrics, fixtures
├── data/manifests/        subset_a.csv, subset_b.csv
├── tests/
├── artifacts/             cached parquet + previews (generated)
├── summary-slide.html     one-slide story
└── README.md
```

## Limitations

- Synthetic schema-faithful episodes ship so the demo runs without EgoDB. Drop in real zarr; do not keep the fixture centroids if you are scoring a production slice.
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
2. The **Ask AI** control accepts a microphone or typed question about the page,
   maps it to versioned, verified EgoPrism knowledge, and uses ElevenLabs to
   speak the answer. After each spoken response it automatically opens the
   microphone again, continuing until the user presses **Stop assistant**.
   `/api/voice-agent/answer` performs the grounded mapping;
   `/api/voice-agent/speak` performs server-only text-to-speech. Unsupported
   browser voice input falls back to the same typed experience.

Use a restricted ElevenLabs key with only text-to-speech permission and
conservative account usage limits. The spoken answers come from a fixed topic
set and are CDN-cacheable, which limits both hallucination and repeated cost.
The key is never used from client-side JavaScript and voice is never part of the
diversity calculation.

On Vercel, `ELEVENLABS_API_KEY` is a sensitive Production-only variable.
`MODAL_API_URL` is available to Production, Preview, and Development. The public
`/api/health` route returns configuration booleans only and never returns values.
