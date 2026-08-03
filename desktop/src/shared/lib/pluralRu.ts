/**
 * Russian plural form for a count: `pluralRu(3, "агент", "агента", "агентов")`.
 *
 * Forms follow the standard Russian rules: `one` for 1, 21, 101…; `few` for
 * 2–4, 22–24…; `many` for 0, 5–20, 25–30… (11–14 are always `many`).
 * Negative counts use their absolute value.
 */
export function pluralRu(
  count: number,
  one: string,
  few: string,
  many: string,
): string {
  const n = Math.abs(count);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  const mod10 = n % 10;
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}
