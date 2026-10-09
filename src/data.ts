import type { Family, Model, Problem } from "./types";

const load = <T>(mods: Record<string, { default: T }>): T[] => Object.values(mods).map((m) => m.default);

export const models = load<Model>(import.meta.glob("../data/models/*.json", { eager: true }));
export const families = load<Family>(import.meta.glob("../data/families/*.json", { eager: true }));
export const problems = load<Problem>(import.meta.glob("../data/problems/*.json", { eager: true }));

export const familyById = new Map(families.map((f) => [f.id, f]));
export const modelsOfFamily = (id: string) => models.filter((m) => m.family === id);
