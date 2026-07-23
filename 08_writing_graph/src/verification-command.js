// Grammaire close des commandes de vérification portées par les nœuds.
//
// Doctrine (exec-node-names-a-script-never-a-command) : un nœud nomme un script
// déjà déclaré dans package.json, il ne décrit jamais comment l'exécuter. Le jour
// où un marcheur exécute ce que le graphe contient, la distinction entre décrire
// et faire disparaît ; ce module la rétablit en amont, à la validation, donc avant
// tout déclenchement et donc en revue.
//
// Le contrôle est volontairement une liste blanche et non une liste noire : on
// énumère les trois formes admises, pas les tournures interdites. Une liste noire
// se contourne par une graphie non prévue, une liste blanche non.

// Tout ce qui donnerait prise à un interpréteur. L'esperluette est traitée à part :
// « && » est le seul séparateur admis, une esperluette isolée ne l'est pas.
const SHELL_CHARACTERS = [";", "|", "`", "$", "(", ")", "<", ">", "\\", "'", "\"", "\n", "\r", "\t", "{", "}", "*", "?", "~", "#", "!"];

const FLAG = /^--[a-z][a-z0-9-]*(=[A-Za-z0-9._/-]+)?$/;
const TEST_PATH = /^test\/[A-Za-z0-9._-]+\.test\.js$/;

/**
 * Vérifie une valeur de verificationCommand contre la grammaire admise.
 * @param {string} command valeur brute portée par le nœud
 * @param {Iterable<string>} declaredScripts noms de scripts déclarés dans package.json
 * @returns {string[]} raisons du refus ; tableau vide si la commande est admise
 */
export function checkVerificationCommand(command, declaredScripts) {
  const scripts = new Set(declaredScripts);
  const reasons = [];

  if (typeof command !== "string" || !command.trim()) return ["verificationCommand is empty"];

  for (const character of SHELL_CHARACTERS) {
    if (command.includes(character)) reasons.push(`contains shell character ${JSON.stringify(character)}`);
  }
  // Une esperluette qui ne fait pas partie d'un « && » entouré d'espaces met la
  // commande en arrière-plan ou enchaîne autrement : les deux sortent de la grammaire.
  if (/(^|[^&])&([^&]|$)/.test(command)) reasons.push("contains a lone & outside the ' && ' separator");
  if (command !== command.trim()) reasons.push("has leading or trailing whitespace");
  if (reasons.length) return reasons;

  const segments = command.split(" && ");
  for (const segment of segments) {
    if (segment !== segment.trim() || !segment) {
      reasons.push(`segment ${JSON.stringify(segment)} is empty or badly spaced`);
      continue;
    }
    reasons.push(...checkSegment(segment, scripts));
  }
  return reasons;
}

function checkSegment(segment, scripts) {
  const words = segment.split(" ");

  if (segment === "npm test") return [];

  if (words[0] === "npm" && words[1] === "run") {
    const script = words[2];
    if (!script) return [`segment ${JSON.stringify(segment)} names no script`];
    if (!scripts.has(script)) return [`segment ${JSON.stringify(segment)} names undeclared script ${JSON.stringify(script)}`];
    const rest = words.slice(3);
    if (!rest.length) return [];
    // Les arguments d'un script npm passent obligatoirement par le séparateur --,
    // ce qui évite qu'un drapeau soit interprété par npm plutôt que par le script.
    if (rest[0] !== "--") return [`segment ${JSON.stringify(segment)} passes arguments without the -- separator`];
    const flags = rest.slice(1);
    if (!flags.length) return [`segment ${JSON.stringify(segment)} ends on an empty -- separator`];
    return flags.filter(flag => !FLAG.test(flag)).map(flag => `segment ${JSON.stringify(segment)} carries invalid flag ${JSON.stringify(flag)}`);
  }

  if (words[0] === "node" && words[1] === "--test") {
    const paths = words.slice(2);
    if (!paths.length) return [`segment ${JSON.stringify(segment)} runs node --test without a test path`];
    return paths.filter(item => !TEST_PATH.test(item)).map(item => `segment ${JSON.stringify(segment)} targets ${JSON.stringify(item)} outside test/`);
  }

  return [`segment ${JSON.stringify(segment)} matches no admitted form (npm test | npm run <declared script> [-- <flags>] | node --test <test path>)`];
}
