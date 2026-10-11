import assert from "node:assert/strict";
import { fitsWithin, lightestSetup, stepReq } from "../src/lightest.ts";
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

// hardware filter
const FIT = (tier, api = false, unknown = false) => ({ tier, api, unknown });
assert.equal(fitsWithin(by.get("a"), FIT(null)), true); // no filter: everything
assert.equal(fitsWithin(by.get("a"), FIT("gpu_8gb")), true); // cpu model fits on 8 GB
assert.equal(fitsWithin(by.get("b"), FIT("gpu_8gb")), true); // lightest size of b is 8 GB
assert.equal(fitsWithin(by.get("b"), FIT("cpu_edge")), false);
assert.equal(fitsWithin(by.get("e"), FIT("gpu_24gb")), false); // datacenter does not fit on 24 GB
assert.equal(fitsWithin(by.get("c"), FIT("gpu_8gb")), false); // API-only excluded unless asked for
assert.equal(fitsWithin(by.get("c"), FIT("gpu_8gb", true)), true);
assert.equal(fitsWithin(by.get("d"), FIT("gpu_8gb")), false); // unknown size excluded unless asked for
assert.equal(fitsWithin(by.get("d"), FIT("gpu_8gb", false, true)), true);
console.log("lightest: all pass");
