import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import type { CustomWord } from "@/bindings";
import {
  createCustomWord,
  isCustomWordTooLong,
  normalizeAliases,
} from "@/lib/utils/customWords";
import { isComposingKeyEvent } from "@/lib/utils/keyboard";
import { Button } from "../../ui/Button";
import { Input } from "../../ui/Input";

interface CustomWordEditorProps {
  initial: CustomWord;
  disabled: boolean;
  onSave: (entry: CustomWord) => Promise<string | null>;
  onCancel: () => void;
}

export function CustomWordEditor({
  initial,
  disabled,
  onSave,
  onCancel,
}: CustomWordEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [word, setWord] = useState(initial.word);
  const [aliases, setAliases] = useState(initial.aliases);
  const [pending, setPending] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const entry = createCustomWord(word, aliases, pending);
  const tooLong = isCustomWordTooLong(entry);
  const busy = disabled || saving;

  const commitAlias = () => {
    setAliases(
      normalizeAliases([...aliases, ...pending.split(/[,\r\n]+/)], word),
    );
    setPending("");
  };

  return (
    <form
      className="space-y-4"
      aria-label={t("replacements.editor")}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!entry.word || tooLong || busy) {
          return;
        }
        setSaving(true);
        setError(null);
        try {
          setError(await onSave(entry));
        } finally {
          setSaving(false);
        }
      }}
      onKeyDown={(event) => {
        if (isComposingKeyEvent(event.nativeEvent)) {
          if (event.key === "Enter") {
            event.preventDefault();
          }
          return;
        }
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="space-y-2">
        <label htmlFor={`${id}-aliases`} className="block text-sm font-medium">
          {t("settings.advanced.customWords.aliasesLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          {aliases.map((alias, index) => (
            <span
              key={alias}
              className="inline-flex max-w-full items-center gap-1 rounded-lg bg-logo-primary/10 py-1 ps-2 pe-1 text-sm"
            >
              <span className="break-words min-w-0">{alias}</span>
              <button
                type="button"
                className="shrink-0 rounded p-1 hover:bg-logo-primary/20 focus-visible:outline-2 focus-visible:outline-logo-primary disabled:opacity-50"
                aria-label={t("replacements.removeVariant", { variant: alias })}
                disabled={busy}
                onClick={() =>
                  setAliases(
                    aliases.filter((_, position) => position !== index),
                  )
                }
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            id={`${id}-aliases`}
            className="min-w-0 flex-1"
            value={pending}
            placeholder={t("replacements.variantPlaceholder")}
            aria-describedby={`${id}-help`}
            disabled={busy}
            onChange={(event) => {
              setPending(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (isComposingKeyEvent(event.nativeEvent)) {
                return;
              }
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commitAlias();
              }
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (!/[,\r\n]/.test(pasted)) {
                return;
              }
              event.preventDefault();
              const input = event.currentTarget;
              const start = input.selectionStart ?? pending.length;
              const end = input.selectionEnd ?? start;
              const combined =
                pending.slice(0, start) + pasted + pending.slice(end);
              setAliases(
                normalizeAliases(
                  [...aliases, ...combined.split(/[,\r\n]+/)],
                  word,
                ),
              );
              setPending("");
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !pending.trim()}
            onClick={commitAlias}
            aria-label={t("replacements.addVariant")}
          >
            <Plus size={16} aria-hidden="true" />
          </Button>
        </div>
        <p id={`${id}-help`} className="text-xs text-mid-gray">
          {t("replacements.variantHelp")}
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor={`${id}-word`} className="block text-sm font-medium">
          {t("replacements.replaceWith")}
        </label>
        <Input
          id={`${id}-word`}
          className="w-full"
          value={word}
          autoFocus
          disabled={busy}
          placeholder={t("settings.advanced.customWords.placeholder")}
          aria-invalid={tooLong || !!error}
          aria-describedby={tooLong || error ? `${id}-error` : undefined}
          onChange={(event) => {
            setWord(event.target.value);
            setError(null);
          }}
        />
      </div>
      {(tooLong || error) && (
        <p id={`${id}-error`} className="text-sm text-error" role="alert">
          {tooLong ? t("settings.advanced.customWords.tooLong") : error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!entry.word || tooLong || busy}>
          {t("settings.advanced.customWords.save")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          {t("settings.advanced.customWords.cancel")}
        </Button>
      </div>
    </form>
  );
}
