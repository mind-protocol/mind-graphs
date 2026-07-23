export function wrapCanvasText(context, value, maxWidth) {
  const words = String(value ?? "").trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return [];

  const lines = [];
  let line = "";

  const pushLongWord = word => {
    let fragment = "";
    for (const character of [...word]) {
      const candidate = fragment + character;
      if (fragment && context.measureText(candidate).width > maxWidth) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidate;
      }
    }
    return fragment;
  };

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = context.measureText(word).width > maxWidth ? pushLongWord(word) : word;
  }
  if (line) lines.push(line);
  return lines;
}
