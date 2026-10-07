/**
 * Binding-id convention shared with the Rust side (`settings.rs`): a
 * post-processing prompt shortcut is stored as
 * `post_process_prompt:<prompt_id>` in the bindings map.
 */
const POST_PROCESS_PROMPT_BINDING_PREFIX = "post_process_prompt:";

export const postProcessPromptBindingId = (promptId: string): string =>
  `${POST_PROCESS_PROMPT_BINDING_PREFIX}${promptId}`;
