import { EventEmitter } from "node:events";
import { discoverProjects, type DiscoveryOptions } from "../collector/discovery.js";
import { buildFeatures, type FeaturesOverlay } from "../collector/features.js";
import type { Project } from "./types.js";

interface StoreEvents {
  changed: [projects: Project[]];
}

// Opções do Store: as de discovery + o overlay de features (lido do config a cada rebuild).
export type StoreOptions = DiscoveryOptions & { features?: FeaturesOverlay };

/**
 * Estado normalizado em memória (design §2). Guarda o último snapshot e emite
 * 'changed' a cada rebuild. As opções vêm por FUNÇÃO pra que cada rebuild leia
 * o estado atual de config (ex.: o hide recém-persistido). Read-only no disco.
 */
export class Store extends EventEmitter<StoreEvents> {
  private snapshot: Project[] = [];

  constructor(private getOptions: () => StoreOptions) {
    super();
  }

  /** O último snapshot calculado (vazio até o primeiro rebuild). */
  getSnapshot(): readonly Project[] {
    return this.snapshot;
  }

  /** Reprocessa do disco, deriva features por projeto, guarda e emite 'changed'. */
  rebuild(): readonly Project[] {
    const opts = this.getOptions();
    const now = Date.now();
    this.snapshot = discoverProjects(opts).map((p) => ({
      ...p,
      features: buildFeatures(p.id, p.specs, opts.features, now),
    }));
    this.emit("changed", this.snapshot);
    return this.snapshot;
  }
}
