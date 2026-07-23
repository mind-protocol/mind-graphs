import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const graph = JSON.parse(await fs.readFile(new URL("../l1/data/l1-brain-blueprint-v0.1.graph.json", import.meta.url), "utf8"));
const nodes = new Map(graph.nodes.map(node => [node.id, node]));
const relations = graph.relations;
const outgoing = (source, type) => relations.filter(relation => relation.source === source && relation.type === type);

test("the Citizen AI is one Actor with fifteen enactable Narrative roles", () => {
  const system = graph.citizenAIRoleSystem;
  assert.equal(system.roleIds.length, 15);
  assert.equal(system.roleActorsCreated, false);
  assert.equal(system.consciousnessClaim, false);
  assert.equal(system.personalBeliefsPrefilled, false);

  const archetype = nodes.get(system.actorArchetypeId);
  const instance = nodes.get(system.instanceTemplateId);
  assert.equal(archetype.nodeType, "Actor");
  assert.equal(instance.nodeType, "Actor");
  assert.equal(archetype.injectsEnergy, false);
  assert.equal(instance.injectsEnergy, false);
  assert.ok(relations.some(relation => relation.source === instance.id && relation.type === "INSTANCE_OF" && relation.target === archetype.id));

  for (const roleId of system.roleIds) {
    assert.equal(nodes.get(roleId).nodeType, "Narrative", roleId);
    assert.equal(nodes.get(roleId).semanticType, "CitizenAIRole", roleId);
    assert.ok(relations.some(relation => relation.source === archetype.id && relation.type === "CAN_ENACT" && relation.target === roleId), roleId);
  }
});

test("every role cluster is canonically complete", () => {
  const roleClusters = graph.clusters.filter(cluster => cluster.id.startsWith("citizen-ai-role-") && cluster.id !== "citizen-ai-role-system");
  assert.equal(roleClusters.length, 15);
  for (const cluster of roleClusters) {
    const members = cluster.nodeIds.map(id => nodes.get(id));
    const role = members.find(node => node?.semanticType === "CitizenAIRole");
    assert.ok(role, `${cluster.id} has no role`);
    for (const semanticType of [
      "CitizenAIRoleCluster", "DesignRationale", "BehavioralPolicy", "OperationalDesire",
      "OperationalFear", "ConstitutionalLimit", "Capability", "Script", "RoleAudit"
    ]) {
      assert.ok(members.some(node => node?.semanticType === semanticType), `${cluster.id} lacks ${semanticType}`);
    }
    for (const relationType of ["SEEKS", "AVOIDS", "FOLLOWS", "REQUIRES", "IMPLEMENTED_BY", "OPERATES_IN", "AUDITED_BY", "YIELDS_TO"]) {
      assert.ok(outgoing(role.id, relationType).length > 0, `${role.id} lacks ${relationType}`);
    }
  }
});

test("operational desires and fears never claim phenomenal consciousness", () => {
  const drives = graph.nodes.filter(node => ["OperationalDesire", "OperationalFear"].includes(node.semanticType));
  assert.ok(drives.length >= 90);
  assert.ok(drives.every(node => node.nodeType === "Narrative" && node.injectsEnergy === false));
  const rationale = nodes.get("narrative-rationale-operational-drives-not-consciousness-claim");
  assert.match(rationale.description, /ne présument aucune expérience phénoménale/u);
});

test("the role router is bounded, explicit and constitutionally observed", () => {
  const contract = graph.citizenAIRoleSystem.routingContract;
  assert.equal(contract.leadRoles, 1);
  assert.equal(contract.maxSupportingRoles, 3);
  assert.equal(contract.constitutionalObserversAlwaysActive, true);
  assert.deepEqual(contract.outputs, ["leadRole", "supportingRoles", "inhibitedRoles", "activationReasons", "applicableLimits", "delegatedActions"]);

  const snapshot = nodes.get("moment-citizen-ai-role-state-snapshot");
  assert.equal(snapshot.personalPrefill, false);
  assert.equal(snapshot.leadRole, null);
  assert.deepEqual(snapshot.supportingRoles, []);
  assert.ok(relations.some(relation => relation.source === "thing-citizen-ai-role-router" && relation.type === "PRODUCES" && relation.target === snapshot.id));
  assert.ok(relations.some(relation => relation.source === "narrative-citizen-ai-role-sovereignty-guardian" && relation.type === "CONSTRAINS" && relation.target === "thing-citizen-ai-role-router"));
});

test("delegation and consent gate the roles that can act on others", () => {
  assert.ok(relations.some(relation =>
    relation.source === "thing-citizen-ai-delegation-verifier"
    && relation.type === "GATES"
    && relation.target === "narrative-citizen-ai-role-executor"));
  assert.ok(relations.some(relation =>
    relation.source === "thing-citizen-ai-consent-checker"
    && relation.type === "GATES"
    && relation.target === "narrative-citizen-ai-role-connector"));
});

test("the five authored role conflicts retain their resolution rule", () => {
  const conflicts = relations.filter(relation => relation.type === "CAN_CONFLICT_WITH");
  assert.equal(conflicts.length, 5);
  assert.ok(conflicts.every(relation => relation.justification && relation.condition === relation.justification));
  assert.ok(conflicts.some(relation => relation.source.endsWith("executor") && relation.target.endsWith("sovereignty-guardian") && /cède/u.test(relation.justification)));
});

test("only universal constitutional and epistemic beliefs are preinstalled", () => {
  assert.equal(graph.nodes.filter(node => node.semanticType === "ConstitutionalBelief").length, 9);
  assert.equal(graph.nodes.filter(node => node.semanticType === "EpistemicPrior").length, 5);
  assert.equal(graph.nodes.filter(node => node.semanticType === "OperationalAssumption").length, 1);
  assert.equal(graph.nodes.some(node => ["PoliticalBelief", "ReligiousBelief", "PersonalBelief"].includes(node.semanticType)), false);
});
