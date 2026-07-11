import type { FeatureAction } from "../ui/app.js";
import type { FeaturesOverlay } from "./features.js";

/**
 * Aplica uma FeatureAction ao overlay em memória, mutando-o in-place. Função
 * pura de I/O (sem persistência, sem rebuild do Store) — quem chama decide
 * quando salvar e reconstruir.
 */
export function applyFeatureActionToOverlay(overlay: FeaturesOverlay, msg: FeatureAction): void {
  if (msg.type === "feature:assign") {
    (overlay.assign ??= {})[`${msg.projectId}/${msg.sessionId}`] = msg.featureId;
  } else if (msg.type === "feature:markDone") {
    (overlay.done ??= {})[`${msg.projectId}/${msg.featureId}`] = msg.done;
  } else if (msg.type === "feature:setDelivery") {
    const key = `${msg.projectId}/${msg.featureId}`;
    if (msg.state === "open") {
      if (overlay.deliveryState) delete overlay.deliveryState[key];
      if (overlay.done) delete overlay.done[key];
    } else {
      (overlay.deliveryState ??= {})[key] = msg.state;
    }
  } else {
    (overlay.names ??= {})[`${msg.projectId}/${msg.featureId}`] = msg.name;
  }
}
