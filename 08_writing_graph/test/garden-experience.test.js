import test from "node:test";
import assert from "node:assert/strict";
import { chooseStartCluster, clusterHref, parcelScope, walkAvailability } from "../public/garden-experience.js";

test("Science is the guided default but an explicit cluster wins", () => {
  const options = ["", "science-endgame", "question-endgame"];
  assert.equal(chooseStartCluster(options, new URLSearchParams()), "science-endgame");
  assert.equal(chooseStartCluster(options, new URLSearchParams("cluster=question-endgame")), "question-endgame");
  assert.equal(chooseStartCluster(options, new URLSearchParams("cluster=")), "");
});

test("changing district produces a shareable URL", () => {
  assert.equal(
    clusterHref("http://localhost:4173/garden.html?debug=1", "science-endgame"),
    "/garden.html?debug=1&cluster=science-endgame"
  );
});

test("parcel scope distinguishes the district from external neighbours", () => {
  assert.deepEqual(parcelScope([{ _core: true }, { _core: true }, { _core: false }]), {
    district: 2,
    neighbors: 1,
    label: "2 dans le district · 1 voisin externe"
  });
});

test("the advanced walk is disabled when there is no path", () => {
  assert.equal(walkAvailability({ path: [] }).enabled, false);
  assert.equal(walkAvailability({ path: [{}, {}] }).enabled, true);
});
