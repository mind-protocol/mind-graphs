import test from "node:test";
import assert from "node:assert/strict";
import {
  clientPointToGraph, panViewBox, viewportScale, zoomViewBox
} from "../public/garden-camera.js";

test("zoom keeps the graph point under the pointer", () => {
  const before = { x0: 0, y0: 0, w: 1000, h: 500 };
  const anchor = { x: 750, y: 125 };
  const after = zoomViewBox(before, anchor, 0.5);
  assert.deepEqual(after, { x0: 375, y0: 62.5, w: 500, h: 250 });
});

test("zoom obeys its limits without changing the aspect ratio", () => {
  const after = zoomViewBox({ x0: 0, y0: 0, w: 100, h: 50 }, { x: 50, y: 25 }, 0.01, { minW: 20 });
  assert.equal(after.w, 20);
  assert.equal(after.h, 10);
});

test("panning translates the camera without changing its scale", () => {
  assert.deepEqual(panViewBox({ x0: 10, y0: 20, w: 100, h: 50 }, -4, 7), { x0: 6, y0: 27, w: 100, h: 50 });
});

test("client coordinates account for SVG letterboxing", () => {
  const viewBox = { x0: 0, y0: 0, w: 100, h: 100 };
  const viewport = { width: 200, height: 100 };
  assert.equal(viewportScale(viewBox, viewport), 1);
  assert.deepEqual(clientPointToGraph(viewBox, viewport, { x: 100, y: 50 }), { x: 50, y: 50 });
});

