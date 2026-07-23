export const HEALTH_VIEWS = new Set(["overview", "logs", "diagnostic", "recommendations"]);

export function normalizeHealthView(value) {
  return HEALTH_VIEWS.has(value) ? value : "overview";
}

export function healthViewHref(href, view) {
  const url = new URL(href);
  url.searchParams.set("view", normalizeHealthView(view));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function filterExecutions(executions, { kind = "all", query = "" } = {}) {
  const needle = query.trim().toLocaleLowerCase("fr");
  return executions.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (!needle) return true;
    return [item.label, item.description, item.inspected, item.limitation, item.status]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase("fr").includes(needle));
  });
}
