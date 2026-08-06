export type WorkbenchF4Turn = {
  readonly draft?: { readonly draftId: string; readonly versionId?: string };
  f4?: unknown;
};

/** Hydrate drafts independently so one legacy failure cannot strand its siblings. */
export async function hydrateWorkbenchF4Turns<T extends WorkbenchF4Turn>(
  turns: readonly T[],
  loadF4: (draftId: string) => Promise<unknown>,
): Promise<T[]> {
  return Promise.all(turns.map(async (turn) => {
    if (!turn.draft) return turn;
    try { return { ...turn, f4: await loadF4(turn.draft.draftId) }; }
    catch (error) { return { ...turn, f4: { error: error instanceof Error ? error.message : "F4_UNAVAILABLE" } }; }
  }));
}

/**
 * Apply an action result only to its immutable configuration version.  This is
 * intentionally identity based: a history read can contain legacy entries or
 * a different ordering after restart, neither of which may redirect F4 facts.
 */
export function mergeWorkbenchF4Action<T extends WorkbenchF4Turn>(
  turns: readonly T[],
  versionId: string,
  f4: unknown,
): T[] {
  return turns.map((turn) => turn.draft?.versionId === versionId ? { ...turn, f4 } : turn);
}

/**
 * Read back exactly the version that accepted an F4 action.  The action
 * transport result is useful for immediate feedback, but the read model is
 * the final server authority after an immutable evidence revision is stored.
 */
export async function rereadWorkbenchF4Action<T extends WorkbenchF4Turn>(
  turns: readonly T[],
  versionId: string,
  loadF4: (versionId: string) => Promise<unknown>,
): Promise<T[]> {
  return mergeWorkbenchF4Action(turns, versionId, await loadF4(versionId));
}
