import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { commands, type AppSettings } from "../../src/bindings";
import {
  Sidebar,
  SECTIONS_CONFIG,
  type SidebarSection,
} from "../../src/components/Sidebar";
import { useSettingsStore } from "../../src/stores/settingsStore";
import en from "../../src/i18n/locales/en/translation.json";
import ru from "../../src/i18n/locales/ru/translation.json";
import "../../src/App.css";

await i18n.use(initReactI18next).init({
  lng: new URLSearchParams(location.search).get("lang") ?? "en",
  fallbackLng: "en",
  resources: { en: { translation: en }, ru: { translation: ru } },
  interpolation: { escapeValue: false },
});

const initialWords = [
  { word: "JSX", aliases: ["GSX", "джсикс"] },
  { word: "Sonnet", aliases: ["сонет", "сонат"] },
];
useSettingsStore.setState({
  isLoading: false,
  settings: {
    custom_words: JSON.parse(
      sessionStorage.getItem("words") ?? JSON.stringify(initialWords),
    ),
  } as AppSettings,
});
commands.updateCustomWords = async (words) => {
  if (new URLSearchParams(location.search).has("slow")) {
    await new Promise<void>((resolve) => {
      (window as unknown as { finishSave: () => void }).finishSave = resolve;
    });
  }
  if (new URLSearchParams(location.search).has("fail")) {
    return { status: "error", error: "Test persistence failure" };
  }
  sessionStorage.setItem("words", JSON.stringify(words));
  return { status: "ok", data: null };
};

function SettingsFixture() {
  const [section, setSection] = useState<SidebarSection>("general");
  const Component = SECTIONS_CONFIG[section].component;
  return (
    <div className="flex h-screen bg-background text-text">
      <Sidebar activeSection={section} onSectionChange={setSection} />
      <main className="min-w-0 flex-1 overflow-auto p-6">
        {section !== "general" && Component && <Component />}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SettingsFixture />);
