import type { CronDispatchTargetItem } from "../../../../api/types";

export type SelectOption = { value: string; label: string };

export function mergeSelectOptions(
  values: Iterable<string>,
  selectedValue?: string,
  searchValue?: string,
): SelectOption[] {
  const merged = new Set<string>();
  Array.from(values).forEach((value) => {
    if (value?.trim()) merged.add(value.trim());
  });
  if (selectedValue?.trim()) merged.add(selectedValue.trim());
  if (searchValue?.trim()) merged.add(searchValue.trim());
  return [...merged].sort().map((value) => ({ value, label: value }));
}

export function userIdsForChannel(
  targets: CronDispatchTargetItem[],
  channel?: string,
): string[] {
  if (!channel) return [];
  return targets
    .filter((item) => item.channel === channel)
    .map((item) => item.user_id);
}

export function sessionIdsForTarget(
  targets: CronDispatchTargetItem[],
  channel?: string,
  userId?: string,
): string[] {
  if (!channel || !userId) return [];
  return targets
    .filter((item) => item.channel === channel && item.user_id === userId)
    .map((item) => item.session_id);
}
