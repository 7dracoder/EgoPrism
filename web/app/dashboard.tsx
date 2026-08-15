"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  CircleHelp,
  Database,
  ExternalLink,
  Layers3,
  Mic,
  Play,
  Search,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type { ComparisonData, Episode, Occupancy } from "./data/types";

type DashboardProps = { data: ComparisonData };
type SubsetFilter = "All" | "A" | "B";
type VoiceState = "idle" | "loading" | "success" | "error";

const percent = (value: number | null) =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

const commandItems = [
  { label: "View decision", detail: "Scores and confidence intervals", href: "#decision" },
  { label: "Inspect evidence", detail: "Visual projection and cluster occupancy", href: "#evidence" },
  { label: "Ask EgoPrism", detail: "Question the result with the voice analyst", href: "#voice-agent" },
  { label: "Browse episodes", detail: "Filter novelty-ranked examples", href: "#episodes" },
  { label: "Read method", detail: "Formula, thresholds, and limitations", href: "#method" },
];

const VoiceAgent = dynamic(() => import("./voice-agent"), {
  ssr: false,
  loading: () => (
    <section className="voice-agent-loading" aria-label="Loading voice analyst">
      <Mic aria-hidden="true" size={20} />
      <span>Loading the EgoPrism voice analyst…</span>
    </section>
  ),
});

function occupancyCount(items: Occupancy[], cluster: number) {
  return items.find((item) => item.cluster === cluster)?.count ?? 0;
}

function ScatterPlot({
  episodes,
  selected,
  onSelect,
}: {
  episodes: Episode[];
  selected: string;
  onSelect: (episode: Episode) => void;
}) {
  const positioned = useMemo(() => {
    const xs = episodes.map((episode) => episode.x);
    const ys = episodes.map((episode) => episode.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const xRange = maxX - minX || 1;
    const yRange = maxY - minY || 1;
    return episodes.map((episode) => ({
      episode,
      left: 5 + ((episode.x - minX) / xRange) * 90,
      top: 6 + (1 - (episode.y - minY) / yRange) * 88,
    }));
  }, [episodes]);

  return (
    <div className="scatter" role="group" aria-label="Visual embedding projection">
      <div className="scatter__axis scatter__axis--x">visual dimension 1</div>
      <div className="scatter__axis scatter__axis--y">visual dimension 2</div>
      {positioned.map(({ episode, left, top }) => (
        <button
          type="button"
          key={episode.id}
          className="scatter__hit"
          data-subset={episode.subset}
          data-selected={selected === episode.id}
          style={{ "--point-x": `${left}%`, "--point-y": `${top}%` } as CSSProperties}
          aria-label={`${episode.id}, subset ${episode.subset}, visual cluster ${episode.visualCluster + 1}`}
          onClick={() => onSelect(episode)}
        >
          <span>{episode.visualCluster + 1}</span>
        </button>
      ))}
    </div>
  );
}

export default function Dashboard({ data }: DashboardProps) {
  const [subset, setSubset] = useState<SubsetFilter>("All");
  const [cluster, setCluster] = useState("All");
  const [lab, setLab] = useState("All");
  const initialEpisode = [...data.episodes].sort((a, b) => b.novelty - a.novelty)[0];
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(initialEpisode?.id ?? "");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceMessage, setVoiceMessage] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const commandRef = useRef<HTMLDialogElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);

  const selectedEpisode =
    data.episodes.find((episode) => episode.id === selectedEpisodeId) ?? initialEpisode;
  const labs = useMemo(
    () => Array.from(new Set(data.episodes.map((episode) => episode.lab))).sort(),
    [data.episodes],
  );
  const visibleCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    return query
      ? commandItems.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query))
      : commandItems;
  }, [commandQuery]);

  const filteredEpisodes = useMemo(
    () =>
      data.episodes
        .filter((episode) => subset === "All" || episode.subset === subset)
        .filter((episode) => cluster === "All" || episode.visualCluster === Number(cluster))
        .filter((episode) => lab === "All" || episode.lab === lab)
        .sort((a, b) => b.novelty - a.novelty),
    [cluster, data.episodes, lab, subset],
  );

  const openCommand = useCallback(() => {
    const dialog = commandRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setCommandOpen(true);
    setCommandQuery("");
    setCommandIndex(0);
    requestAnimationFrame(() => commandInputRef.current?.focus());
  }, []);

  const closeCommand = useCallback(() => {
    commandRef.current?.close();
    setCommandOpen(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        commandOpen ? closeCommand() : openCommand();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCommand, commandOpen, openCommand]);

  useEffect(() => {
    setCommandIndex(0);
  }, [commandQuery]);

  useEffect(() => {
    if (!audioUrl) return;
    audioRef.current?.play().catch(() => undefined);
    return () => URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const runCommand = (href: string) => {
    closeCommand();
    requestAnimationFrame(() => document.querySelector(href)?.scrollIntoView({ behavior: "smooth" }));
  };

  const onCommandKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setCommandIndex((index) => Math.min(index + 1, visibleCommands.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCommandIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && visibleCommands[commandIndex]) {
      event.preventDefault();
      runCommand(visibleCommands[commandIndex].href);
    }
  };

  const playBriefing = async () => {
    setVoiceState("loading");
    setVoiceMessage("Generating the fixed result briefing…");
    try {
      const response = await fetch("/api/voice");
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error || "The voice briefing could not be generated.");
      }
      const nextAudioUrl = URL.createObjectURL(await response.blob());
      setAudioUrl(nextAudioUrl);
      setVoiceState("success");
      setVoiceMessage("Briefing ready. Playback started.");
    } catch (error) {
      setVoiceState("error");
      setVoiceMessage(
        error instanceof Error
          ? error.message
          : "The voice briefing failed. Check the server configuration and try again.",
      );
    }
  };

  const delta = data.subsetB.score - data.subsetA.score;
  const winningSubset = data.winner === "tie" ? null : data.winner === "A" ? data.subsetA : data.subsetB;
  const maxOccupancy = Math.max(
    ...data.subsetA.visualOccupancy.map((item) => item.count),
    ...data.subsetB.visualOccupancy.map((item) => item.count),
    1,
  );
  const sourceLabel = data.source === "modal" ? "Modal live" : "Bundled cache";
  const voiceLabel =
    voiceState === "loading"
      ? "Generating…"
      : voiceState === "success"
        ? "Play again"
        : voiceState === "error"
          ? "Retry briefing"
          : "Play briefing";

  return (
    <>
      <header className="topbar">
        <a className="wordmark" href="#decision" aria-label="EgoPrism home">
          <span className="wordmark__mark">E</span>
          <span>EgoPrism</span>
        </a>
        <button type="button" className="search-pill" onClick={openCommand} aria-label="Open command palette">
          <Search aria-hidden="true" size={16} />
          <span className="search-pill__text">Jump to evidence…</span>
          <kbd>⌘ K</kbd>
        </button>
        <nav className="topbar__actions" aria-label="Primary navigation">
          <a href="#evidence">Evidence</a>
          <a href="#episodes">Episodes</a>
          <a className="button button--primary" href="#voice-agent" aria-label="Ask EgoPrism by voice">
            <Mic aria-hidden="true" size={16} />
            <span>Ask AI</span>
          </a>
        </nav>
      </header>

      <main className="dashboard-shell" id="decision">
        <div className="run-strip" aria-label="Comparison status">
          <span><Database aria-hidden="true" size={15} /> {sourceLabel}</span>
          <span>{data.task}</span>
          <span>{data.episodes.length} episodes</span>
          <span>{data.quality}</span>
        </div>

        <section className="hero reveal">
          <div className="hero__copy">
            <h1>Measure coverage. Pick the broader slice.</h1>
            <p>
              Compare frozen, task-matched EgoVerse subsets using image and motion clusters—not
              captions, metadata counts, or an LLM judge.
            </p>
            <div className="hero__actions">
              <button
                type="button"
                className="button button--primary"
                data-state={voiceState}
                disabled={voiceState === "loading"}
                onClick={playBriefing}
              >
                {voiceState === "loading" ? (
                  <Activity className="spinner" aria-hidden="true" size={17} />
                ) : (
                  <Play aria-hidden="true" size={17} />
                )}
                <span>{voiceLabel}</span>
              </button>
              <a className="text-link" href="#evidence">Inspect the evidence <ArrowDown aria-hidden="true" size={16} /></a>
            </div>
            <div className="voice-status" data-state={voiceState} aria-live="polite">
              {voiceMessage && (
                <span>{voiceState === "success" && <Check aria-hidden="true" size={16} />} {voiceMessage}</span>
              )}
              {audioUrl && <audio ref={audioRef} controls src={audioUrl} aria-label="EgoPrism result briefing" />}
            </div>
          </div>

          <div className="decision-panel" aria-label="Diversity decision">
            <div className="decision-panel__meta">
              <span>Decision</span>
              <span>95% bootstrap CI</span>
            </div>
            {winningSubset ? (
              <>
                <div className="decision-panel__winner">Subset {data.winner}</div>
                <div className="decision-panel__score">{winningSubset.score.toFixed(1)}</div>
                <p>{data.statement}</p>
                <div className="decision-panel__delta">
                  <span>Score gap</span>
                  <strong>{delta > 0 ? "+" : ""}{delta.toFixed(1)} points</strong>
                </div>
              </>
            ) : (
              <>
                <div className="decision-panel__winner">No clear difference</div>
                <p>{data.statement}</p>
              </>
            )}
          </div>
        </section>

        <section className="comparison-sheet" aria-label="Subset comparison">
          {[data.subsetA, data.subsetB].map((item) => (
            <article className="comparison-row" key={item.name} data-subset={item.name}>
              <div className="comparison-row__name">
                <span>Subset {item.name}</span>
                <small>{item.scenes} {item.scenes === 1 ? "scene" : "scenes"} · {item.labs} {item.labs === 1 ? "lab" : "labs"}</small>
              </div>
              <div className="comparison-row__score">{item.score.toFixed(1)}</div>
              <div className="comparison-row__bar" aria-label={`Subset ${item.name} score ${item.score.toFixed(1)} out of 100`}>
                <span style={{ "--score-width": `${item.score}%` } as CSSProperties} />
              </div>
              <div className="comparison-row__ci">CI {item.ci[0].toFixed(1)}–{item.ci[1].toFixed(1)}</div>
              <div className="comparison-row__entropy">
                <span>visual {percent(item.visualEntropy)}</span>
                <span>motion {percent(item.motionEntropy)}</span>
              </div>
            </article>
          ))}
        </section>

        <p className="qualification">
          Higher means broader cluster coverage. It does not guarantee better downstream policy performance.
        </p>

        <section className="evidence-band" id="evidence">
          <div className="evidence-band__head">
            <div>
              <h2>See where the coverage comes from.</h2>
              <p>Every mark is one episode. Shape identifies subset; the numeral identifies visual cluster.</p>
            </div>
            <div className="legend" aria-label="Plot legend">
              <span><i data-subset="A" /> Subset A</span>
              <span><i data-subset="B" /> Subset B</span>
            </div>
          </div>

          <div className="evidence-grid">
            <article className="plot-panel">
              <div className="plot-panel__title">
                <span>Visual projection</span>
                <small>Pooled PCA · click a point</small>
              </div>
              <ScatterPlot
                episodes={data.episodes}
                selected={selectedEpisode?.id ?? ""}
                onSelect={(episode) => setSelectedEpisodeId(episode.id)}
              />
              {selectedEpisode && (
                <div className="selected-readout" aria-live="polite">
                  <span>Selected</span>
                  <strong>{selectedEpisode.id}</strong>
                  <span>cluster {selectedEpisode.visualCluster + 1}</span>
                  <span>{selectedEpisode.scene.replace("_", " ")}</span>
                </div>
              )}
            </article>

            <article className="occupancy-panel">
              <div className="plot-panel__title">
                <span>Visual cluster occupancy</span>
                <small>episodes per cluster</small>
              </div>
              <div className="occupancy-list">
                {Array.from({ length: data.clusterCount }, (_, clusterIndex) => {
                  const countA = occupancyCount(data.subsetA.visualOccupancy, clusterIndex);
                  const countB = occupancyCount(data.subsetB.visualOccupancy, clusterIndex);
                  return (
                    <div className="occupancy-row" key={clusterIndex}>
                      <span className="occupancy-row__label">C{clusterIndex + 1}</span>
                      <div className="occupancy-row__tracks">
                        <div className="track" data-subset="A"><span style={{ "--bar-width": `${(countA / maxOccupancy) * 100}%` } as CSSProperties} /></div>
                        <div className="track" data-subset="B"><span style={{ "--bar-width": `${(countB / maxOccupancy) * 100}%` } as CSSProperties} /></div>
                      </div>
                      <span className="occupancy-row__count">{countA} / {countB}</span>
                    </div>
                  );
                })}
              </div>
              <div className="coverage-readout">
                <div><span>A clusters</span><strong>{data.subsetA.visualClustersUsed}/{data.clusterCount}</strong></div>
                <div><span>B clusters</span><strong>{data.subsetB.visualClustersUsed}/{data.clusterCount}</strong></div>
                <div><span>Median idle A</span><strong>{percent(data.subsetA.medianIdleFraction)}</strong></div>
                <div><span>Median idle B</span><strong>{percent(data.subsetB.medianIdleFraction)}</strong></div>
              </div>
            </article>
          </div>
        </section>

        <section className="method-section" id="method">
          <div className="section-head">
            <h2>The score stays inspectable.</h2>
            <p>One pooled transform, one documented formula, and episode-level evidence behind every point.</p>
          </div>
          <div className="method-grid">
            <dl className="spec-sheet">
              <div><dt>Visual signal</dt><dd>8 sampled frames · stored DINO vectors</dd><dd>{Math.round(data.method.visualWeight * 100)}% weight</dd></div>
              <div><dt>Motion signal</dt><dd>Hand paths · speed · idle · head pose</dd><dd>{Math.round(data.method.motionWeight * 100)}% weight</dd></div>
              <div><dt>Coverage</dt><dd>Normalized cluster entropy</dd><dd>K = {data.clusterCount}</dd></div>
              <div><dt>Uncertainty</dt><dd>{data.method.bootstrapSamples} episode bootstraps</dd><dd>{Math.round(data.method.confidenceLevel * 100)}% CI</dd></div>
              <div><dt>Winner rule</dt><dd>Intervals separate</dd><dd>gap ≥ {data.method.minimumWinnerGap.toFixed(0)} pts</dd></div>
            </dl>
            <aside className="method-note">
              <CircleHelp aria-hidden="true" size={21} />
              <h3>What the score does not claim</h3>
              <p>A broader slice can expose a model to more contexts and motion styles. It is still not a substitute for downstream policy evaluation.</p>
              <details>
                <summary>Read the exact formula</summary>
                <code>score = 50 × H(visual clusters) + 50 × H(motion clusters)</code>
              </details>
            </aside>
          </div>
        </section>

        <VoiceAgent />

        <section className="episodes-section" id="episodes">
          <div className="section-head section-head--episodes">
            <div>
              <h2>Trace the result back to episodes.</h2>
              <p>Examples are ranked by distance from their cluster centre, then filtered without changing the score.</p>
            </div>
            <span className="result-count" aria-live="polite">{filteredEpisodes.length} matches</span>
          </div>

          <div className="filters" aria-label="Episode filters">
            <fieldset className="segmented-filter">
              <legend>Subset</legend>
              <div>
                {(["All", "A", "B"] as const).map((option) => (
                  <button
                    type="button"
                    key={option}
                    data-active={subset === option}
                    aria-pressed={subset === option}
                    onClick={() => setSubset(option)}
                  >
                    {option === "All" ? "Both" : `Subset ${option}`}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="select-filter">
              <span>Visual cluster</span>
              <select value={cluster} onChange={(event) => setCluster(event.target.value)}>
                <option value="All">All clusters</option>
                {Array.from({ length: data.clusterCount }, (_, index) => (
                  <option value={index} key={index}>Cluster {index + 1}</option>
                ))}
              </select>
            </label>
            <label className="select-filter">
              <span>Lab</span>
              <select value={lab} onChange={(event) => setLab(event.target.value)}>
                <option value="All">All labs</option>
                {labs.map((option) => <option value={option} key={option}>{option.replace("_", " ")}</option>)}
              </select>
            </label>
          </div>

          {filteredEpisodes.length ? (
            <div className="episode-grid">
              {filteredEpisodes.slice(0, 12).map((episode) => (
                <article className="episode-card" key={episode.id} data-subset={episode.subset}>
                  <figure>
                    <Image
                      src={episode.preview}
                      alt={`Representative frame from ${episode.id}`}
                      width={640}
                      height={480}
                      sizes="(min-width: 64rem) 30vw, (min-width: 40rem) 48vw, 100vw"
                    />
                    <figcaption>Subset {episode.subset}</figcaption>
                  </figure>
                  <div className="episode-card__body">
                    <div><strong>{episode.id}</strong><span>{episode.scene.replace("_", " ")} · {episode.lab.replace("_", " ")}</span></div>
                    <dl>
                      <div><dt>cluster</dt><dd>{episode.visualCluster + 1}</dd></div>
                      <div><dt>novelty</dt><dd>{episode.novelty.toFixed(2)}</dd></div>
                      <div><dt>idle</dt><dd>{percent(episode.idleFraction)}</dd></div>
                    </dl>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Layers3 aria-hidden="true" size={26} />
              <h3>No episodes match these filters.</h3>
              <p>Reset the subset, cluster, or lab filter to restore the evidence set.</p>
              <button type="button" className="button button--secondary" onClick={() => { setSubset("All"); setCluster("All"); setLab("All"); }}>
                Reset filters
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="footer-line">
        <span>EgoPrism</span>
        <span>Track 2 · quantitative diversity</span>
        <a href="https://github.com/Nutlope/hallmark" target="_blank" rel="noreferrer">Hallmark system <ExternalLink aria-hidden="true" size={14} /></a>
      </footer>

      <dialog
        ref={commandRef}
        className="command-dialog"
        onCancel={() => setCommandOpen(false)}
        onClick={(event) => { if (event.currentTarget === event.target) closeCommand(); }}
      >
        <div className="command-dialog__panel">
          <div className="command-search">
            <Search aria-hidden="true" size={19} />
            <label htmlFor="command-query">Find a dashboard section</label>
            <input
              ref={commandInputRef}
              id="command-query"
              value={commandQuery}
              onChange={(event) => setCommandQuery(event.target.value)}
              onKeyDown={onCommandKey}
              placeholder="Evidence, episodes, method…"
              autoComplete="off"
            />
            <button type="button" onClick={closeCommand} aria-label="Close command palette"><X aria-hidden="true" size={18} /></button>
          </div>
          <div className="command-results" role="listbox" aria-label="Dashboard sections">
            {visibleCommands.map((item, index) => (
              <button
                type="button"
                role="option"
                aria-selected={commandIndex === index}
                data-active={commandIndex === index}
                key={item.href}
                onMouseEnter={() => setCommandIndex(index)}
                onClick={() => runCommand(item.href)}
              >
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
                <span>↵</span>
              </button>
            ))}
          </div>
          <div className="command-footer">
            <span><kbd><ArrowUp aria-hidden="true" size={12} /></kbd><kbd><ArrowDown aria-hidden="true" size={12} /></kbd> navigate</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </div>
      </dialog>
    </>
  );
}
