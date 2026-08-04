export type WorkbenchF4Turn = {
  readonly draft?: { readonly draftId: string };
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
