"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { Database, Mic } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import DataDrawer, { type UploadStatus } from "./data-drawer";
import { scaleDemoComparison, SCALED_DEMO_SOURCE } from "./data/scale-demo";
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

const FIXTURE_ID_RE = /^fold_[ab]_\d{3,5}$/;
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
  let mostNovel = data.episodes[0]!;
  for (let index = 1; index < data.episodes.length; index += 1) {
    if (data.episodes[index]!.novelty > mostNovel.novelty) mostNovel = data.episodes[index]!;
  }
  return mostNovel;
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
  const initialData = useMemo(() => scaleDemoComparison(data), [data]);
  const initialFixture = useMemo(() => isFixtureData(initialData), [initialData]);
  const [activeData, setActiveData] = useState(initialData);
  const [dataOrigin, setDataOrigin] = useState<DataOrigin>("initial");
  const [datasetName, setDatasetName] = useState(
    initialFixture ? "12K synthetic fold-clothes corpus" : "Modal comparison",
  );
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(firstEpisode(initialData).id);
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [mobilePanel, setMobilePanel] = useState<PanelId>("projection");
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    state: "idle",
    message: "Expected: the JSON payload produced by EgoPrism’s comparison pipeline.",
  });

  const episodeById = useMemo(
    () => new Map(activeData.episodes.map((episode) => [episode.id, episode])),
    [activeData.episodes],
  );
  const selectedEpisode = episodeById.get(selectedEpisodeId) ?? firstEpisode(activeData);
  const isDemoFixture = dataOrigin === "initial" && initialFixture;
  const sourceLabel = dataOrigin === "uploaded"
    ? "Uploaded JSON"
    : activeData.source === SCALED_DEMO_SOURCE
      ? "12K active dataset"
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
        message: `${file.name} is active. All four visualizations now use its ${parsed.episodes.length.toLocaleString()} episodes.`,
      });
    } catch (error) {
      setUploadStatus({
        state: "error",
        message: error instanceof Error ? error.message : "The comparison file could not be read.",
      });
    }
  };

  const resetDemo = () => {
    setActiveData(initialData);
    setDataOrigin("initial");
    setDatasetName(initialFixture ? "12K synthetic fold-clothes corpus" : "Modal comparison");
    setSelectedEpisodeId(firstEpisode(initialData).id);
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
          <span>{activeData.episodes.length.toLocaleString()} episodes</span>
          <span>{activeData.quality}</span>
          <span>{sourceLabel}</span>
        </div>

        <nav className="cockpit-actions" aria-label="Dashboard actions">
          <button type="button" className="cockpit-button cockpit-button--quiet" onClick={() => setDrawer("data")}>
            <Database aria-hidden="true" size={17} />
            <span>Dataset</span>
          </button>
          <button
            type="button"
            className="cockpit-button cockpit-button--primary"
            aria-controls="voice-answer-tooltip"
            aria-expanded={drawer === "voice"}
            onClick={() => setDrawer((current) => current === "voice" ? null : "voice")}
          >
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
        <aside
          id="voice-answer-tooltip"
          className="voice-tooltip"
          role="dialog"
          aria-label="EgoPrism voice analyst"
        >
          <VoiceAgent />
        </aside>
      ) : null}
    </div>
  );
}
