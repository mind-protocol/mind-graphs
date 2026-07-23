export function chooseStartCluster(optionValues, searchParams, preferred = "science-endgame") {
  const available = new Set(optionValues);
  if (searchParams.has("cluster")) {
    const requested = searchParams.get("cluster");
    if (available.has(requested)) return requested;
  }
  if (available.has(preferred)) return preferred;
  return optionValues[0] ?? "";
}

export function clusterHref(href, clusterId) {
  const url = new URL(href);
  url.searchParams.set("cluster", clusterId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function parcelScope(nodes) {
  const district = nodes.filter((node) => node._core).length;
  const neighbors = nodes.length - district;
  return {
    district,
    neighbors,
    label: neighbors
      ? `${district} dans le district · ${neighbors} voisin${neighbors > 1 ? "s" : ""} externe${neighbors > 1 ? "s" : ""}`
      : `${district} dans le district`
  };
}

export function walkAvailability(story) {
  const steps = story?.path?.length ?? 0;
  return steps > 1
    ? { enabled: true, note: "Teste la loi de propagation L4 sur le chemin principal." }
    : { enabled: false, note: "Ce district n’a pas de chemin principal à parcourir." };
}
