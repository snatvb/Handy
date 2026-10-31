import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { useSettingsStore } from "../../stores/settingsStore";
import { useOsType } from "../../hooks/useOsType";
import { formatKeyCombination } from "../../lib/utils/keyboard";

export const BindingConflictDialog: React.FC<{ shortcutId: string }> = ({
  shortcutId,
}) => {
  const { t } = useTranslation();
  const osType = useOsType();
  const {
    settings,
    bindingConflict,
    isUpdatingKey,
    confirmBindingConflict,
    dismissBindingConflict,
  } = useSettingsStore();
  const pending = bindingConflict?.id === shortcutId ? bindingConflict : null;
  if (!pending) return null;

  const isSaving = isUpdatingKey(`binding_${shortcutId}`);
  const bindingName = (id: string, fallback: string) =>
    t(`settings.general.shortcut.bindings.${id}.name`, fallback);
  const target = settings?.bindings?.[shortcutId];

  return (
    <Dialog
      open
      title={t("settings.general.shortcut.conflict.title")}
      description={t("settings.general.shortcut.conflict.description", {
        shortcut: formatKeyCombination(pending.binding, osType),
        target: bindingName(shortcutId, target?.name ?? shortcutId),
      })}
      closeLabel={t("settings.general.shortcut.conflict.cancel")}
      dismissible={!isSaving}
      onOpenChange={(open) => {
        if (!open) dismissBindingConflict();
      }}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={dismissBindingConflict}
            disabled={isSaving}
          >
            {t("settings.general.shortcut.conflict.cancel")}
          </Button>
          <Button
            onClick={() => void confirmBindingConflict()}
            disabled={isSaving}
          >
            {t("settings.general.shortcut.conflict.reassign")}
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {t("settings.general.shortcut.conflict.releasedActions")}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
        {pending.conflicts.map((binding) => (
          <li key={binding.id}>{bindingName(binding.id, binding.name)}</li>
        ))}
      </ul>
    </Dialog>
  );
};
