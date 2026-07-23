// Mathématiques pures de la caméra de la cité-jardin.

export function viewportScale(viewBox, viewport) {
  return Math.min(viewport.width / viewBox.w, viewport.height / viewBox.h);
}

export function clientPointToGraph(viewBox, viewport, point) {
  const scale = viewportScale(viewBox, viewport);
  const offsetX = (viewport.width - viewBox.w * scale) / 2;
  const offsetY = (viewport.height - viewBox.h * scale) / 2;
  return {
    x: viewBox.x0 + (point.x - offsetX) / scale,
    y: viewBox.y0 + (point.y - offsetY) / scale
  };
}

export function zoomViewBox(viewBox, anchor, factor, limits = {}) {
  const minW = limits.minW ?? 1;
  const maxW = limits.maxW ?? Infinity;
  const nextW = Math.max(minW, Math.min(maxW, viewBox.w * factor));
  const applied = nextW / viewBox.w;
  const nextH = viewBox.h * applied;
  const rx = (anchor.x - viewBox.x0) / viewBox.w;
  const ry = (anchor.y - viewBox.y0) / viewBox.h;
  return {
    ...viewBox,
    x0: anchor.x - rx * nextW,
    y0: anchor.y - ry * nextH,
    w: nextW,
    h: nextH
  };
}

export function panViewBox(viewBox, dx, dy) {
  return { ...viewBox, x0: viewBox.x0 + dx, y0: viewBox.y0 + dy };
}

