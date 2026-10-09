import assert from "node:assert/strict";
import { lightestSetup, stepReq } from "../src/lightest.ts";
const M = (id, tiers) => [id, { id, tiers }];
const by = new Map([M("a", ["cpu_edge"]), M("b", ["gpu_8gb", "gpu_24gb"]), M("c", ["api"]), M("d", []), M("e", ["datacenter"])]);
const P = (...steps) => ({ steps: steps.map((models, i) => ({ label: `s${i}`, models })) });
assert.deepEqual(stepReq([by.get("b"), by.get("c")]), { kind: "hw", tier: "gpu_8gb" });  // self-host beats API
assert.deepEqual(stepReq([by.get("c")]), { kind: "api" });
assert.deepEqual(stepReq([by.get("d")]), { kind: "unknown" });
assert.deepEqual(lightestSetup(P(["a"], ["b", "c"]), by), { hw: "gpu_8gb", apiSteps: [], unknownSteps: [] });
assert.deepEqual(lightestSetup(P(["a"], ["c"], ["d"]), by), { hw: "cpu_edge", apiSteps: ["s1"], unknownSteps: ["s2"] });
assert.deepEqual(lightestSetup(P(["e", "b"]), by), { hw: "gpu_8gb", apiSteps: [], unknownSteps: [] });
assert.deepEqual(lightestSetup(P(["d"]), by), { hw: null, apiSteps: [], unknownSteps: ["s0"] });
console.log("lightest: all pass");
