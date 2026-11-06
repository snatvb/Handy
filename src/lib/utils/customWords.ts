import type { CustomWord } from "@/bindings";

export const normalizeCustomWord = (word: string): string =>
  word.replace(/\s+/g, " ").trim();

export const normalizeAliases = (values: string[], word = ""): string[] => {
  const preferred = normalizeCustomWord(word).toLowerCase();
  const unique = new Map<string, string>();
  for (const value of values) {
    const alias = normalizeCustomWord(value);
    const key = alias.toLowerCase();
    if (alias && key !== preferred && !unique.has(key)) {
      unique.set(key, alias);
    }
  }
  return [...unique.values()];
};

export const createCustomWord = (
  word: string,
  aliases: string[],
  pendingAlias: string,
): CustomWord => ({
  word: normalizeCustomWord(word),
  aliases: normalizeAliases(
    [...aliases, ...pendingAlias.split(/[,\r\n]+/)],
    word,
  ),
});

export const isCustomWordTooLong = (entry: CustomWord): boolean =>
  [entry.word, ...entry.aliases].some((value) => Array.from(value).length > 50);

export const hasDuplicateCustomWord = (
  words: CustomWord[],
  word: string,
  editingIndex: number | null,
): boolean =>
  words.some(
    (entry, index) =>
      index !== editingIndex &&
      entry.word.toLowerCase() === normalizeCustomWord(word).toLowerCase(),
  );
