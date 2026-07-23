const idOf = value => typeof value === "object" ? value.id : value;

const completedStatuses = new Set(["done", "delivered"]);
const taskType = node => String(node?.semanticType || node?.nodeType || "").toLowerCase();

export function isTaskNode(node) {
  return taskType(node) === "task";
}

export function nodeEnergyFromPhysicsState(physicsState = {}) {
  const result = new Map();
  for (const [key, rawEnergy] of Object.entries(physicsState.energy || {})) {
    const [source, , target] = String(key).split("|");
    const energy = Math.max(0, Number(rawEnergy) || 0) / 2;
    if (source) result.set(source, (result.get(source) || 0) + energy);
    if (target) result.set(target, (result.get(target) || 0) + energy);
  }
  return result;
}

export function buildTaskQueue(nodes, links, { energyByNode = new Map() } = {}) {
  const tasks = nodes.filter(isTaskNode);
  const taskById = new Map(tasks.map(task => [task.id, task]));
  const dependencies = new Map();

  for (const link of links.filter(link => link.type === "DEPENDS_ON")) {
    const source = idOf(link.source);
    const target = idOf(link.target);
    if (!dependencies.has(source)) dependencies.set(source, []);
    dependencies.get(source).push(target);
  }

  return tasks
    .map(task => {
      const dependencyIds = dependencies.get(task.id) || [];
      const blockedBy = dependencyIds.filter(id => !completedStatuses.has(taskById.get(id)?.workStatus));
      const reasons = [];
      if (task.workStatus !== "ready") reasons.push(`status:${task.workStatus || "missing"}`);
      if (task.autonomyMode !== "autonomous") reasons.push(`autonomy:${task.autonomyMode || "missing"}`);
      if (blockedBy.length) reasons.push(`dependencies:${blockedBy.join(",")}`);
      const liveEnergy = (energyByNode.get(task.id) || 0) + (energyByNode.get(task.targetId) || 0);
      return { ...task, dependencyIds, blockedBy, liveEnergy, eligible: reasons.length === 0, queueReasons: reasons };
    })
    .sort((a, b) => b.liveEnergy - a.liveEnergy
      || Number(b.priority) - Number(a.priority)
      || a.id.localeCompare(b.id, "fr"));
}

export function eligibleAutonomousTasks(nodes, links, options) {
  return buildTaskQueue(nodes, links, options).filter(task => task.eligible);
}

export function nextAutonomousTask(nodes, links, options) {
  return eligibleAutonomousTasks(nodes, links, options)[0] || null;
}
