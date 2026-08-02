/**
 * Server turn pages are newest-first.  The UI displays them oldest-first, but
 * authority must always be derived from the server's first (newest) turn.
 */
export interface AuthorityTurn<TDraft> {
  id: string;
  draft?: TDraft;
}

export function authorityFromNewestTurn<TDraft>(
  newestFirst: readonly AuthorityTurn<TDraft>[],
): TDraft | undefined {
  return newestFirst[0]?.draft;
}

export function mergeTurnDisplay<T extends { id: string }>(
  newestFirstPage: readonly T[],
  existingOldestFirst: readonly T[],
  appendEarlier: boolean,
): T[] {
  const ordered = appendEarlier
    ? [...newestFirstPage].reverse().concat(existingOldestFirst)
    : [...newestFirstPage].reverse();
  return [...new Map(ordered.map((item) => [item.id, item])).values()];
}

export function canApplyConversationLoad(input: {
  requestConversationId: string;
  requestEpoch: number;
  activeConversationId: string;
  activeEpoch: number;
}): boolean {
  return input.requestConversationId === input.activeConversationId
    && input.requestEpoch === input.activeEpoch;
}
