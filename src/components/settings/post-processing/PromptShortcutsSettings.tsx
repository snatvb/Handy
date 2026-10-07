import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCcw } from "lucide-react";

import { commands, type LLMPrompt } from "@/bindings";
import { Dropdown, SettingContainer } from "@/components/ui";
import { ResetButton } from "../../ui/ResetButton";
import { useSettings } from "../../../hooks/useSettings";
import { postProcessPromptBindingId } from "../../../lib/postProcessPrompts";
import { ModelSelect } from "../PostProcessingSettingsApi/ModelSelect";
import type { ModelOption } from "../PostProcessingSettingsApi/types";
import { ShortcutInput } from "../ShortcutInput";

const APPLE_PROVIDER_ID = "apple_intelligence";
/** Sentinel dropdown value meaning "no provider override". */
const GLOBAL_PROVIDER_VALUE = "__use_global__";

const PromptShortcutRow: React.FC<{ prompt: LLMPrompt }> = ({ prompt }) => {
  const { t } = useTranslation();
  const { getSetting, refreshSettings } = useSettings();
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);

  const providers = getSetting("post_process_providers") || [];
  const globalProviderId = getSetting("post_process_provider_id") || "";
  const globalProvider = providers.find((p) => p.id === globalProviderId);
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

  const providerOptions = useMemo(() => {
    return [
      {
        value: GLOBAL_PROVIDER_VALUE,
        label: t("settings.postProcessing.shortcuts.useGlobalProvider", {
          label: globalProvider?.label ?? globalProviderId,
        }),
      },
      ...providers.map((provider) => ({
        value: provider.id,
        label: provider.label,
      })),
    ];
  }, [providers, globalProvider, globalProviderId, t]);

  const handleProviderSelect = async (value: string) => {
    const providerId = value === GLOBAL_PROVIDER_VALUE ? null : value;
    if ((prompt.provider_id ?? null) === providerId) return;
    const result = await commands.setPostProcessPromptProvider(
      prompt.id,
      providerId,
    );
    if (result.status === "error") return;
    // A model override picked for the previous provider rarely fits the new
    // one — clear it so the prompt falls back to the provider's global model.
    if (prompt.model) {
      await commands.setPostProcessPromptModel(prompt.id, null);
    }
    await refreshSettings();
  };

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

  const handleModelReset = async () => {
    const result = await commands.setPostProcessPromptModel(prompt.id, null);
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
      layout="horizontal"
      grouped={true}
    >
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <ShortcutInput
          shortcutId={postProcessPromptBindingId(prompt.id)}
          inline
          unboundLabel={t("settings.postProcessing.shortcuts.unbound")}
        />
        <Dropdown
          options={providerOptions}
          selectedValue={prompt.provider_id ?? GLOBAL_PROVIDER_VALUE}
          onSelect={(value) => void handleProviderSelect(value)}
          className="w-48"
        />
        {!isAppleProvider && (
          <>
            <ModelSelect
              value={prompt.model ?? ""}
              options={modelOptions}
              isLoading={isFetchingModels}
              placeholder={t(
                "settings.postProcessing.shortcuts.useGlobalModel",
                {
                  model:
                    globalModel.trim() ||
                    t("settings.postProcessing.shortcuts.noModelConfigured"),
                },
              )}
              onSelect={(value) => void handleModelSelect(value)}
              onCreate={(value) => void handleModelSelect(value)}
              onBlur={() => {}}
              className="w-56"
            />
            <ResetButton
              onClick={() => void handleModelReset()}
              disabled={!prompt.model}
              ariaLabel={t("settings.postProcessing.shortcuts.resetModel")}
            />
            <ResetButton
              onClick={() => void fetchModels()}
              disabled={isFetchingModels}
              ariaLabel={t("settings.postProcessing.api.model.refreshModels")}
              className="flex h-10 w-10 items-center justify-center"
            >
              <RefreshCcw
                className={`h-4 w-4 ${isFetchingModels ? "animate-spin" : ""}`}
              />
            </ResetButton>
          </>
        )}
      </div>
    </SettingContainer>
  );
};

/**
 * One row per post-processing prompt: its own global shortcut, plus optional
 * provider and model overrides for the prompt's LLM call.
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
