import type { Family, Model, Problem, Task } from "./types";
import tasksJson from "../data/tasks.json";

const load = <T>(mods: Record<string, { default: T }>): T[] => Object.values(mods).map((m) => m.default);

export const models = load<Model>(import.meta.glob("../data/models/*.json", { eager: true }));
export const families = load<Family>(import.meta.glob("../data/families/*.json", { eager: true }));
export const problems = load<Problem>(import.meta.glob("../data/problems/*.json", { eager: true }));
export const allTasks = tasksJson as Task[];

export const familyById = new Map(families.map((f) => [f.id, f]));
export const modelById = new Map(models.map((m) => [m.id, m]));
export const problemById = new Map(problems.map((p) => [p.id, p]));
export const modelsOfFamily = (id: string) => models.filter((m) => m.family === id);

/** Tasks that have at least one model on the map; only these get pages. */
export const tasks = allTasks.filter((t) => models.some((m) => m.hf_task === t.id));
export const taskById = new Map(tasks.map((t) => [t.id, t]));
