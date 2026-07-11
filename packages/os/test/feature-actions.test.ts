import { describe, it, expect } from "vitest";
import { applyFeatureActionToOverlay } from "../src/collector/feature-actions.js";
import type { FeaturesOverlay } from "../src/collector/features.js";

describe("applyFeatureActionToOverlay", () => {
  it("feature:assign grava overlay.assign", () => {
    const overlay: FeaturesOverlay = {};
    applyFeatureActionToOverlay(overlay, { type: "feature:assign", projectId: "P", sessionId: "OBS-001", featureId: "PAY-1" });
    expect(overlay.assign).toEqual({ "P/OBS-001": "PAY-1" });
  });

  it("feature:markDone grava overlay.done (legado)", () => {
    const overlay: FeaturesOverlay = {};
    applyFeatureActionToOverlay(overlay, { type: "feature:markDone", projectId: "P", featureId: "PAY-1", done: true });
    expect(overlay.done).toEqual({ "P/PAY-1": true });
  });

  it("feature:setDelivery state=awaiting_deploy grava overlay.deliveryState", () => {
    const overlay: FeaturesOverlay = {};
    applyFeatureActionToOverlay(overlay, { type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "awaiting_deploy" });
    expect(overlay.deliveryState).toEqual({ "P/PAY-1": "awaiting_deploy" });
  });

  it("feature:setDelivery state=done grava overlay.deliveryState", () => {
    const overlay: FeaturesOverlay = {};
    applyFeatureActionToOverlay(overlay, { type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "done" });
    expect(overlay.deliveryState).toEqual({ "P/PAY-1": "done" });
  });

  it("feature:setDelivery state=open apaga deliveryState E o done legado (guarda de regressão: as duas chaves, não só uma)", () => {
    const overlay: FeaturesOverlay = {
      deliveryState: { "P/PAY-1": "awaiting_deploy" },
      done: { "P/PAY-1": true },
    };
    applyFeatureActionToOverlay(overlay, { type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "open" });
    expect(overlay.deliveryState).toEqual({});
    expect(overlay.done).toEqual({});
  });

  it("feature:setDelivery state=open não quebra quando as chaves nunca existiram", () => {
    const overlay: FeaturesOverlay = {};
    expect(() => applyFeatureActionToOverlay(overlay, { type: "feature:setDelivery", projectId: "P", featureId: "PAY-1", state: "open" })).not.toThrow();
  });

  it("feature:rename grava overlay.names", () => {
    const overlay: FeaturesOverlay = {};
    applyFeatureActionToOverlay(overlay, { type: "feature:rename", projectId: "P", featureId: "PAY-1", name: "Novo nome" });
    expect(overlay.names).toEqual({ "P/PAY-1": "Novo nome" });
  });
});
