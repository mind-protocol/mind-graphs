import express from "express";
import path from "node:path";
import { projectDir } from "./graph-manifest.js";
import { appendShadowReview, readL1ShadowState, readShadowReviews, shadowView } from "./l1-shadow-runtime.js";

export function createL1ShadowRouter({
  statePath = path.resolve(projectDir, process.env.L1_SHADOW_STATE_PATH || "artifacts/l1/subentity-shadow-state.json"),
  reviewsPath = path.resolve(projectDir, process.env.L1_SHADOW_REVIEWS_PATH || "artifacts/l1/subentity-shadow-reviews.jsonl"),
  readState = readL1ShadowState,
  readReviews = readShadowReviews,
  appendReview = appendShadowReview
} = {}) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    try {
      const [state, reviews] = await Promise.all([readState(statePath), readReviews(reviewsPath)]);
      res.json(shadowView(state, reviews));
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  router.post("/reviews", async (req, res) => {
    try {
      const state = await readState(statePath);
      if (!state.proposals.some(proposal => proposal.id === req.body?.proposalId)) {
        res.status(404).json({ error: "Shadow proposal not found." });
        return;
      }
      const review = await appendReview(reviewsPath, req.body);
      res.status(201).json({ review, appliedToAuthoritativeState: false });
    } catch (error) {
      if (/requires|verdict must/i.test(error.message)) res.status(400).json({ error: error.message });
      else res.status(503).json({ error: error.message });
    }
  });
  return router;
}
