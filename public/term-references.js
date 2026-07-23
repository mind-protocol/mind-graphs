const SKIPPED_TAGS = new Set(["CANVAS", "INPUT", "OPTION", "SCRIPT", "STYLE", "TEXTAREA"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildTermIndex(nodes = []) {
  return nodes
    .filter(node => node.nodeType === "terme" && node.name && node.context && node.definition)
    .map(node => ({
      id: node.id,
      name: String(node.name).trim(),
      context: String(node.context).trim(),
      definition: String(node.definition).trim()
    }))
    .filter(term => term.name)
    .sort((left, right) => right.name.length - left.name.length);
}

export function buildTermPattern(terms) {
  if (!terms.length) return null;
  const alternatives = terms.map(term => escapeRegExp(term.name));
  return new RegExp(`(?<![\\p{L}\\p{N}])(${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu");
}

function tooltipFor(term) {
  return `${term.definition}\nContexte : ${term.context}`;
}

function decorateTextNode(textNode, terms, pattern) {
  const parent = textNode.parentElement;
  if (!parent || !textNode.nodeValue?.trim() || SKIPPED_TAGS.has(parent.tagName) || parent.closest(".term-reference, .term-hover-card")) return;

  pattern.lastIndex = 0;
  const matches = [...textNode.nodeValue.matchAll(pattern)];
  if (!matches.length) return;

  const termsByName = new Map(terms.map(term => [term.name.toLocaleLowerCase("fr"), term]));
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of matches) {
    if (match.index > cursor) fragment.append(textNode.nodeValue.slice(cursor, match.index));
    const matchedText = match[0];
    const term = termsByName.get(matchedText.toLocaleLowerCase("fr"));
    if (!term) {
      fragment.append(matchedText);
    } else {
      const reference = document.createElement("span");
      reference.className = "term-reference";
      reference.tabIndex = 0;
      reference.dataset.tooltip = tooltipFor(term);
      reference.title = tooltipFor(term);
      reference.setAttribute("aria-label", `${matchedText}. ${term.definition} Contexte : ${term.context}`);
      reference.textContent = matchedText;
      fragment.append(reference);
    }
    cursor = match.index + matchedText.length;
  }
  fragment.append(textNode.nodeValue.slice(cursor));
  textNode.replaceWith(fragment);
}

function decorateTree(root, terms, pattern) {
  if (!root || !pattern) return;
  if (root.nodeType === Node.TEXT_NODE) {
    decorateTextNode(root, terms, pattern);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIPPED_TAGS.has(root.tagName) || root.closest?.(".term-reference, .term-hover-card")) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => decorateTextNode(node, terms, pattern));
}

export function installTermReferences(root, nodes) {
  const terms = buildTermIndex(nodes);
  const pattern = buildTermPattern(terms);
  if (!pattern) return () => {};
  decorateTree(root, terms, pattern);
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => decorateTree(node, terms, pattern));
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}
