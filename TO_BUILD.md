# EgoPrism — End-to-End Build Map

EgoPrism is the Track 2 quantitative-diversity entry: compare two frozen,
task-matched EgoVerse subsets using visual and motion coverage, then make the
winner and its evidence easy to inspect.

## Product contract

- Input: two similar-size, task-matched episode manifests and their zarr data.
- Processing: pooled feature normalization, visual and motion clustering,
  normalized entropy, and episode-level bootstrap confidence intervals.
- Output: a 0–100 score for each subset, a conservative winner decision,
  cluster evidence, and traceable representative episodes.
- Guardrail: metadata, captions, voice, and LLM output never affect the score.
- Claim: broader measured coverage—not guaranteed downstream policy quality.

## Required architecture

```text
EgoVerse zarr + manifests
        ↓
Modal extraction / deterministic scoring
        ↓
Modal read-only JSON endpoint
        ↓
Next.js dashboard on Vercel
        ├── interactive evidence and filters
        └── server-only ElevenLabs briefing route
```

## Dashboard design mandate

Use [Hallmark](https://github.com/Nutlope/hallmark) as the dashboard taste and
interaction system. The implementation is a modern-minimal **Workbench** using
Hallmark's **Cobalt** theme, N13 command navigation, Ft2 footer, real episode
frames, semantic OKLCH tokens, restrained motion, strong focus states, and
responsive layouts from 320 px upward.

The dashboard must remain functional, not decorative:

- Lead with the decision, score gap, and 95% bootstrap context.
- Show the A/B score anatomy before the visual evidence.
- Make projection points clickable and episode examples filterable.
- Keep the exact scoring method and limitation in the page.
- Provide command navigation with `⌘/Ctrl + K` and a mobile search control.
- Keep ElevenLabs behind a Vercel server route; never expose the key to the browser.
- Use the generated `/og.png` social card in Open Graph and Twitter metadata.

## Build status

- [x] Schema-faithful 32-episode demo fixture and manifests.
- [x] Deterministic extraction, feature, clustering, scoring, and bootstrap pipeline.
- [x] Streamlit reference dashboard and optional local voice briefing.
- [x] Serializable web payload and regression tests.
- [x] Modal read-only comparison API backed by the `egoverse-data` volume.
- [x] Hallmark/Cobalt Next.js dashboard with real episode frames.
- [x] Server-only ElevenLabs route and non-secret health endpoint.
- [x] Vercel project link and production environment variables.
- [x] Production Vercel deployment and final live smoke test.
- [ ] Submission video, Devpost copy, screenshots, and final rules check.

- Production dashboard: [egoprism.vercel.app](https://egoprism.vercel.app)
- Production data API: [Modal summary](https://ts5789--egoprism-api-summary.modal.run)

## Verification gates

- `pytest -q` passes the Python pipeline and web-payload tests.
- `npm run typecheck` and `npm run build` pass under `web/`.
- Modal `/summary` responds with 32 episodes and the deterministic winner.
- Vercel `/api/health` reports both services configured without returning secrets.
- Vercel `/api/voice` returns MP3 audio from the fixed result briefing.
- The live dashboard has no console errors, no horizontal overflow at 320, 375,
  414, 768, 1280, and 1920 px, and all clickable labels remain on one line.
- Hallmark's pre-emit critique and 58-gate slop test pass before handoff.

## Before submission

1. Replace synthetic fixture manifests with an approved real slice if competition
   rules or judging expectations require it; never silently mix fixture and real data.
2. Record a 60–90 second demo: decision → evidence → episode trace → voice briefing.
3. Explain the pooled transform, score formula, winner rule, and limitation.
4. Include deployment URLs, repository, architecture, and test evidence in Devpost.
5. Rotate the ElevenLabs key after the demo because it previously appeared in
   plaintext during local setup; keep the replacement restricted to TTS and a
   small quota.
