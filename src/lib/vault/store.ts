import { decryptJson, encryptJson } from "./crypto";
import { vaultDb, type Fhir4PxVaultDatabase } from "./db";
import type { VaultItem, VaultRecordRef, VaultRecordType } from "./types";

function recordId(type: VaultRecordType, id: string): string {
  return `${type}:${id}`;
}

export class LocalVault {
  constructor(private readonly db: Fhir4PxVaultDatabase = vaultDb) {}

  async putJson<T>(key: CryptoKey, ref: VaultRecordRef, value: T): Promise<void> {
    const now = Date.now();
    const id = recordId(ref.type, ref.id);
    const existing = await this.db.items.get(id);
    const envelope = await encryptJson(key, value, id);
    const item: VaultItem = {
      id,
      type: ref.type,
      envelope,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await this.db.items.put(item);
  }

  async getJson<T>(key: CryptoKey, ref: VaultRecordRef): Promise<T | null> {
    const item = await this.db.items.get(recordId(ref.type, ref.id));
    if (!item) return null;
    return decryptJson<T>(key, item.envelope);
  }

  async listJson<T>(key: CryptoKey, type: VaultRecordType): Promise<T[]> {
    const items = await this.db.items.where("type").equals(type).toArray();
    items.sort((left, right) => right.updatedAt - left.updatedAt);
    const values: T[] = [];
    for (const item of items) {
      try {
        values.push(await decryptJson<T>(key, item.envelope));
      } catch {
        // A session-only vault key can be lost after a hard reload or older
        // auth callback. Keep other decryptable records usable instead of
        // failing the whole view because one stale envelope cannot be opened.
      }
    }
    return values;
  }

  async delete(ref: VaultRecordRef): Promise<void> {
    await this.db.items.delete(recordId(ref.type, ref.id));
  }

  async clear(): Promise<void> {
    await this.db.items.clear();
  }
}

export const localVault = new LocalVault();
