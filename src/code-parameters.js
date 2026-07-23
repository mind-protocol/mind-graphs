// Registre des paramètres de code auto-déclarés.
//
// Un module qui porte des constantes gouvernant une conclusion du projet exporte
// sa propre déclaration (`QUERY_TUNING` et consorts) ; ce fichier ne fait que les
// rassembler. Il ne recopie aucune valeur : ajouter une valeur ici serait
// rouvrir la porte au drift que ce dispositif ferme.
//
// Deux consommateurs : `scripts/validate-data.js` pour l'ancrage code ↔ graphe,
// et `scripts/docs-parameters.js` pour le rendu lisible.
import { QUERY_TUNING } from "../public/graph-query.js";
import { L4_PHYSICS_TUNING } from "./l4-physics.js";

/** Modules instrumentés. Un module absent d'ici n'est simplement pas encore décrit. */
export const PARAMETER_MODULES = [QUERY_TUNING, L4_PHYSICS_TUNING];

/**
 * Liste plate des paramètres déclarés, un par entrée, avec sa référence stable
 * `module.paramètre` — la même chaîne que porte `codeParameter` côté graphe.
 */
export function listCodeParameters(modules = PARAMETER_MODULES) {
  return modules.flatMap(module =>
    Object.entries(module.parameters).map(([name, spec]) => ({
      ref: `${module.module}.${name}`,
      module: module.module,
      moduleLabel: module.label,
      name,
      ...spec
    }))
  );
}

/** Paramètres décisifs dépourvus de décision : la dette que l'indicateur mesure. */
export function unjustifiedDecisiveParameters(modules = PARAMETER_MODULES) {
  return listCodeParameters(modules).filter(parameter => parameter.decisive && !parameter.decisionId);
}

/**
 * Couverture de justification. On mesure la déclaration, jamais l'altitude du
 * barreau : viser haut partout pousserait au benchmark cérémoniel et punirait
 * les choix normatifs, qui sont déjà à leur plafond (`parameterContract`).
 */
export function parameterCoverage(modules = PARAMETER_MODULES) {
  const parameters = listCodeParameters(modules);
  const decisive = parameters.filter(parameter => parameter.decisive);
  const justified = decisive.filter(parameter => parameter.decisionId);
  return {
    total: parameters.length,
    decisive: decisive.length,
    justified: justified.length,
    ratio: decisive.length ? justified.length / decisive.length : 1
  };
}
