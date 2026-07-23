const isPrimitive = value => value === null || ["string", "number", "boolean"].includes(typeof value);

export function toFalkorProperties(value) {
  const source = value || {};
  const properties = {};

  for (const [key, entry] of Object.entries(source)) {
    if (entry === undefined) continue;
    if (isPrimitive(entry) || (Array.isArray(entry) && entry.every(isPrimitive))) {
      properties[key] = entry;
      continue;
    }

    const serializedKey = `${key}Json`;
    if (Object.hasOwn(source, serializedKey)) {
      throw new Error(`Falkor property collision: "${key}" requires reserved field "${serializedKey}".`);
    }
    properties[serializedKey] = JSON.stringify(entry);
  }

  return properties;
}
