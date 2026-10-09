// Seeds data/tasks.json from the Hugging Face task taxonomy (@huggingface/tasks).
import { PIPELINE_DATA } from "@huggingface/tasks";
import { writeFileSync } from "node:fs";

const tasks = Object.entries(PIPELINE_DATA)
  .map(([id, t]) => ({ id, name: t.name, hf_modality: t.modality }))
  .sort((a, b) => a.id.localeCompare(b.id));
writeFileSync("data/tasks.json", JSON.stringify(tasks, null, 2) + "\n");
console.log(`wrote ${tasks.length} tasks`);
