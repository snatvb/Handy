import assert from "node:assert/strict";
import i18n from "i18next";
import { useNoticeStore } from "./noticeStore";
import {
  commands,
  type AppSettings,
  type BindingResponse,
  type ShortcutBinding,
} from "../bindings";
import en from "../i18n/locales/en/translation.json";
import ru from "../i18n/locales/ru/translation.json";
import { useSettingsStore } from "./settingsStore";

await i18n.init({
  lng: "ru",
  fallbackLng: "en",
  resources: { en: { translation: en }, ru: { translation: ru } },
});

const binding = (id: string, current: string): ShortcutBinding => ({
  id,
  name: id === "transcribe" ? "Transcribe Shortcut" : "Translate to English",
  description: "",
  default_binding: "",
  current_binding: current,
});

const owner = binding("transcribe", "ctrl+space");
const promptId = "post_process_prompt:translate";
const conflictResponse = (owners: ShortcutBinding[]): BindingResponse => ({
  success: false,
  binding: null,
  error: "Shortcut already assigned",
  conflicting_bindings: owners,
  cleared_bindings: [],
});
const successfulResponse = (
  saved: ShortcutBinding,
  cleared: ShortcutBinding[] = [],
): BindingResponse => ({
  success: true,
  binding: saved,
  error: null,
  conflicting_bindings: [],
  cleared_bindings: cleared,
});
const setBindings = (entries: ShortcutBinding[]) => {
  // Only bindings are needed for these store operations.
  const settings = {
    bindings: Object.fromEntries(entries.map((entry) => [entry.id, entry])),
  } as AppSettings;
  useSettingsStore.setState({
    settings,
    bindingConflict: null,
    isUpdating: {},
  });
};
const current = (id: string) =>
  useSettingsStore.getState().settings?.bindings?.[id]?.current_binding;

const originalCommands = {
  changeBinding: commands.changeBinding,
  reassignBinding: commands.reassignBinding,
  resetBinding: commands.resetBinding,
};
const originalNotices = useNoticeStore.getState();
const originalConsoleError = console.error;
const messages: string[] = [];
let reassignCalls = 0;
const unsubscribeNotices = useNoticeStore.subscribe((state, previous) => {
  if (state.local !== previous.local && state.local[0]) {
    messages.push(state.local[0].title);
  }
});

try {
  console.error = () => {};
  useNoticeStore.setState({ local: [], toasts: [] });
  commands.changeBinding = async () => ({
    status: "ok",
    data: conflictResponse([owner]),
  });
  commands.reassignBinding = async () => {
    reassignCalls += 1;
    throw new Error("Reassignment must wait for confirmation");
  };

  for (const previous of ["", "ctrl+enter"]) {
    setBindings([owner, binding(promptId, previous)]);
    await useSettingsStore.getState().updateBinding(promptId, "ctrl+space");
    assert.equal(current(promptId), previous);
    assert.equal(current(owner.id), "ctrl+space");
    assert.deepEqual(useSettingsStore.getState().bindingConflict, {
      id: promptId,
      binding: "ctrl+space",
      conflicts: [owner],
    });
    assert.equal(
      useSettingsStore.getState().isUpdatingKey(`binding_${promptId}`),
      false,
    );
    assert.equal(reassignCalls, 0);
    assert.equal(
      messages.length,
      0,
      "conflicts open confirmation instead of an error toast",
    );

    useSettingsStore.getState().dismissBindingConflict();
    assert.equal(useSettingsStore.getState().bindingConflict, null);
    assert.equal(current(promptId), previous);
    assert.equal(current(owner.id), "ctrl+space");
    assert.equal(reassignCalls, 0, "cancel must not call the transfer command");
  }

  setBindings([owner, binding(promptId, "ctrl+enter")]);
  await useSettingsStore.getState().updateBinding(promptId, "ctrl+space");
  commands.reassignBinding = async (id, requested, confirmed) => {
    reassignCalls += 1;
    assert.equal(id, promptId);
    assert.equal(requested, "ctrl+space");
    assert.deepEqual(confirmed, [owner]);
    return {
      status: "ok",
      data: successfulResponse(binding(promptId, requested), [
        { ...owner, current_binding: "" },
      ]),
    };
  };
  const observed: string[][] = [];
  const unsubscribe = useSettingsStore.subscribe((state) => {
    observed.push([
      state.settings?.bindings?.transcribe?.current_binding ?? "",
      state.settings?.bindings?.[promptId]?.current_binding ?? "",
    ]);
  });
  await useSettingsStore.getState().confirmBindingConflict();
  unsubscribe();
  assert.equal(current(owner.id), "");
  assert.equal(current(promptId), "ctrl+space");
  assert.equal(useSettingsStore.getState().bindingConflict, null);
  assert.equal(reassignCalls, 1);
  assert.ok(
    observed.every(
      ([oldOwner, target]) =>
        (oldOwner === "ctrl+space" && target === "ctrl+enter") ||
        (oldOwner === "" && target === "ctrl+space"),
    ),
    "both bindings must update together",
  );

  // A new owner must be shown again without silently transferring its key.
  setBindings([owner, binding(promptId, "ctrl+enter")]);
  await useSettingsStore.getState().updateBinding(promptId, "ctrl+space");
  const newOwner = binding("post_process_prompt:new", "ctrl+space");
  commands.reassignBinding = async () => {
    reassignCalls += 1;
    return { status: "ok", data: conflictResponse([newOwner]) };
  };
  await useSettingsStore.getState().confirmBindingConflict();
  assert.deepEqual(useSettingsStore.getState().bindingConflict?.conflicts, [
    newOwner,
  ]);
  assert.equal(
    reassignCalls,
    2,
    "fresh conflicts must not trigger an automatic retry",
  );
  assert.equal(current(owner.id), "ctrl+space");
  assert.equal(current(promptId), "ctrl+enter");

  // OS/transport failure keeps the dialog and both saved bindings intact.
  commands.reassignBinding = async () => ({
    status: "error",
    error: "Registration failed",
  });
  await useSettingsStore.getState().confirmBindingConflict();
  assert.equal(current(owner.id), "ctrl+space");
  assert.equal(current(promptId), "ctrl+enter");
  assert.notEqual(useSettingsStore.getState().bindingConflict, null);
  assert.match(messages[messages.length - 1] ?? "", /Registration failed/);
  useSettingsStore.getState().dismissBindingConflict();

  // Resetting to an occupied default uses the same confirmation flow.
  setBindings([
    { ...owner, current_binding: "ctrl+enter", default_binding: "ctrl+space" },
    binding(promptId, "ctrl+space"),
  ]);
  commands.resetBinding = async () => ({
    status: "ok",
    data: conflictResponse([binding(promptId, "ctrl+space")]),
  });
  await useSettingsStore.getState().resetBinding(owner.id);
  assert.equal(useSettingsStore.getState().bindingConflict?.id, owner.id);
  assert.equal(
    useSettingsStore.getState().bindingConflict?.binding,
    "ctrl+space",
  );
  assert.equal(current(owner.id), "ctrl+enter");
  assert.equal(current(promptId), "ctrl+space");
  useSettingsStore.getState().dismissBindingConflict();

  const savedBinding = binding(promptId, "");
  commands.changeBinding = async () => ({
    status: "ok",
    data: successfulResponse(savedBinding),
  });
  await useSettingsStore.getState().updateBinding(promptId, " ");
  assert.equal(current(promptId), "");

  commands.changeBinding = async () => ({
    status: "error",
    error: "Invalid shortcut",
  });
  await assert.rejects(
    useSettingsStore.getState().updateBinding(promptId, "invalid"),
    /Invalid shortcut/,
  );
  assert.equal(current(promptId), "");
} finally {
  Object.assign(commands, originalCommands);
  unsubscribeNotices();
  useNoticeStore.setState(originalNotices);
  console.error = originalConsoleError;
}

console.log("settingsStore: all assertions passed");
