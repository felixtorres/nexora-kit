/** Minimal interface to avoid circular core→storage dependency.
 *  Compatible with IUserMemoryStore.set() from @nexora-kit/storage. */
export interface UserMemoryStoreInterface {
  set(
    userId: string,
    fact: { key: string; value: string; namespace?: string; source?: string },
  ): void | Promise<void>;
}
