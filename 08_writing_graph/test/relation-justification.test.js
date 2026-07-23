import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationJustification } from "../public/relation-justification.js";

test("keeps an authored relation justification", () => {
  assert.equal(
    buildRelationJustification({ justification: "Ce mécanisme fournit l’entrée requise" }, "A", "B"),
    "Ce mécanisme fournit l’entrée requise."
  );
});

test("generates a precise non-causal nature when authored text is absent", () => {
  const result = buildRelationJustification(
    { type: "PART_OF" },
    "Composant",
    "Ensemble",
    { label: "fait partie de", direction: "partie → ensemble", scope: "structural", causalClaim: false }
  );

  assert.match(result, /Composant.*Ensemble/);
  assert.match(result, /partie → ensemble/);
  assert.match(result, /structural/);
  assert.match(result, /sans affirmer.*causalité/);
});
