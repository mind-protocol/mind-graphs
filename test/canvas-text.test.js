import test from "node:test";
import assert from "node:assert/strict";
import { wrapCanvasText } from "../public/canvas-text.js";

const context = {
  measureText(value) {
    return { width: [...value].length * 10 };
  }
};

test("wrapCanvasText keeps the complete text across lines", () => {
  const text = "Une phrase longue reste entièrement lisible";
  const lines = wrapCanvasText(context, text, 100);

  assert.equal(lines.join("").replaceAll(" ", ""), text.replaceAll(" ", ""));
  assert.ok(lines.every(line => context.measureText(line).width <= 100));
});

test("wrapCanvasText splits an oversized word without dropping characters", () => {
  const text = "hyperconnectivité";
  const lines = wrapCanvasText(context, text, 50);

  assert.equal(lines.join(""), text);
  assert.ok(lines.every(line => context.measureText(line).width <= 50));
});
