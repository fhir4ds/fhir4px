import Dexie, { type Table } from "dexie";
import type { VaultItem } from "./types";

export class Fhir4PxVaultDatabase extends Dexie {
  items!: Table<VaultItem, string>;

  constructor(name = "fhir4px-local-vault") {
    super(name);
    this.version(1).stores({
      items: "id, type, updatedAt"
    });
  }
}

export const vaultDb = new Fhir4PxVaultDatabase();
