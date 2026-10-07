import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { commands, type LLMPrompt } from "@/bindings";
import { SettingContainer } from "@/components/ui";
import { useSettings } from "../../../hooks/useSettings";
import { postProcessPromptBindingId } from "../../../lib/postProcessPrompts";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import type { ModelOption } from "../PostProcessingSettingsApi/types";
import { ShortcutInput } from "../ShortcutInput";

const APPLE_PROVIDER_ID = "apple_intelligence";

const PromptShortcutRow: React.FC<{ prompt: LLMPrompt }> = ({ prompt }) => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const globalProviderId = getSetting("post_process_provider_id") || "";
  const effectiveProviderId = prompt.provider_id ?? globalProviderId;
  const isAppleProvider = effectiveProviderId === APPLE_PROVIDER_ID;
  const globalModel =
    getSetting("post_process_models")?.[effectiveProviderId] ?? "";

  const fetchModels = useCallback(async () => {
    if (isAppleProvider) {
      setFetchedModels([]);
      return;
    }
    setIsFetchingModels(true);
    try {
      const result = await commands.fetchPostProcessModels(effectiveProviderId);
      if (result.status === "ok") {
        setFetchedModels(result.data);
      }
    } catch (error) {
      console.error("Failed to fetch models:", error);
    } finally {
      setIsFetchingModels(false);
    }
  }, [effectiveProviderId, isAppleProvider]);

  // Populate the model dropdown once per effective provider
  useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const handleModelSelect = async (value: string) => {
    const model = value.trim();
    const result = await commands.setPostProcessPromptModel(
      prompt.id,
      model || null,
    );
    if (result.status === "ok") {
      await refreshSettings();
    }
  };

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];
    const upsert = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    };
    for (const candidate of fetchedModels) {
      upsert(candidate);
    }
    // The current override must stay selectable even when not in the list
    upsert(prompt.model ?? undefined);
    return options;
  }, [fetchedModels, prompt.model]);

  return (
    <SettingContainer
      title={prompt.name}
      description={t("settings.postProcessing.shortcuts.rowDescription")}
      descriptionMode="tooltip"
      layout="stacked"
      grouped={true}
    >
      <div className="flex items-center gap-2 justify-between">
        {!isAppleProvider && (
          <ModelSelect
            value={prompt.model ?? ""}
            options={modelOptions}
            isLoading={isFetchingModels}
            placeholder={t("settings.postProcessing.shortcuts.useGlobalModel", {
              model:
                globalModel.trim() ||
                t("settings.postProcessing.shortcuts.noModelConfigured"),
            })}
            onSelect={(value) => void handleModelSelect(value)}
            onCreate={(value) => void handleModelSelect(value)}
            onBlur={() => {}}
            className="min-w-[200px] max-w-[420px]"
          />
        )}
        <ShortcutInput
          shortcutId={postProcessPromptBindingId(prompt.id)}
          inline
          unboundLabel={t("settings.postProcessing.shortcuts.unbound")}
          buttonClassName="min-h-10 px-3 inline-flex items-center justify-center"
        />
      </div>
    </SettingContainer>
  );
};

/**
 * One row per post-processing prompt: its own global shortcut and an optional
 * model override for the prompt's LLM call. The provider and API key come
 * from the global post-processing API settings above.
 */
export const PromptShortcutsSettings: React.FC = () => {
  const { getSetting } = useSettings();
  const prompts = getSetting("post_process_prompts") || [];

  if (prompts.length === 0) {
    return null;
  }

  return (
    <>
      {prompts.map((prompt) => (
        <PromptShortcutRow key={prompt.id} prompt={prompt} />
      ))}
    </>
  );
};
