import test from "node:test";
import assert from "node:assert/strict";
import { loadManifest, selectGraph, readDatasets } from "../src/graph-manifest.js";

test("le L2 conserve le contrat du snapshot interoceptif sans le ratifier en L4", async () => {
  const manifest = await loadManifest();
  const graphSpec = selectGraph(manifest, "l2-mind-graphs");
  const datasets = await readDatasets(graphSpec);
  const organization = datasets.find(
    dataset => dataset.spec.id === "l2-mind-organization"
  ).data;

  const decision = organization.nodes.find(
    node => node.id === "decision-l2-interoception-snapshot-bridge"
  );
  const rationale = organization.nodes.find(
    node => node.id === "rationale-l2-single-authority-interoception"
  );

  assert.ok(decision);
  assert.equal(decision.semanticType, "design_decision");
  assert.equal(decision.epistemicStatus, "proposed");
  assert.equal(decision.decisionStatus, "implemented");
  assert.equal(decision.chosenOptionId, "single-writer-versioned-l1-snapshot");
  assert.ok(rationale);
  assert.equal(rationale.semanticType, "design_rationale");

  const justification = organization.links.find(
    link =>
      link.source === rationale.id
      && link.target === decision.id
      && link.type === "JUSTIFIES"
  );
  assert.ok(justification);
  assert.match(justification.justification, /unique writer|lecteur/i);

  const destinations = organization.links
    .filter(link => link.source === decision.id && link.type === "CONVERGES_IN")
    .map(link => link.target)
    .sort();
  assert.deepEqual(destinations, [
    "space-l2-architecture",
    "space-l2-autonomous-cognition",
  ]);
});
