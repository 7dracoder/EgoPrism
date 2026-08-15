export type Occupancy = {
  cluster: number;
  count: number;
};

export type SubsetSummary = {
  name: "A" | "B";
  score: number;
  ci: [number, number];
  episodes: number;
  scenes: number;
  labs: number;
  durationSeconds: number;
  visualEntropy: number;
  motionEntropy: number | null;
  visualClustersUsed: number;
  motionClustersUsed: number;
  visualOccupancy: Occupancy[];
  motionOccupancy: Occupancy[];
  medianIdleFraction: number | null;
};

export type Episode = {
  id: string;
  subset: "A" | "B";
  lab: string;
  scene: string;
  source?: string;
  task?: string;
  durationSeconds: number;
  visualCluster: number;
  motionCluster: number;
  x: number;
  y: number;
  novelty: number;
  idleFraction: number | null;
  preview: string;
};

export type ComparisonData = {
  project: "EgoPrism";
  source: string;
  task: string;
  quality: string;
  winner: "A" | "B" | "tie";
  statement: string;
  notes: string[];
  clusterCount: number;
  visualOnly: boolean;
  subsetA: SubsetSummary;
  subsetB: SubsetSummary;
  episodes: Episode[];
  method: {
    visualWeight: number;
    motionWeight: number;
    bootstrapSamples: number;
    confidenceLevel: number;
    minimumWinnerGap: number;
    idleSpeedThresholdMps: number;
  };
};
