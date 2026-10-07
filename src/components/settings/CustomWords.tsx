import React, { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { CustomWord } from "@/bindings";
import { useSettings } from "../../hooks/useSettings";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { SettingContainer } from "../ui/SettingContainer";

interface CustomWordsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const normalizeCustomWord = (word: string) => word.replace(/\s+/g, " ").trim();

export const CustomWords: React.FC<CustomWordsProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const formId = useId();
    const [newWord, setNewWord] = useState("");
    const [newAliases, setNewAliases] = useState("");
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const customWords = getSetting("custom_words") || [];
    const updating = isUpdating("custom_words");
    const normalizedWord = normalizeCustomWord(newWord);
    const aliases = Array.from(
      new Map(
        newAliases
          .split(/[,\n]/)
          .map(normalizeCustomWord)
          .filter(
            (alias) =>
              alias && alias.toLowerCase() !== normalizedWord.toLowerCase(),
          )
          .map((alias) => [alias.toLowerCase(), alias]),
      ).values(),
    );
    const tooLong = [normalizedWord, ...aliases].some(
      (word) => Array.from(word).length > 50,
    );

    const resetEditor = () => {
      setNewWord("");
      setNewAliases("");
      setEditingIndex(null);
    };

    const handlePasteAliases = (
      event: React.ClipboardEvent<HTMLInputElement>,
    ) => {
      const pasted = event.clipboardData.getData("text");
      if (!/[\r\n]/.test(pasted)) return;
      event.preventDefault();
      const input = event.currentTarget;
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? start;
      setNewAliases(
        input.value.slice(0, start) +
          pasted.replace(/[\r\n]+/g, ", ") +
          input.value.slice(end),
      );
    };

    const saveWords = async (words: CustomWord[]) => {
      await updateSetting("custom_words", words);
      if (
        JSON.stringify(getSetting("custom_words")) !== JSON.stringify(words)
      ) {
        toast.error(t("settings.advanced.customWords.saveFailed"));
        return false;
      }
      return true;
    };

    const handleSaveWord = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!normalizedWord || tooLong || updating) return;

      if (
        customWords.some(
          (entry, index) =>
            index !== editingIndex &&
            entry.word.toLowerCase() === normalizedWord.toLowerCase(),
        )
      ) {
        toast.error(
          t("settings.advanced.customWords.duplicate", {
            word: normalizedWord,
          }),
        );
        return;
      }

      const entry: CustomWord = { word: normalizedWord, aliases };
      const words =
        editingIndex === null
          ? [...customWords, entry]
          : customWords.map((word, index) =>
              index === editingIndex ? entry : word,
            );
      if (await saveWords(words)) resetEditor();
    };

    const handleEditWord = (entry: CustomWord, index: number) => {
      setEditingIndex(index);
      setNewWord(entry.word);
      setNewAliases(entry.aliases.join(", "));
    };

    const handleRemoveWord = async (indexToRemove: number) => {
      if (
        !(await saveWords(
          customWords.filter((_, index) => index !== indexToRemove),
        ))
      )
        return;
      if (editingIndex === indexToRemove) resetEditor();
      else if (editingIndex !== null && indexToRemove < editingIndex)
        setEditingIndex(editingIndex - 1);
    };

    return (
      <SettingContainer
        title={t("settings.advanced.customWords.title")}
        description={t("settings.advanced.customWords.dictionaryDescription")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        layout="stacked"
      >
        <form onSubmit={handleSaveWord} className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-[200px] space-y-1">
              <label
                htmlFor={formId + "-word"}
                className="block text-xs font-medium"
              >
                {t("settings.advanced.customWords.wordLabel")}
              </label>
              <Input
                id={formId + "-word"}
                type="text"
                className="w-full"
                value={newWord}
                onChange={(event) => setNewWord(event.target.value)}
                placeholder={t("settings.advanced.customWords.placeholder")}
                variant="compact"
                disabled={updating}
              />
            </div>
            <div className="min-w-0 flex-1 basis-[200px] space-y-1">
              <label
                htmlFor={formId + "-aliases"}
                className="block text-xs font-medium"
              >
                {t("settings.advanced.customWords.aliasesLabel")}
              </label>
              <Input
                id={formId + "-aliases"}
                type="text"
                className="w-full"
                value={newAliases}
                onChange={(event) => setNewAliases(event.target.value)}
                onPaste={handlePasteAliases}
                placeholder={t(
                  "settings.advanced.customWords.aliasesPlaceholder",
                )}
                variant="compact"
                disabled={updating}
              />
            </div>
          </div>
          <p className="text-xs text-mid-gray">
            {t("settings.advanced.customWords.aliasesHelp")}
          </p>
          {tooLong && (
            <p className="text-xs text-red-500" role="alert">
              {t("settings.advanced.customWords.tooLong")}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={!normalizedWord || tooLong || updating}
              variant="primary"
              size="sm"
            >
              {t(
                editingIndex === null
                  ? "settings.advanced.customWords.add"
                  : "settings.advanced.customWords.save",
              )}
            </Button>
            {editingIndex !== null && (
              <Button
                type="button"
                onClick={resetEditor}
                disabled={updating}
                variant="secondary"
                size="sm"
              >
                {t("settings.advanced.customWords.cancel")}
              </Button>
            )}
          </div>
        </form>
        {customWords.length > 0 && (
          <div className="mt-3 divide-y divide-mid-gray/20">
            {customWords.map((entry, index) => (
              <div key={entry.word} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">
                    {entry.word}
                  </p>
                  <p className="break-words text-xs text-mid-gray">
                    {entry.aliases.length > 0
                      ? entry.aliases.join(", ")
                      : t("settings.advanced.customWords.noAliases")}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => handleEditWord(entry, index)}
                  disabled={updating}
                  variant="ghost"
                  size="sm"
                  aria-label={t("settings.advanced.customWords.edit", {
                    word: entry.word,
                  })}
                >
                  <Pencil size={14} />
                </Button>
                <Button
                  type="button"
                  onClick={() => handleRemoveWord(index)}
                  disabled={updating}
                  variant="danger-ghost"
                  size="sm"
                  aria-label={t("settings.advanced.customWords.remove", {
                    word: entry.word,
                  })}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingContainer>
    );
  },
);
