//! Keep Windows' system menu from consuming Alt+Space during shortcut capture.

use handy_keys::{BlockingHotkeys, Hotkey, Key, KeyboardListener, Modifiers};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

fn blocking_hotkeys(is_windows: bool) -> Option<BlockingHotkeys> {
    if !is_windows {
        return None;
    }
    // Observe the combo before swallowing it. The Windows listener also injects
    // its menu mask so releasing Alt cannot activate the menu bar afterward.
    // Blocking lives on this listener only and ends when capture drops it.
    Some(Arc::new(Mutex::new(HashSet::from([Hotkey {
        modifiers: Modifiers::OPT,
        key: Some(Key::Space),
    }]))))
}

pub(super) fn new_listener() -> handy_keys::Result<KeyboardListener> {
    match blocking_hotkeys(cfg!(target_os = "windows")) {
        Some(hotkeys) => KeyboardListener::new_with_blocking(hotkeys),
        None => KeyboardListener::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_capture_blocks_alt_space_for_either_alt_key() {
        let hotkeys = blocking_hotkeys(true).expect("Windows needs capture blocking");
        let hotkeys = hotkeys.lock().expect("blocking hotkeys lock");
        for modifiers in [Modifiers::OPT_LEFT, Modifiers::OPT_RIGHT, Modifiers::OPT] {
            assert!(hotkeys.iter().any(|hotkey| {
                hotkey.key == Some(Key::Space) && hotkey.modifiers.matches(modifiers)
            }));
        }
    }

    #[test]
    fn capture_does_not_swallow_unrelated_keys_or_modifier_presses() {
        let hotkeys = blocking_hotkeys(true).expect("Windows needs capture blocking");
        let hotkeys = hotkeys.lock().expect("blocking hotkeys lock");
        assert_eq!(hotkeys.len(), 1);
        assert!(hotkeys.iter().all(|hotkey| hotkey.key.is_some()));
    }

    #[test]
    fn other_platforms_keep_non_blocking_capture() {
        assert!(blocking_hotkeys(false).is_none());
    }
}
