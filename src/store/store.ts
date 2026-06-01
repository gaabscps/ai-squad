import { EventEmitter } from "node:events";
import { discoverProjects, type DiscoveryOptions } from "../collector/discovery.js";
import type { Project } from "./types.js";

/**
 * Estado normalizado em memória (design §2). Guarda o último snapshot e emite
 * 'changed' a cada rebuild. As opções vêm por FUNÇÃO pra que cada rebuild leia
 * o estado atual de config (ex.: o hide recém-persistido). Read-only no disco.
 */
export class Store extends EventEmitter {
  private snapshot: Project[] = [];

  constructor(private getOptions: () => DiscoveryOptions) {
    super();
  }

  /** O último snapshot calculado (vazio até o primeiro rebuild). */
  getSnapshot(): Project[] {
    return this.snapshot;
  }

  /** Reprocessa do disco, guarda e emite 'changed'. Devolve o novo snapshot. */
  rebuild(): Project[] {
    this.snapshot = discoverProjects(this.getOptions());
    this.emit("changed", this.snapshot);
    return this.snapshot;
  }
}
