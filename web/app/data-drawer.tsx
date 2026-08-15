"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  FileJson,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { useDeferredValue, useMemo, useRef, useState, type DragEvent } from "react";

import type { ComparisonData } from "./data/types";

const TABLE_PAGE_SIZE = 100;

export type UploadStatus =
  | { state: "idle"; message: string }
  | { state: "loading"; message: string }
  | { state: "success"; message: string }
  | { state: "error"; message: string };

export default function DataDrawer({
  open,
  data,
  datasetName,
  isInitialDataset,
  isProductionDataset,
  uploadStatus,
  onUpload,
  onReset,
  onClose,
}: {
  open: boolean;
  data: ComparisonData;
  datasetName: string;
  isInitialDataset: boolean;
  isProductionDataset: boolean;
  uploadStatus: UploadStatus;
  onUpload: (file: File) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const filteredEpisodes = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase();
    if (!normalized) return data.episodes;
    return data.episodes.filter((episode) =>
      episode.id.toLowerCase().includes(normalized) ||
      episode.subset.toLowerCase() === normalized ||
      episode.scene.toLowerCase().includes(normalized) ||
      episode.lab.toLowerCase().includes(normalized) ||
      episode.source?.toLowerCase().includes(normalized) ||
      episode.task?.toLowerCase().includes(normalized)
    );
  }, [data.episodes, deferredQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredEpisodes.length / TABLE_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleEpisodes = useMemo(
    () => filteredEpisodes.slice((currentPage - 1) * TABLE_PAGE_SIZE, currentPage * TABLE_PAGE_SIZE),
    [currentPage, filteredEpisodes],
  );
  const firstVisibleRow = filteredEpisodes.length === 0
    ? 0
    : (currentPage - 1) * TABLE_PAGE_SIZE + 1;
  const lastVisibleRow = Math.min(currentPage * TABLE_PAGE_SIZE, filteredEpisodes.length);

  if (!open) return null;

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) onUpload(file);
  };

  return (
    <div className="drawer-layer">
      <button type="button" className="drawer-scrim" onClick={onClose} aria-label="Close dataset drawer" />
      <aside className="side-drawer side-drawer--data" role="dialog" aria-modal="true" aria-labelledby="data-drawer-title">
        <header className="side-drawer__head">
          <div>
            <span>Data workspace</span>
            <h2 id="data-drawer-title">View or replace the dataset</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close dataset drawer"><X aria-hidden="true" size={20} /></button>
        </header>

        <div className="side-drawer__body">
          <section className="dataset-current" data-fixture={false}>
            <div className="dataset-current__head">
              <span><Database aria-hidden="true" size={17} /> Active dataset</span>
              <small>{isProductionDataset ? "Production R2 · Modal" : isInitialDataset ? "Bundled cache" : "Uploaded JSON"}</small>
            </div>
            <strong>{datasetName}</strong>
            <p>{data.task} · {data.episodes.length.toLocaleString()} episodes · {data.quality}</p>
            {isProductionDataset ? <p className="dataset-current__provenance">Every row is an independent EgoVerse production Zarr episode. A is a 6,000-episode Scale baseline; B is a 6,000-episode Aria/Eva/Scale slice with identical task-family quotas and matched duration. No episode is repeated.</p> : null}
            <div>
              <span>A: {data.subsetA.episodes.toLocaleString()} episodes</span>
              <span>B: {data.subsetB.episodes.toLocaleString()} episodes</span>
              <span>K = {data.clusterCount}</span>
              <span>{data.method.bootstrapSamples} bootstraps</span>
            </div>
          </section>

          <section className="dataset-upload" aria-labelledby="upload-title">
            <div className="drawer-section-title">
              <span>Input data</span>
              <h3 id="upload-title">Upload an EgoPrism comparison JSON</h3>
              <p>The uploaded file is validated and stays in this browser tab. It immediately replaces the initial comparison across all four visualizations.</p>
            </div>
            <div
              className="upload-dropzone"
              data-dragging={dragging}
              data-state={uploadStatus.state}
              onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <FileJson aria-hidden="true" size={28} />
              <strong>Drop comparison JSON here</strong>
              <span>or choose a file · maximum 25 MB</span>
              <button
                type="button"
                className="cockpit-button cockpit-button--primary"
                disabled={uploadStatus.state === "loading"}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload aria-hidden="true" size={16} />
                {uploadStatus.state === "loading" ? "Validating…" : "Choose JSON"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(file);
                  event.target.value = "";
                }}
              />
            </div>
            <p className="upload-status" data-state={uploadStatus.state} aria-live="polite">
              {uploadStatus.state === "success" ? <CheckCircle2 aria-hidden="true" size={15} /> : null}
              {uploadStatus.state === "error" ? <AlertTriangle aria-hidden="true" size={15} /> : null}
              {uploadStatus.message}
            </p>
            {!isInitialDataset ? (
              <button type="button" className="cockpit-button cockpit-button--quiet" onClick={onReset}>
                <RotateCcw aria-hidden="true" size={16} /> Restore initial dataset
              </button>
            ) : null}
          </section>

          <aside className="raw-data-note">
            <ShieldCheck aria-hidden="true" size={18} />
            <div>
              <strong>Why JSON instead of raw Zarr?</strong>
              <p>Raw EgoVerse Zarr needs Python feature extraction and clustering. Run the existing pipeline first, then upload its comparison payload here. The browser never pretends to score raw video by itself.</p>
            </div>
          </aside>

          <section className="dataset-table-section" aria-labelledby="dataset-table-title">
            <div className="drawer-section-title drawer-section-title--row">
              <div><span>Dataset used</span><h3 id="dataset-table-title">Episode index</h3></div>
              <small>{data.episodes.length.toLocaleString()} total</small>
            </div>
            <div className="dataset-table-tools">
              <label>
                <Search aria-hidden="true" size={15} />
                <span className="sr-only">Search episodes</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Search ID, source, task, scene, or lab"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <span>{firstVisibleRow.toLocaleString()}–{lastVisibleRow.toLocaleString()} of {filteredEpisodes.length.toLocaleString()}</span>
            </div>
            <div className="dataset-table-wrap">
              <table className="dataset-table">
                <thead><tr><th>Episode</th><th>Set</th><th>Source / task</th><th>Visual</th><th>Motion</th></tr></thead>
                <tbody>
                  {visibleEpisodes.map((episode) => (
                    <tr key={episode.id}>
                      <td>{episode.id}</td>
                      <td><span data-subset={episode.subset}>{episode.subset}</span></td>
                      <td>{(episode.source || episode.lab).replaceAll("_", " ")} · {(episode.task || episode.scene).replaceAll("_", " ")}</td>
                      <td>C{episode.visualCluster + 1}</td>
                      <td>{episode.motionCluster >= 0 ? `C${episode.motionCluster + 1}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <nav className="dataset-pagination" aria-label="Episode table pages">
              <button
                type="button"
                aria-label="Previous episode page"
                disabled={currentPage === 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
              >
                <ChevronLeft aria-hidden="true" size={16} />
              </button>
              <span>Page {currentPage.toLocaleString()} of {pageCount.toLocaleString()}</span>
              <button
                type="button"
                aria-label="Next episode page"
                disabled={currentPage === pageCount}
                onClick={() => setPage(Math.min(pageCount, currentPage + 1))}
              >
                <ChevronRight aria-hidden="true" size={16} />
              </button>
            </nav>
          </section>
        </div>
      </aside>
    </div>
  );
}
