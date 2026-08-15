"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { AlertTriangle, Database, Mic, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";

import DataDrawer, { type UploadStatus } from "./data-drawer";
import type { ComparisonData, Episode } from "./data/types";
import { isComparisonData } from "./data/validate";
import {
  ClusterPanel,
  EpisodesPanel,
  panelOptions,
  ProjectionPanel,
  ScoresPanel,
  type PanelId,
} from "./dashboard-panels";

type DashboardProps = { data: ComparisonData };
type DrawerKind = "data" | "voice" | null;
type DataOrigin = "initial" | "uploaded";

const FIXTURE_ID_RE = /^fold_[ab]_\d{3}$/;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const VoiceAgent = dynamic(() => import("./voice-agent"), {
  ssr: false,
  loading: () => (
    <section className="voice-agent-loading" aria-label="Loading voice analyst">
      <Mic aria-hidden="true" size={20} />
      <span>Loading the EgoPrism voice analyst…</span>
    </section>
  ),
});

function isFixtureData(data: ComparisonData) {
  return data.episodes.length > 0 && data.episodes.every((episode) => FIXTURE_ID_RE.test(episode.id));
}

function firstEpisode(data: ComparisonData) {
  return data.episodes.toSorted((a, b) => b.novelty - a.novelty)[0]!;
}

function CompactScore({
  label,
  score,
  active,
}: {
  label: string;
  score: number;
  active: boolean;
}) {
  return (
    <div className="compact-score" data-active={active}>
      <span>{label}</span>
      <strong>{score.toFixed(1)}</strong>
      <i><span style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></i>
    </div>
  );
}

export default function Dashboard({ data }: DashboardProps) {
  const initialFixture = isFixtureData(data);
  const [activeData, setActiveData] = useState(data);
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>("initial");
  const [datasetName, setDatasetName] = useState(
    initialFixture ? "Bundled fold-clothes fixture" : "Modal comparison",
  );
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(firstEpisode(data).id);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [mobilePanel, setMobilePanel] = useState<PanelId>("projection");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    state: "idle",
    message: "Expected: the JSON payload produced by EgoPrism’s comparison pipeline.",
  });

  const selectedEpisode =
    activeData.episodes.find((episode) => episode.id === selectedEpisodeId) ?? firstEpisode(activeData);
  const isDemoFixture = dataOrigin === "initial" && isFixtureData(activeData);
  const sourceLabel = dataOrigin === "uploaded"
    ? "Uploaded JSON"
    : activeData.source === "modal"
      ? "Modal live"
      : "Bundled cache";
  const winnerScore = activeData.winner === "A"
    ? activeData.subsetA.score
    : activeData.winner === "B"
      ? activeData.subsetB.score
      : Math.max(activeData.subsetA.score, activeData.subsetB.score);

  useEffect(() => {
    if (!drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawer]);

  const selectEpisode = (episode: Episode) => setSelectedEpisodeId(episode.id);

  const handleUpload = async (file: File) => {
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadStatus({ state: "error", message: "That file is larger than 25 MB. Upload the compact comparison JSON, not raw frames or Zarr." });
      return;
    }

    setUploadStatus({ state: "loading", message: `Validating ${file.name}…` });
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isComparisonData(parsed)) {
        throw new Error("The file is JSON, but it does not match the EgoPrism comparison schema.");
      }

      setActiveData(parsed);
      setDataOrigin("uploaded");
      setDatasetName(file.name);
      setSelectedEpisodeId(firstEpisode(parsed).id);
      setMobilePanel("projection");
      setUploadStatus({
        state: "success",
        message: `${file.name} is active. All four visualizations now use its ${parsed.episodes.length} episodes.`,
      });
    } catch (error) {
      setUploadStatus({
        state: "error",
        message: error instanceof Error ? error.message : "The comparison file could not be read.",
      });
    }
  };

  const resetDemo = () => {
    setActiveData(data);
    setDataOrigin("initial");
    setDatasetName(initialFixture ? "Bundled fold-clothes fixture" : "Modal comparison");
    setSelectedEpisodeId(firstEpisode(data).id);
    setMobilePanel("projection");
    setUploadStatus({ state: "idle", message: "Bundled comparison restored." });
  };

  return (
    <div className="cockpit-shell">
      <header className="cockpit-topbar">
        <div className="cockpit-brand">
          <Image src="/egoprism-mark.png" alt="" width={48} height={48} sizes="2.25rem" loading="eager" />
          <div><strong>EgoPrism</strong><span>Quantitative diversity workbench</span></div>
        </div>

        <div className="cockpit-context" aria-label="Current comparison">
          <span>{activeData.task.replaceAll("_", " ")}</span>
          <span>{activeData.episodes.length} episodes</span>
          <span>{activeData.quality}</span>
          <span data-fixture={isDemoFixture}>{sourceLabel}</span>
        </div>

        <nav className="cockpit-actions" aria-label="Dashboard actions">
          <button type="button" className="cockpit-button cockpit-button--quiet" onClick={() => setDrawer("data")}>
            <Database aria-hidden="true" size={17} />
            <span>Dataset</span>
          </button>
          <button type="button" className="cockpit-button cockpit-button--primary" onClick={() => setDrawer("voice")}>
            <Mic aria-hidden="true" size={17} />
            <span>Voice AI</span>
          </button>
        </nav>
      </header>

      <main className="cockpit-main">
        <section className="decision-strip" aria-label="Diversity decision">
          <div className="decision-strip__result">
            <span>Coverage decision</span>
            <strong>{activeData.winner === "tie" ? "No clear difference" : `Subset ${activeData.winner} wins`}</strong>
            <p>{activeData.statement}</p>
          </div>
          <div className="decision-strip__lead">
            <span>Leading score</span>
            <strong>{winnerScore.toFixed(1)}</strong>
            <small>out of 100</small>
          </div>
          <div className="decision-strip__scores">
            <CompactScore label="Subset A" score={activeData.subsetA.score} active={activeData.winner === "A"} />
            <CompactScore label="Subset B" score={activeData.subsetB.score} active={activeData.winner === "B"} />
          </div>
          <aside className="decision-strip__validity" data-fixture={isDemoFixture}>
            <AlertTriangle aria-hidden="true" size={17} />
            <div>
              <strong>{isDemoFixture ? "Demo-valid, not research-valid" : "User-provided comparison"}</strong>
              <span>{isDemoFixture ? "Synthetic fixtures · inspect methodology" : "Verify provenance before making a claim"}</span>
            </div>
            <button type="button" onClick={() => setDrawer("data")}>View data</button>
          </aside>
        </section>

        <nav className="panel-tabs" aria-label="Visualization panels">
          {panelOptions.map((option) => {
            const Icon = option.icon;
            return (
              <button
                type="button"
                key={option.id}
                data-active={mobilePanel === option.id}
                aria-pressed={mobilePanel === option.id}
                onClick={() => setMobilePanel(option.id)}
              >
                <Icon aria-hidden="true" size={15} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </nav>

        <section className="viz-grid" data-active-panel={mobilePanel} aria-label="Four-part diversity analysis">
          <ProjectionPanel data={activeData} selectedEpisode={selectedEpisode} onSelect={selectEpisode} />
          <ClusterPanel data={activeData} />
          <ScoresPanel data={activeData} />
          <EpisodesPanel data={activeData} selectedEpisode={selectedEpisode} onSelect={selectEpisode} />
        </section>

        <footer className="cockpit-footer">
          <span>Near = visually similar · spread = broader coverage · numeral = cluster</span>
          <span>score = {Math.round(activeData.method.visualWeight * 100)}% visual + {Math.round(activeData.method.motionWeight * 100)}% motion</span>
          <span>Uploads never use an LLM to score data</span>
        </footer>
      </main>

      <DataDrawer
        open={drawer === "data"}
        data={activeData}
        datasetName={datasetName}
        isDemoFixture={isDemoFixture}
        uploadStatus={uploadStatus}
        onUpload={(file) => void handleUpload(file)}
        onReset={resetDemo}
        onClose={() => setDrawer(null)}
      />

      {drawer === "voice" ? (
        <div className="drawer-layer">
          <button type="button" className="drawer-scrim" onClick={() => setDrawer(null)} aria-label="Close voice assistant" />
          <aside className="side-drawer side-drawer--voice" role="dialog" aria-modal="true" aria-label="EgoPrism voice analyst">
            <header className="side-drawer__head">
              <div><span>ElevenLabs</span><h2>Voice analyst</h2></div>
              <button type="button" onClick={() => setDrawer(null)} aria-label="Close voice assistant"><X aria-hidden="true" size={20} /></button>
            </header>
            <div className="side-drawer__body">
              {dataOrigin === "uploaded" ? (
                <div className="voice-context-note">
                  <Upload aria-hidden="true" size={16} />
                  <span>Method answers remain valid. Numeric voice answers currently describe the shipped demo; use the four panels for uploaded results.</span>
                </div>
              ) : null}
              <VoiceAgent />
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
