/** Returns a copy of the selection with `id` added or removed. */
export const toggleId = (current: ReadonlySet<string>, id: string): Set<string> => {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Returns a copy of the selection with all `ids` added, or all removed. */
export const setIds = (current: ReadonlySet<string>, ids: Iterable<string>, select: boolean): Set<string> => {
  const next = new Set(current);
  for (const id of ids) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return next;
};
