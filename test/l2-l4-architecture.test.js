import test from "node:test";
import assert from "node:assert/strict";
import { loadManifest, selectGraph, readDatasets } from "../src/graph-manifest.js";
import { createPromotionRequest, ratifyPromotionToL4 } from "../src/l2-promotion-engine.js";

test("le graphe L2 Mind contient l'espace racine et le Space de Design", async () => {
  const manifest = await loadManifest();
  const graphSpec = selectGraph(manifest, "l2-mind");
  assert.equal(graphSpec.ontology, "l2/ontology.json");

  const datasets = await readDatasets(graphSpec);
  const orgDataset = datasets.find(d => d.spec.id === "l2-mind-organization");
  assert.ok(orgDataset);

  const rootSpace = orgDataset.data.nodes.find(n => n.id === "space-l2-mind-protocol");
  const designSpace = orgDataset.data.nodes.find(n => n.id === "space-l2-design");
  assert.ok(rootSpace);
  assert.ok(designSpace);

  const convergesLink = orgDataset.data.links.find(l => l.source === "space-l2-design" && l.target === "space-l2-mind-protocol");
  assert.ok(convergesLink);
  assert.equal(convergesLink.type, "CONVERGES_IN");
});

test("le moteur de promotion L2 -> L4 valide et ratifie une décision vers le registre L4", () => {
  const request = createPromotionRequest({
    decisionId: "decision-l1-subentity-roles",
    title: "Ratification des 5 rôles physiques pour les sous-entités",
    summary: "Les sous-entités doivent être représentées par des nœuds Actor non citoyens.",
    author: "nlr"
  });

  assert.equal(request.status, "proposed");
  assert.equal(request.decisionId, "decision-l1-subentity-roles");

  const ratification = ratifyPromotionToL4(request, { ratifiedBy: "mind-protocol-council", l4Version: "1.9.1" });
  assert.equal(ratification.ratifiedRequest.status, "ratified");
  assert.equal(ratification.registryEntry.nodeType, "thing");
  assert.equal(ratification.registryEntry.semanticType, "L4RegistryEntry");
  assert.equal(ratification.registryEntry.version, "1.9.1");
  assert.equal(ratification.link.type, "JUSTIFIED_BY");
  assert.equal(ratification.link.target, "decision-l1-subentity-roles");
});

test("l'acteur nlr_ai est présent de façon cohérente dans L2, L3 et L4", async () => {
  const manifest = await loadManifest();

  // L2
  const l2Spec = selectGraph(manifest, "l2-mind");
  const l2Data = (await readDatasets(l2Spec)).find(d => d.spec.id === "l2-mind-organization").data;
  const l2Actor = l2Data.nodes.find(n => n.id === "actor-nlr-ai");
  assert.ok(l2Actor);
  assert.equal(l2Actor.handle, "nlr_ai");
  assert.equal(l2Actor.currentSpaceId, "space-l2-autonomous-cognition");

  // L3
  const l3Spec = selectGraph(manifest, "l3-ecosystem");
  const l3Data = (await readDatasets(l3Spec))[0].data;
  const l3Actor = l3Data.nodes.find(n => n.id === "l3-actor-nlr-ai");
  assert.ok(l3Actor);
  assert.equal(l3Actor.handle, "nlr_ai");
  assert.equal(l3Actor.correspondsTo, "actor-nlr-ai");

  // L4
  const l4Spec = selectGraph(manifest, "l4-registry");
  const l4Data = (await readDatasets(l4Spec))[0].data;
  const l4Actor = l4Data.nodes.find(n => n.id === "actor-nlr-ai");
  assert.ok(l4Actor);
  assert.equal(l4Actor.handle, "nlr_ai");
});
