# EgoPrism

A dashboard that compares two frozen, task-matched EgoVerse subsets and reports which one is more diverse — from **pixels and motion**, not captions or an LLM.

- **Live dashboard:** [egoprism.vercel.app](https://egoprism.vercel.app)
- **Live Modal data API:** [EgoPrism summary endpoint](https://ts5789--egoprism-api-summary.modal.run)
- **Source repository:** [github.com/7dracoder/EgoPrism](https://github.com/7dracoder/EgoPrism)

Vercel is connected to this repository with `main` as the production branch and
`web/` as the project root. Every push to `main` creates a production deployment;
other branches and pull requests receive preview deployments.

**Demo statement:** For the same task and similar dataset size, this tool shows that subset B covers more distinct visual contexts and manipulation patterns than subset A.

![Hallmark Cobalt EgoPrism dashboard showing subset B winning on visual and motion coverage](assets/dashboard-web.png)

This is Track 2 (Quantitative Diversity Measurement). It is a data-selection signal, not a claim that a higher score trains a better robot.

## Run the Hallmark dashboard

The production UI is a Next.js 16 App Router app in `web/`. It uses Hallmark's
modern-minimal Workbench structure and Cobalt theme, fetches the read-only Modal
summary endpoint, and falls back to a bundled deterministic payload if Modal is
temporarily unavailable.

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

Set `MODAL_API_URL` in `web/.env.local` to the endpoint above. Add
`ELEVENLABS_API_KEY` only when testing voice locally. Both values are server-only;
never prefix either one with `NEXT_PUBLIC_`.

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

EgoPrism calls text-to-speech from server code only—the Next.js route in
production or Streamlit locally—using the `xi-api-key` header. It uses the
George voice, `eleven_flash_v2_5`, and MP3 44.1 kHz / 128 kbps output by default.
Override the voice or model with
`EGOPRISM_ELEVEN_VOICE_ID` and `EGOPRISM_ELEVEN_MODEL_ID`.

Use a restricted ElevenLabs key with only text-to-speech access and a small
character quota. The key is never used from client-side JavaScript and is never
part of the diversity calculation.

On Vercel, `ELEVENLABS_API_KEY` is a sensitive Production-only variable.
`MODAL_API_URL` is available to Production, Preview, and Development. The public
`/api/health` route returns configuration booleans only and never returns values.
