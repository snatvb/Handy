import React from "react";
import { useSettings } from "../../hooks/useSettings";
import { GlobalShortcutInput } from "./GlobalShortcutInput";
import { HandyKeysShortcutInput } from "./HandyKeysShortcutInput";

interface ShortcutInputProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  shortcutId: string;
  disabled?: boolean;
  /** Override the container title instead of the binding's name. */
  titleOverride?: string;
  /** Override the container description instead of the binding's description. */
  descriptionOverride?: string;
  /** Label shown instead of the keys when the binding has no shortcut set. */
  unboundLabel?: string;
  /** Render just the hotkey control without the surrounding settings row. */
  inline?: boolean;
}

/**
 * Wrapper component that selects the appropriate shortcut input implementation
 * based on the keyboard_implementation setting.
 *
 * - "tauri" (default): Uses GlobalShortcutInput with JS keyboard events
 * - "handy_keys": Uses HandyKeysShortcutInput with backend key events
 */
export const ShortcutInput: React.FC<ShortcutInputProps> = (props) => {
  const { getSetting } = useSettings();
  const keyboardImplementation = getSetting("keyboard_implementation");

  // Default to Tauri implementation if not set
  if (keyboardImplementation === "handy_keys") {
    return <HandyKeysShortcutInput {...props} />;
  }

  return <GlobalShortcutInput {...props} />;
};
