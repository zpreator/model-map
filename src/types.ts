export type Input = "image" | "text" | "audio" | "video";
export type Output = "label" | "embedding" | "boxes_masks" | "text" | "image" | "audio" | "video";
export type Tier = "cpu_edge" | "gpu_8gb" | "gpu_24gb" | "datacenter" | "api";

export interface Cell { input: Input; output: Output }
export interface Model {
  id: string; name: string; family: string; developer: string | null; summary: string | null; summary_source: "ai" | "curated" | null; card_hash?: string | null; tier_note?: string | null; cells: Cell[];
  hf_task: string | null; tiers: Tier[]; license: string | null; open_weights: boolean | null;
  hf_repo: string | null; links: { label: string; url: string }[]; feeds_into: string[];
  verified: boolean; notes: string | null; source: "curated" | "auto"; metrics?: { downloads_30d: number | null; likes: number | null; created_at?: string | null; fetched_at: string | null } | null;
}
export interface Family { id: string; name: string; summary: string | null; summary_source: "ai" | "curated" | null }
export interface Problem { id: string; title: string; description: string; steps: { label: string; models: string[] }[]; note: string | null }
export interface Task { id: string; name: string; hf_modality: string; summary: string | null }

export interface ActionDef {
  id: string; priority: number; stems: string[]; with?: string[]; suppress?: string[];
  in?: Input; allowed_in?: Input[]; default_in?: Input; out?: Output; label?: string;
  steps?: { in: Input; out: Output; label: string }[];
  via?: Partial<Record<Input, { in: Input; out: Output; label: string }[]>>;
}
export interface Lexicon {
  stop_words: string[]; modalities: Record<Input, string[]>; actions: ActionDef[]; examples: string[]; scope_notes?: { stems: string[]; message: string }[];
}
