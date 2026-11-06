import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, Pencil, Plus, Replace, Trash2 } from "lucide-react";
import type { CustomWord } from "@/bindings";
import { hasDuplicateCustomWord } from "@/lib/utils/customWords";
import { notify } from "@/stores/noticeStore";
import { useSettings } from "../../hooks/useSettings";
import { Button } from "../ui/Button";
import { CustomWordEditor } from "./replacements/CustomWordEditor";

interface Editor {
  index: number | null;
  initial: CustomWord;
}

export function CustomWords() {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const [editor, setEditor] = useState<Editor | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusTarget = useRef<number | null | undefined>(undefined);
  const words = getSetting("custom_words") ?? [];
  const updating = isUpdating("custom_words");

  useLayoutEffect(() => {
    if (editor || updating || focusTarget.current === undefined) {
      return;
    }
    const selector =
      focusTarget.current === null
        ? "[data-add-replacement]"
        : `[data-edit-index="${focusTarget.current}"]`;
    sectionRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    focusTarget.current = undefined;
  }, [editor, updating]);

  const closeEditor = (index: number | null) => {
    focusTarget.current = index;
    setEditor(null);
  };

  const saveWords = async (next: CustomWord[]): Promise<boolean> => {
    await updateSetting("custom_words", next);
    return JSON.stringify(getSetting("custom_words")) === JSON.stringify(next);
  };

  const saveEntry = async (entry: CustomWord): Promise<string | null> => {
    if (!editor) {
      return null;
    }
    if (hasDuplicateCustomWord(words, entry.word, editor.index)) {
      return t("settings.advanced.customWords.duplicate", { word: entry.word });
    }
    const next =
      editor.index === null
        ? [...words, entry]
        : words.map((word, index) => (index === editor.index ? entry : word));
    if (!(await saveWords(next))) {
      return t("settings.advanced.customWords.saveFailed");
    }
    closeEditor(editor.index ?? words.length);
    return null;
  };

  const renderEditor = () =>
    editor && (
      <CustomWordEditor
        initial={editor.initial}
        disabled={updating}
        onSave={saveEntry}
        onCancel={() => closeEditor(editor.index)}
      />
    );

  return (
    <section ref={sectionRef} className="mx-auto w-full max-w-3xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-xl font-semibold">{t("replacements.title")}</h1>
          <p className="text-sm text-mid-gray">
            {t("replacements.description")}
          </p>
        </div>
        <Button
          type="button"
          data-add-replacement
          className="inline-flex items-center gap-2"
          disabled={!!editor || updating}
          onClick={() =>
            setEditor({ index: null, initial: { word: "", aliases: [] } })
          }
        >
          <Plus size={16} aria-hidden="true" />
          {t("replacements.add")}
        </Button>
      </header>
      {editor?.index === null && (
        <div className="rounded-xl border border-logo-primary/50 bg-wash p-4">
          {renderEditor()}
        </div>
      )}
      {words.length === 0 && !editor && (
        <div className="rounded-xl bg-wash px-6 py-10 text-center text-mid-gray">
          <Replace size={28} className="mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm">{t("replacements.empty")}</p>
        </div>
      )}
      <div className="space-y-3">
        {words.map((entry, index) => (
          <article
            key={index}
            className={`rounded-xl bg-wash p-4 ${editor?.index === index ? "ring-1 ring-logo-primary/50" : ""}`}
          >
            {editor?.index === index ? (
              renderEditor()
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {entry.aliases.length > 0 ? (
                      entry.aliases.map((alias) => (
                        <span
                          key={alias}
                          className="max-w-full break-words rounded-md bg-background px-2 py-1 text-mid-gray"
                        >
                          {alias}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-mid-gray">
                        {t("settings.advanced.customWords.noAliases")}
                      </span>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowRight
                      size={18}
                      className="mt-0.5 shrink-0 text-logo-primary rtl:rotate-180"
                      aria-hidden="true"
                    />
                    <span className="break-words min-w-0 font-semibold">
                      {entry.word}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    data-edit-index={index}
                    variant="ghost"
                    size="sm"
                    disabled={!!editor || updating}
                    aria-label={t("settings.advanced.customWords.edit", {
                      word: entry.word,
                    })}
                    onClick={() => setEditor({ index, initial: entry })}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="danger-ghost"
                    size="sm"
                    disabled={!!editor || updating}
                    aria-label={t("settings.advanced.customWords.remove", {
                      word: entry.word,
                    })}
                    onClick={async () => {
                      if (
                        !(await saveWords(
                          words.filter((_, position) => position !== index),
                        ))
                      ) {
                        notify({ title: t("replacements.deleteFailed") });
                      }
                    }}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
