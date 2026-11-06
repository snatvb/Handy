import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCustomWord,
  hasDuplicateCustomWord,
  isCustomWordTooLong,
  normalizeAliases,
} from "./customWords";

describe("replacement dictionary drafts", () => {
  test("normalizes tags, keeps first spelling, excludes preferred spelling", () => {
    assert.deepEqual(
      normalizeAliases([" GSX ", "gsx", "джи  эс икс", "JSX", ""], "jsx"),
      ["GSX", "джи эс икс"],
    );
  });

  test("includes uncommitted input when saving, including pasted lists", () => {
    assert.deepEqual(
      createCustomWord("  JSX  ", ["GSX"], "gsx, джи эс икс\nджсикс"),
      { word: "JSX", aliases: ["GSX", "джи эс икс", "джсикс"] },
    );
  });

  test("counts Unicode characters, not UTF-16 code units", () => {
    assert.equal(
      isCustomWordTooLong({ word: "😀".repeat(50), aliases: [] }),
      false,
    );
    assert.equal(
      isCustomWordTooLong({ word: "JSX", aliases: ["😀".repeat(51)] }),
      true,
    );
  });

  test("allows optional aliases and editing original spelling, not duplicates", () => {
    const words = [
      { word: "JSX", aliases: [] },
      { word: "Sonnet", aliases: [] },
    ];
    assert.deepEqual(createCustomWord("JSX", [], ""), words[0]);
    assert.equal(hasDuplicateCustomWord(words, "jsx", 0), false);
    assert.equal(hasDuplicateCustomWord(words, " jsx ", null), true);
    assert.equal(hasDuplicateCustomWord(words, "SONNET", 0), true);
  });
});
