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
        ├── server-only ElevenLabs briefing route
        └── grounded question route + ElevenLabs spoken-answer route
```

## Dashboard design mandate

Use [Hallmark](https://github.com/Nutlope/hallmark) as the dashboard taste and
interaction system. The implementation is a modern-minimal **Workbench** using
Hallmark's **Cobalt** theme, N13 command navigation, Ft2 footer, real episode
frames, semantic OKLCH tokens, restrained motion, strong focus states, and
responsive layouts from 320 px upward.

The dashboard must remain functional, not decorative. The shipped interaction
contract is a fixed, single-viewport evidence cockpit:

- Lead with a compact decision strip containing the winner, score gap, and 95%
  bootstrap context.
- Keep four visualization sections visible together on desktop: embedding,
  cluster coverage, score confidence, and representative episodes.
- Use four compact tabs on small screens so each visualization still fits without
  page-level vertical scrolling.
- Make projection points and episode thumbnails selectable and linked to the same
  active episode.
- Default to a deterministic 12,000-record synthetic summary corpus—6,000 per
  subset—expanded from the 32 schema-faithful raw prototypes. Accept a
  schema-compatible comparison JSON file and immediately redraw every panel in
  the browser.
- Put the active dataset summary, upload/reset controls, and complete episode
  table in an internally scrolling right-side drawer.
- Put the continuous ElevenLabs analyst in a compact top-right answer bubble so
  it never covers the evidence grid. Show only the latest assistant answer and
  keep that answer visible after **End conversation** stops the microphone and audio.
- Keep the exact scoring method and limitation in the repository guide and voice
  knowledge, while using concise chart-level explanations in the cockpit.
- Keep ElevenLabs behind a Vercel server route; never expose the key to the browser.
- Use the generated `/og.png` social card in Open Graph and Twitter metadata.

## Build status

- [x] Schema-faithful 32-episode demo fixture and manifests.
- [x] Deterministic 12,000-record web scale corpus with full-data aggregate
  charts, a 320-point stratified projection, and a searchable paginated index.
- [x] Deterministic extraction, feature, clustering, scoring, and bootstrap pipeline.
- [x] Streamlit reference dashboard and optional local voice briefing.
- [x] Serializable web payload and regression tests.
- [x] Modal read-only comparison API backed by the `egoverse-data` volume.
- [x] Hallmark/Cobalt Next.js dashboard with real episode frames.
- [x] Fixed single-viewport four-panel visualization cockpit with no page-level
  scrolling at supported desktop and mobile sizes.
- [x] Browser-local comparison JSON upload, strict runtime validation, demo reset,
  dataset summary, and complete dataset side drawer.
- [x] Server-only ElevenLabs briefing route and non-secret health endpoint.
- [x] Continuous grounded voice analyst with automatic listen-after-answer, an
  answer-only transcript bubble, and an explicit end-conversation control.
- [x] Vercel project link and production environment variables.
- [x] Production Vercel deployment and final live smoke test.
- [ ] Submission video, Devpost copy, screenshots, and final rules check.

- Production dashboard: [egoprism.vercel.app](https://egoprism.vercel.app)
- Production data API: [Modal summary](https://ts5789--egoprism-api-summary.modal.run)

## Verification gates

- `pytest -q` passes the Python pipeline and web-payload tests.
- `npm run typecheck` and `npm run build` pass under `web/`.
- Modal `/summary` responds with the 32 raw demo prototypes and deterministic
  winner; the web layer recognizes that demo payload and expands it to 12,000
  unique synthetic summaries before rendering.
- Vercel `/api/health` reports Modal and ElevenLabs configured without returning
  secret values.
- Vercel `/api/voice` returns MP3 audio from the fixed result briefing.
- Vercel `/api/voice-agent/answer` maps questions to verified project facts.
- Vercel `/api/voice-agent/speak` returns ElevenLabs MP3 audio while the API key
  remains server-only.
- The live dashboard has no console errors, no horizontal overflow at 320, 375,
  414, 768, 1280, and 1920 px, no page-level vertical overflow, and all clickable
  labels remain on one line. Drawer contents may scroll internally.
- Hallmark's pre-emit critique and 58-gate slop test pass before handoff.

## Before submission

1. Replace synthetic fixture manifests with an approved real slice if competition
   rules or judging expectations require it; never silently mix fixture and real data.
2. Record a 60–90 second demo: decision → evidence → episode trace → ask the
   voice analyst why B won.
3. Explain the pooled transform, score formula, winner rule, and limitation.
4. Include deployment URLs, repository, architecture, and test evidence in Devpost.
5. Rotate the ElevenLabs key after the demo because it previously appeared in
   plaintext during local setup; keep the replacement restricted to TTS with
   conservative usage limits.

## Data input boundary

The cockpit accepts the serialized `ComparisonData` JSON contract produced by
the EgoPrism pipeline. This is the safe browser input because it contains scored
episode summaries and visualization coordinates, not the large raw tensors.
Raw EgoVerse zarr data must first run through the Python/Modal extraction and
scoring pipeline; the generated comparison JSON can then be opened from the
dataset drawer. Uploads stay in the current browser session and are never sent
to ElevenLabs.
