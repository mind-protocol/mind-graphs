// `nodeType` porte le rôle physique L4. `semanticType` reste une étiquette métier
// ouverte : les algorithmes peuvent reconnaître les valeurs qu'ils savent traiter,
// mais ne doivent ni fermer le champ ni confondre une valeur inconnue avec un rôle.
// Le repli sur nodeType conserve la compatibilité avec les anciens corpus et fixtures.
export function semanticTypeOf(node) {
  return node?.semanticType || node?.nodeType || "";
}

export function semanticLabelOf(node) {
  return node?.semanticTypeLabel || node?.nodeTypeLabel || semanticTypeOf(node);
}
