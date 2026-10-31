use handy_keys::{Hotkey, Modifiers};
use tauri_plugin_global_shortcut::Shortcut;

use crate::settings::{AppSettings, KeyboardImplementation, ShortcutBinding};

enum ParsedShortcut {
    Tauri(Shortcut),
    HandyKeys(Hotkey),
}

impl ParsedShortcut {
    fn parse(raw: &str, implementation: KeyboardImplementation) -> Option<Self> {
        match implementation {
            KeyboardImplementation::Tauri => raw.parse().ok().map(Self::Tauri),
            KeyboardImplementation::HandyKeys => raw.parse().ok().map(Self::HandyKeys),
        }
    }

    fn conflicts_with(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Tauri(left), Self::Tauri(right)) => left == right,
            (Self::HandyKeys(left), Self::HandyKeys(right)) => {
                left.key == right.key
                    && [
                        Modifiers::CTRL,
                        Modifiers::OPT,
                        Modifiers::SHIFT,
                        Modifiers::CMD,
                        Modifiers::FN,
                    ]
                    .into_iter()
                    .all(|group| {
                        let left = left.modifiers & group;
                        let right = right.modifiers & group;
                        // A generic modifier matches either side, so it also
                        // conflicts with a binding that specifies that side.
                        (left.is_empty() && right.is_empty()) || left.intersects(right)
                    })
            }
            _ => false,
        }
    }
}

/// Check saved bindings, including cancel and disabled prompt shortcuts.
/// Registration state is insufficient: all shortcuts are suspended during capture.
pub(super) fn find_binding_conflicts(
    settings: &AppSettings,
    binding_id: &str,
    raw: &str,
) -> Vec<ShortcutBinding> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let Some(shortcut) = ParsedShortcut::parse(raw, settings.keyboard_implementation) else {
        return Vec::new();
    };

    let mut conflicts: Vec<_> = settings
        .bindings
        .iter()
        .filter_map(|(id, binding)| {
            if id == binding_id || binding.current_binding.trim().is_empty() {
                return None;
            }
            let other =
                ParsedShortcut::parse(&binding.current_binding, settings.keyboard_implementation)?;
            shortcut.conflicts_with(&other).then(|| binding.clone())
        })
        .collect();
    conflicts.sort_by(|left, right| left.id.cmp(&right.id));
    conflicts
}

pub(super) struct BindingChange {
    pub binding: ShortcutBinding,
    pub conflicts: Vec<ShortcutBinding>,
}

impl BindingChange {
    /// Apply a fully registered change in one settings write. Keep entries and
    /// defaults so released global shortcuts remain unbound across restarts.
    pub fn apply(&self, settings: &mut AppSettings) -> Vec<ShortcutBinding> {
        let cleared: Vec<_> = self
            .conflicts
            .iter()
            .map(|conflict| {
                let mut binding = conflict.clone();
                binding.current_binding.clear();
                settings
                    .bindings
                    .insert(binding.id.clone(), binding.clone());
                binding
            })
            .collect();
        settings
            .bindings
            .insert(self.binding.id.clone(), self.binding.clone());
        cleared
    }
}

/// Require confirmation for every current conflict, using the binding value
/// shown in the dialog. A changed/new owner must be shown and confirmed again.
pub(super) fn prepare_binding_change(
    settings: &AppSettings,
    mut binding: ShortcutBinding,
    raw: &str,
    confirmed_conflicts: &[ShortcutBinding],
) -> Result<BindingChange, Vec<ShortcutBinding>> {
    let conflicts = find_binding_conflicts(settings, &binding.id, raw);
    if conflicts.iter().any(|conflict| {
        !confirmed_conflicts.iter().any(|confirmed| {
            confirmed.id == conflict.id && confirmed.current_binding == conflict.current_binding
        })
    }) {
        return Err(conflicts);
    }
    binding.current_binding = if raw.trim().is_empty() {
        String::new()
    } else {
        raw.to_string()
    };
    Ok(BindingChange { binding, conflicts })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::get_default_settings;

    fn settings_with_bindings(
        implementation: KeyboardImplementation,
        bindings: &[(&str, &str)],
    ) -> AppSettings {
        let mut settings = get_default_settings();
        settings.keyboard_implementation = implementation;
        settings.post_process_enabled = false;
        settings.bindings = bindings
            .iter()
            .map(|(id, raw)| {
                (
                    id.to_string(),
                    ShortcutBinding {
                        id: id.to_string(),
                        name: id.to_string(),
                        description: String::new(),
                        default_binding: String::new(),
                        current_binding: raw.to_string(),
                    },
                )
            })
            .collect();
        settings
    }

    #[test]
    fn prompt_and_global_shortcuts_share_one_namespace_even_when_disabled() {
        for implementation in [
            KeyboardImplementation::Tauri,
            KeyboardImplementation::HandyKeys,
        ] {
            for (owner, target) in [
                ("transcribe", "post_process_prompt:a"),
                ("post_process_prompt:a", "transcribe"),
                ("post_process_prompt:a", "post_process_prompt:b"),
                ("transcribe", "cancel"),
                ("cancel", "transcribe"),
                ("cancel", "post_process_prompt:a"),
                ("post_process_prompt:a", "cancel"),
            ] {
                let settings = settings_with_bindings(implementation, &[(owner, "ctrl+space")]);
                let conflicts = find_binding_conflicts(&settings, target, "ctrl+space");
                assert_eq!(conflicts.len(), 1);
                assert_eq!(conflicts[0].id, owner);
            }
        }
    }

    #[test]
    fn aliases_case_and_modifier_order_do_not_allow_duplicates() {
        for implementation in [
            KeyboardImplementation::Tauri,
            KeyboardImplementation::HandyKeys,
        ] {
            let settings =
                settings_with_bindings(implementation, &[("transcribe", "ctrl+alt+shift+space")]);
            assert!(!find_binding_conflicts(
                &settings,
                "post_process_prompt:a",
                "Shift+Option+Control+Space"
            )
            .is_empty());
        }
    }

    #[test]
    fn own_binding_unbinding_and_distinct_combinations_are_allowed() {
        for implementation in [
            KeyboardImplementation::Tauri,
            KeyboardImplementation::HandyKeys,
        ] {
            let settings = settings_with_bindings(
                implementation,
                &[("transcribe", "ctrl+space"), ("post_process_prompt:a", "")],
            );
            assert!(find_binding_conflicts(&settings, "transcribe", "ctrl+space").is_empty());
            for raw in ["", " ", "ctrl+shift+space", "ctrl+enter", "alt+space"] {
                assert!(find_binding_conflicts(&settings, "post_process_prompt:b", raw).is_empty());
            }
        }
    }

    #[test]
    fn handy_keys_checks_overlapping_sides_and_modifier_only_shortcuts() {
        for (stored, requested, conflicts) in [
            ("option+space", "alt_left+space", true),
            ("option_left+space", "alt+space", true),
            ("option_left+space", "option_right+space", false),
            ("ctrl_left+shift+space", "ctrl+shift_right+space", true),
            ("ctrl_left+shift+space", "ctrl_right+shift+space", false),
            ("command+shift", "shift+meta", true),
            ("fn", "function", true),
            ("fn", "fn+shift", false),
        ] {
            let settings = settings_with_bindings(
                KeyboardImplementation::HandyKeys,
                &[("transcribe", stored)],
            );
            assert_eq!(
                !find_binding_conflicts(&settings, "post_process_prompt:a", requested).is_empty(),
                conflicts,
                "{stored} vs {requested}"
            );
        }
    }

    #[test]
    fn confirmation_releases_all_owners_and_preserves_global_defaults() {
        let mut settings = settings_with_bindings(
            KeyboardImplementation::Tauri,
            &[
                ("transcribe", "ctrl+space"),
                ("post_process_prompt:a", "ctrl+space"),
                ("post_process_prompt:b", "ctrl+enter"),
                ("cancel", "esc"),
            ],
        );
        settings
            .bindings
            .get_mut("transcribe")
            .unwrap()
            .default_binding = "ctrl+space".into();
        let target = settings.bindings["post_process_prompt:b"].clone();
        let conflicts = prepare_binding_change(&settings, target.clone(), "ctrl+space", &[])
            .err()
            .expect("confirmation is required");
        assert_eq!(conflicts.len(), 2);
        assert_eq!(
            settings.bindings["post_process_prompt:b"].current_binding,
            "ctrl+enter"
        );
        assert!(
            prepare_binding_change(&settings, target.clone(), "ctrl+space", &conflicts[..1])
                .is_err()
        );

        let change = prepare_binding_change(&settings, target, "ctrl+space", &conflicts)
            .expect("all owners were confirmed");
        let cleared = change.apply(&mut settings);
        assert_eq!(cleared.len(), 2);
        assert_eq!(settings.bindings["transcribe"].current_binding, "");
        assert_eq!(
            settings.bindings["transcribe"].default_binding,
            "ctrl+space"
        );
        assert_eq!(
            settings.bindings["post_process_prompt:a"].current_binding,
            ""
        );
        assert_eq!(
            settings.bindings["post_process_prompt:b"].current_binding,
            "ctrl+space"
        );
        assert_eq!(settings.bindings["cancel"].current_binding, "esc");
        let saved = serde_json::to_value(&settings).unwrap();
        let restored: AppSettings = serde_json::from_value(saved).unwrap();
        assert_eq!(restored.bindings["transcribe"].current_binding, "");
    }

    #[test]
    fn new_or_changed_conflicts_require_fresh_confirmation() {
        let mut settings = settings_with_bindings(
            KeyboardImplementation::HandyKeys,
            &[
                ("transcribe", "ctrl+space"),
                ("post_process_prompt:a", ""),
                ("post_process_prompt:b", ""),
            ],
        );
        let target = settings.bindings["post_process_prompt:a"].clone();
        let confirmed = find_binding_conflicts(&settings, &target.id, "ctrl+space");
        settings
            .bindings
            .get_mut("transcribe")
            .unwrap()
            .current_binding = "ctrl_left+space".into();
        assert!(
            prepare_binding_change(&settings, target.clone(), "ctrl+space", &confirmed).is_err()
        );
        settings
            .bindings
            .get_mut("transcribe")
            .unwrap()
            .current_binding
            .clear();
        settings
            .bindings
            .get_mut("post_process_prompt:b")
            .unwrap()
            .current_binding = "ctrl+space".into();
        assert!(
            prepare_binding_change(&settings, target.clone(), "ctrl+space", &confirmed).is_err()
        );
        settings
            .bindings
            .get_mut("post_process_prompt:b")
            .unwrap()
            .current_binding
            .clear();
        let change = prepare_binding_change(&settings, target, "ctrl+space", &confirmed)
            .expect("the shortcut has become free");
        assert!(change.conflicts.is_empty());
    }
}
