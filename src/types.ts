export type Input = "image" | "text" | "audio" | "video";
export type Output = "label" | "embedding" | "boxes_masks" | "text" | "media";
export type Tier = "cpu_edge" | "gpu_8gb" | "gpu_24gb" | "datacenter" | "api";

export interface Cell { input: Input; output: Output }
export interface Model {
  id: string; name: string; family: string; cells: Cell[];
  hf_task: string | null; tiers: Tier[]; license: string | null; open_weights: boolean | null;
  hf_repo: string | null; links: { label: string; url: string }[]; feeds_into: string[];
  verified: boolean; notes: string | null; source: "curated" | "auto";
}
export interface Family { id: string; name: string; summary: string | null }
export interface Problem { id: string; title: string; steps: { label: string; models: string[] }[]; note: string | null }
