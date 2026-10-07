use crate::settings::CustomWord;
use natural::phonetics::soundex;
use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::BTreeMap;
use strsim::damerau_levenshtein;

fn build_match_key(word: &str) -> String {
    word.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

struct CustomWordMatchKey {
    word_index: usize,
    term_len: usize,
    key: String,
}

fn build_custom_word_match_keys(
    source: &str,
    word_index: usize,
    term_len: usize,
) -> Vec<CustomWordMatchKey> {
    // Do not erase meaningful symbols from C++ or C#. Their literal spelling
    // and explicitly configured aliases still match.
    if source
        .chars()
        .any(|c| !c.is_alphanumeric() && !c.is_whitespace() && !matches!(c, '&' | '-' | '.'))
    {
        return Vec::new();
    }
    let primary_key = build_match_key(source);
    let mut keys = Vec::with_capacity(2);
    if is_supported_fuzzy_key(&primary_key) {
        keys.push(CustomWordMatchKey {
            word_index,
            term_len,
            key: primary_key.clone(),
        });
    }
    if source.contains('&') {
        let expanded_key = build_match_key(&source.replace('&', " and "));
        if is_supported_fuzzy_key(&expanded_key) && expanded_key != primary_key {
            keys.push(CustomWordMatchKey {
                word_index,
                term_len,
                key: expanded_key,
            });
        }
    }
    keys
}

fn is_supported_fuzzy_key(key: &str) -> bool {
    // Exact replacements support every script; fuzzy matching is limited to
    // Latin/ASCII and Cyrillic words with whitespace boundaries.
    !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ('\u{0400}'..='\u{052f}').contains(&c))
}

fn supports_soundex(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphabetic())
}

/// Selects a unique nearby term, scoring all aliases of a term together.
fn find_best_match<'a>(
    candidate: &str,
    custom_words: &'a [CustomWord],
    keys: &[CustomWordMatchKey],
    threshold: f64,
) -> Option<(&'a String, f64)> {
    let candidate_len = candidate.chars().count();
    if !is_supported_fuzzy_key(candidate) || candidate_len > 50 {
        return None;
    }
    let mut scores = vec![f64::INFINITY; custom_words.len()];
    for key in keys {
        let word_index = key.word_index;
        if candidate == key.key {
            scores[word_index] = 0.0;
            continue;
        }
        // Short terms/acronyms and numbers require an exact spelling or alias.
        let key_len = key.key.chars().count();
        if key.term_len < 5
            || candidate_len < 4
            || key_len < 5
            || candidate.chars().any(|c| c.is_numeric())
            || key.key.chars().any(|c| c.is_numeric())
            || candidate_len.abs_diff(key_len) > 2
        {
            continue;
        }
        let distance = damerau_levenshtein(candidate, &key.key);
        if distance > 2 || (candidate_len < 5 && distance > 1) {
            continue;
        }
        let edit_score = distance as f64 / candidate_len.max(key_len) as f64;
        // Keep the existing English pronunciation aid only for nearby
        // spellings. Cyrillic uses edit distance without English Soundex.
        let phonetic = edit_score <= 0.35
            && supports_soundex(candidate)
            && supports_soundex(&key.key)
            && soundex(candidate, &key.key);
        let score = if phonetic {
            edit_score * 0.3
        } else {
            edit_score
        };
        if score < threshold {
            scores[word_index] = scores[word_index].min(score);
        }
    }
    let mut matches: Vec<_> = scores
        .into_iter()
        .enumerate()
        .filter(|(_, score)| score.is_finite())
        .collect();
    matches.sort_by(|a, b| a.1.total_cmp(&b.1));
    let &(word_index, score) = matches.first()?;
    if let Some((_, next_score)) = matches.get(1) {
        let ambiguous = if score == 0.0 {
            *next_score == 0.0
        } else {
            *next_score - score < 0.05
        };
        if ambiguous {
            return None;
        }
    }
    Some((&custom_words[word_index].word, score))
}

static DICTIONARY_WORD_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\p{L}\p{M}\p{N}_]+").unwrap());

fn apply_fuzzy_words(
    text: &str,
    custom_words: &[CustomWord],
    keys: &[CustomWordMatchKey],
    threshold: f64,
    max_words: usize,
) -> String {
    let words: Vec<_> = DICTIONARY_WORD_PATTERN.find_iter(text).collect();
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut i = 0;
    while i < words.len() {
        let mut best_match: Option<(usize, &String, f64)> = None;
        for n in (1..=max_words.min(words.len() - i)).rev() {
            if words[i..i + n]
                .iter()
                .any(|word| word.as_str().contains('_'))
            {
                continue;
            }
            // Never merge across punctuation or a paragraph boundary.
            if (i..i + n - 1).any(|j| {
                !text[words[j].end()..words[j + 1].start()]
                    .chars()
                    .all(|c| matches!(c, ' ' | '\t'))
            }) {
                continue;
            }
            let candidate = build_match_key(&text[words[i].start()..words[i + n - 1].end()]);
            if let Some((replacement, score)) =
                find_best_match(&candidate, custom_words, keys, threshold)
            {
                if best_match.as_ref().is_none_or(|(best_n, _, best_score)| {
                    score < *best_score || (score == *best_score && score > 0.0 && n < *best_n)
                }) {
                    best_match = Some((n, replacement, score));
                }
            }
        }
        result.push_str(&text[cursor..words[i].start()]);
        let n = if let Some((n, replacement, _)) = best_match {
            result.push_str(replacement);
            n
        } else {
            result.push_str(words[i].as_str());
            1
        };
        cursor = words[i + n - 1].end();
        i += n;
    }
    result.push_str(&text[cursor..]);
    result
}

fn is_dictionary_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Applies exact aliases first, then conservative fuzzy correction only to
/// untouched spans. Works locally, independent of the model and LLM settings.
/// The dictionary's spelling wins, including capitalization and symbols.
pub fn apply_custom_words(text: &str, custom_words: &[CustomWord], threshold: f64) -> String {
    // Canonical terms outrank aliases belonging to another term. Conflicting
    // aliases are protected but left unchanged rather than resolved by order.
    let mut exact_keys: BTreeMap<String, (Option<usize>, bool)> = BTreeMap::new();
    let mut keys = Vec::new();
    let mut max_words = 4;
    for (index, entry) in custom_words.iter().enumerate() {
        let term_len = build_match_key(&entry.word).chars().count();
        for (alias_index, source) in std::iter::once(&entry.word)
            .chain(&entry.aliases)
            .enumerate()
        {
            let canonical = alias_index == 0;
            let source = source
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            if source.is_empty() {
                continue;
            }
            max_words = max_words.max(source.split_whitespace().count());
            keys.extend(build_custom_word_match_keys(&source, index, term_len));
            exact_keys
                .entry(source)
                .and_modify(|(target, is_canonical)| {
                    if canonical && !*is_canonical {
                        *target = Some(index);
                        *is_canonical = true;
                    } else if canonical == *is_canonical && *target != Some(index) {
                        *target = None;
                    }
                })
                .or_insert((Some(index), canonical));
        }
    }
    if exact_keys.is_empty() {
        return text.to_string();
    }
    // Longest literal phrase wins. Boundaries stay inside each alternative so
    // a longer invalid prefix cannot hide a valid shorter whole-word match.
    let mut exact_keys: Vec<_> = exact_keys.into_iter().collect();
    exact_keys.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(&b.0)));
    let alternatives: Vec<_> = exact_keys
        .iter()
        .map(|(source, _)| {
            let start = source.chars().next().is_some_and(is_dictionary_word_char);
            let end = source
                .chars()
                .next_back()
                .is_some_and(is_dictionary_word_char);
            let literal = source
                .split(' ')
                .map(regex::escape)
                .collect::<Vec<_>>()
                .join(r"[ \t]+");
            format!(
                "({}{}{})",
                if start { r"\b" } else { "" },
                literal,
                if end { r"\b" } else { "" }
            )
        })
        .collect();
    let Ok(pattern) = Regex::new(&format!("(?i:{})", alternatives.join("|"))) else {
        return text.to_string();
    };
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;
    for captures in pattern.captures_iter(text) {
        let Some(found) = captures.get(0) else {
            continue;
        };
        if text[..found.start()]
            .chars()
            .next_back()
            .is_some_and(is_dictionary_word_char)
            || text[found.end()..]
                .chars()
                .next()
                .is_some_and(is_dictionary_word_char)
        {
            continue;
        }
        let Some(key_index) = captures.iter().skip(1).position(|group| group.is_some()) else {
            continue;
        };
        result.push_str(&apply_fuzzy_words(
            &text[cursor..found.start()],
            custom_words,
            &keys,
            threshold,
            max_words,
        ));
        match exact_keys[key_index].1 .0 {
            Some(index) => result.push_str(&custom_words[index].word),
            None => result.push_str(found.as_str()),
        }
        cursor = found.end();
    }
    result.push_str(&apply_fuzzy_words(
        &text[cursor..],
        custom_words,
        &keys,
        threshold,
        max_words,
    ));
    result
}

/// Evidence for the language of the text being cleaned.
///
/// This intentionally describes the transcription output, not Handy's UI
/// language. Unknown output languages fail closed: built-in filler removal is
/// skipped rather than applying a language profile speculatively.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputLanguageEvidence {
    UserSelected(String),
    ModelConstrained(String),
    /// The transcription model itself identified the language (audio-based
    /// LID, e.g. Whisper in auto mode).
    ModelDetected(String),
    /// Detected from the transcribed text with high confidence, constrained to
    /// the model's supported languages. Weakest accepted evidence.
    TextDetected(String),
    TranslatedToEnglish,
    Unknown,
}

impl OutputLanguageEvidence {
    pub(crate) fn language(&self) -> Option<&str> {
        match self {
            Self::UserSelected(language)
            | Self::ModelConstrained(language)
            | Self::ModelDetected(language)
            | Self::TextDetected(language) => Some(language),
            Self::TranslatedToEnglish => Some("en"),
            Self::Unknown => None,
        }
    }
}

/// Filler tokens that are not lexical words in any language Handy's models can
/// output, so removing them cannot corrupt text regardless of the (possibly
/// unknown) output language. Kept deliberately conservative: anything that is a
/// real word somewhere ("um" pt/de, "ha" es, "ah"/"eh" interjections, "mm"
/// millimetres) belongs in the language-gated lists instead.
const UNIVERSAL_FILLER_WORDS: &[&str] = &[
    "uh", "uhm", "umm", "uhh", "uhhh", "ehh", "ehm", "ahm", "hmm", "hm", "mmm", "хм", "ммм",
];

/// Filler words that are only safe to remove with evidence for the output
/// language, because the same token is a real word elsewhere (e.g. Portuguese
/// "um" = "a/an", German "um" = "at/around", Spanish "ha" = "has").
fn gated_filler_words_for_language(lang: &str) -> &'static [&'static str] {
    let base_lang = lang.split(&['-', '_'][..]).next().unwrap_or(lang);

    match base_lang {
        "en" => &["um", "ah", "eh"],
        "de" => &["äh", "ähm"],
        "fr" => &["euh"],
        _ => &[],
    }
}

static MULTI_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}").unwrap());

/// Collapses repeated words (3+ repetitions) to a single instance.
/// E.g., "wh wh wh wh" -> "wh", "I I I I" -> "I"
fn collapse_stutters(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return text.to_string();
    }

    let mut result: Vec<&str> = Vec::new();
    let mut i = 0;

    while i < words.len() {
        let word = words[i];
        let word_lower = word.to_lowercase();

        if word_lower.chars().all(|c| c.is_alphabetic()) {
            // Count consecutive repetitions (case-insensitive)
            let mut count = 1;
            while i + count < words.len() && words[i + count].to_lowercase() == word_lower {
                count += 1;
            }

            // If 3+ repetitions, collapse to single instance
            if count >= 3 {
                result.push(word);
                i += count;
            } else {
                result.push(word);
                i += 1;
            }
        } else {
            result.push(word);
            i += 1;
        }
    }

    result.join(" ")
}

/// Whether a word appended to `kept` would open a sentence: nothing but
/// whitespace so far, or the last visible character ends a sentence.
fn opens_sentence(kept: &str) -> bool {
    kept.trim_end()
        .chars()
        .next_back()
        .is_none_or(|c| matches!(c, '.' | '!' | '?' | '…'))
}

/// Appends `segment` to `kept`. While `capital_owed` is set, the first
/// alphanumeric character of `segment` is uppercased and the debt is settled.
fn push_restoring_capital(kept: &mut String, segment: &str, capital_owed: &mut bool) {
    if *capital_owed {
        if let Some((index, first)) = segment.char_indices().find(|(_, c)| c.is_alphanumeric()) {
            *capital_owed = false;
            kept.push_str(&segment[..index]);
            kept.extend(first.to_uppercase());
            kept.push_str(&segment[index + first.len_utf8()..]);
            return;
        }
    }
    kept.push_str(segment);
}

/// Deletes every match of one filler pattern. A capitalized filler that opened
/// a sentence hands its capital to the word that takes its place, so
/// "Um, so I think" becomes "So I think" rather than "so I think".
fn remove_filler_matches(text: &str, pattern: &Regex) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut resume = 0;
    let mut capital_owed = false;

    for filler in pattern.find_iter(text) {
        push_restoring_capital(&mut kept, &text[resume..filler.start()], &mut capital_owed);
        let capitalized = filler.as_str().starts_with(char::is_uppercase);
        capital_owed |= capitalized && opens_sentence(&kept);
        resume = filler.end();
    }
    push_restoring_capital(&mut kept, &text[resume..], &mut capital_owed);

    kept
}

/// Removes filler words from transcription output when enabled.
///
/// Built-in removal is two-tiered: [`UNIVERSAL_FILLER_WORDS`] apply regardless
/// of language evidence, while [`gated_filler_words_for_language`] tokens are
/// only removed when the output language is known. A custom list is an
/// explicit user override and replaces both tiers without requiring language
/// evidence. `Some(empty vec)` disables removal, preserving the legacy
/// power-user setting. The master toggle takes precedence over both built-in
/// and custom lists.
///
/// # Arguments
/// * `text` - The raw transcription text to filter
/// * `language` - Evidence for the language of the transcription output
/// * `custom_filler_words` - Optional user-provided filler word list. `Some(vec)` overrides
///   language defaults; `Some(empty vec)` disables filtering; `None` uses language defaults.
/// * `enabled` - Whether filler-word removal is enabled
///
/// # Returns
/// The text with configured filler words removed
pub fn remove_filler_words(
    text: &str,
    language: &OutputLanguageEvidence,
    custom_filler_words: &Option<Vec<String>>,
    enabled: bool,
) -> String {
    if !enabled {
        return text.to_string();
    }

    // Build filler patterns from custom list or the built-in tiers
    let patterns: Vec<Regex> = match custom_filler_words {
        Some(words) => words
            .iter()
            .filter_map(|word| Regex::new(&format!(r"(?i)\b{}\b[,.]?", regex::escape(word))).ok())
            .collect(),
        None => UNIVERSAL_FILLER_WORDS
            .iter()
            .chain(
                language
                    .language()
                    .map(gated_filler_words_for_language)
                    .unwrap_or_default(),
            )
            .map(|word| Regex::new(&format!(r"(?i)\b{}\b[,.]?", regex::escape(word))).unwrap())
            .collect(),
    };

    // Remove filler words
    let mut filtered = text.to_string();
    for pattern in &patterns {
        filtered = remove_filler_matches(&filtered, pattern);
    }

    filtered
}

/// Applies non-filler transcription cleanup.
///
/// Kept separate from [`remove_filler_words`] so disabling filler deletion
/// does not also disable the existing repeated-word and whitespace cleanup.
pub fn normalize_transcription_output(text: &str) -> String {
    let mut normalized = collapse_stutters(text);

    // Clean up multiple spaces to single space
    normalized = MULTI_SPACE_PATTERN
        .replace_all(&normalized, " ")
        .to_string();

    // Trim leading/trailing whitespace
    normalized.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn term(word: &str, aliases: &[&str]) -> CustomWord {
        CustomWord {
            word: word.to_string(),
            aliases: aliases.iter().map(|alias| alias.to_string()).collect(),
        }
    }

    #[test]
    fn custom_words_exact_aliases_work_without_fuzzy_correction() {
        let words = vec![term("JSX", &["GSX", "джи эс икс", "джей эс икс"])];
        assert_eq!(
            apply_custom_words("Пишу GSX, «ДЖИ ЭС ИКС» и джей\tэс икс.", &words, 0.0),
            "Пишу JSX, «JSX» и JSX."
        );
    }

    #[test]
    fn custom_words_match_whole_words_and_preserve_formatting() {
        let words = vec![term("JSX", &["GSX"])];
        let input = "  (GSX), GSX/GSX\nmy_GSX _GSX GSX2 XGSX GSXfoo  ";
        assert_eq!(
            apply_custom_words(input, &words, 0.18),
            "  (JSX), JSX/JSX\nmy_GSX _GSX GSX2 XGSX GSXfoo  "
        );
    }

    #[test]
    fn custom_words_literal_symbols_are_not_regex_or_fuzzy_patterns() {
        let words = vec![term("C++", &["си плюс плюс"]), CustomWord::new("Node.js")];
        assert_eq!(
            apply_custom_words(
                "си плюс плюс, C++ и Node.js; C C# NodeXjs C++x",
                &words,
                0.0
            ),
            "C++, C++ и Node.js; C C# NodeXjs C++x"
        );
    }

    #[test]
    fn custom_words_exact_aliases_support_other_scripts() {
        let words = vec![term("JSX", &["杰艾斯艾克斯"])];
        assert_eq!(apply_custom_words("«杰艾斯艾克斯»", &words, 0.0), "«JSX»");
    }

    #[test]
    fn custom_words_correct_cyrillic_alias_typos_and_transpositions() {
        let words = vec![
            term("TypeScript", &["тайпскрипт"]),
            CustomWord::new("Постгрес"),
        ];
        assert_eq!(
            apply_custom_words("тайпскрит и Постгрсе", &words, 0.18),
            "TypeScript и Постгрес"
        );
    }

    #[test]
    fn custom_words_short_terms_and_numbers_require_exact_matches() {
        let words = vec![
            term("JSX", &["GSX", "джей эс икс"]),
            CustomWord::new("GPT-4"),
        ];
        assert_eq!(
            apply_custom_words("GSX TSX JSZ джей эс икз GPT4 GPT5", &words, 1.0),
            "JSX TSX JSZ джей эс икз GPT-4 GPT5"
        );
    }

    #[test]
    fn custom_words_exact_replacements_do_not_cascade() {
        let words = vec![term("JSX", &["GSX"]), term("TypeScript", &["JSX"])];
        assert_eq!(apply_custom_words("GSX JSX", &words, 0.18), "JSX JSX");
    }

    #[test]
    fn custom_words_ambiguous_aliases_and_fuzzy_matches_remain_unchanged() {
        let mut words = vec![term("Cloud", &["облако"]), term("Clode", &["облако"])];
        assert_eq!(
            apply_custom_words("облако clod", &words, 0.18),
            "облако clod"
        );
        words.reverse();
        assert_eq!(
            apply_custom_words("облако clod", &words, 0.18),
            "облако clod"
        );
    }

    #[test]
    fn custom_words_aliases_of_same_term_are_not_ambiguous() {
        let words = vec![term("Claude", &["claud", "cloud"])];
        assert_eq!(apply_custom_words("clod", &words, 0.18), "Claude");
    }

    #[test]
    fn custom_words_longest_valid_alias_wins_without_crossing_paragraphs() {
        let words = vec![term("JSX", &["джей", "джей эс икс", "джей эс"])];
        assert_eq!(
            apply_custom_words("джей эс икс; джей эспрессо; джей\nэс икс", &words, 0.0),
            "JSX; JSX эспрессо; JSX\nэс икс"
        );
    }

    #[test]
    fn custom_words_soundex_cannot_replace_distant_words() {
        let words = vec![CustomWord::new("Superwhisper")];
        assert_eq!(apply_custom_words("supervisor", &words, 1.0), "supervisor");
    }

    /// Exercise the complete cleanup sequence with an explicitly selected
    /// language. Individual tests below predate the split between filler
    /// removal and non-filler normalization.
    fn filter_transcription_output(
        text: &str,
        language: &str,
        custom_filler_words: &Option<Vec<String>>,
    ) -> String {
        let language = OutputLanguageEvidence::UserSelected(language.to_string());
        let filtered = remove_filler_words(text, &language, custom_filler_words, true);
        normalize_transcription_output(&filtered)
    }

    #[test]
    fn test_apply_custom_words_exact_match() {
        let text = "hello world";
        let custom_words = vec![CustomWord::new("Hello"), CustomWord::new("World")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn test_apply_custom_words_fuzzy_match() {
        let text = "helo wrold";
        let custom_words = vec![CustomWord::new("hello"), CustomWord::new("world")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_empty_custom_words() {
        let text = "hello world";
        let custom_words = vec![];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_filter_filler_words() {
        let text = "So uhm I was thinking uh about this";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "So I was thinking about this");
    }

    #[test]
    fn test_filter_filler_words_case_insensitive() {
        let text = "UHM this is UH a test";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "This is a test");
    }

    #[test]
    fn test_filter_filler_words_with_punctuation() {
        let text = "Well, uhm, I think, uh. that's right";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Well, I think, that's right");
    }

    #[test]
    fn test_filter_cleans_whitespace() {
        let text = "Hello    world   test";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Hello world test");
    }

    #[test]
    fn test_filter_trims() {
        let text = "  Hello world  ";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_filter_combined() {
        let text = "  Uhm, so I was, uh, thinking about this  ";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "So I was, thinking about this");
    }

    #[test]
    fn test_filter_leading_filler_keeps_sentence_capital() {
        let result = filter_transcription_output("Um, so I think we should ship it.", "en", &None);
        assert_eq!(result, "So I think we should ship it.");

        let result = filter_transcription_output("That works. Um, let me check.", "en", &None);
        assert_eq!(result, "That works. Let me check.");

        // Mid-sentence there is no capital to hand over.
        let result = filter_transcription_output("He said, Um, not today.", "en", &None);
        assert_eq!(result, "He said, not today.");
    }

    #[test]
    fn test_filter_preserves_valid_text() {
        let text = "This is a completely normal sentence.";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "This is a completely normal sentence.");
    }

    #[test]
    fn test_filter_stutter_collapse() {
        let text = "w wh wh wh wh wh wh wh wh wh why";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "w wh why");
    }

    #[test]
    fn test_filter_stutter_short_words() {
        let text = "I I I I think so so so so";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "I think so");
    }

    #[test]
    fn test_filter_stutter_longer_words() {
        let text = "Check data doc doc doc doc documentation.";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Check data doc documentation.");
    }

    #[test]
    fn test_filter_stutter_mixed_case() {
        let text = "No NO no NO no";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "No");
    }

    #[test]
    fn test_filter_stutter_preserves_two_repetitions() {
        let text = "no no is fine";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "no no is fine");
    }

    #[test]
    fn test_filter_english_removes_um() {
        let text = "um I think um this is good";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "I think this is good");
    }

    #[test]
    fn test_filter_portuguese_preserves_um() {
        // "um" means "a/an" in Portuguese
        let text = "um gato bonito";
        let result = filter_transcription_output(text, "pt", &None);
        assert_eq!(result, "um gato bonito");
    }

    #[test]
    fn test_filter_spanish_preserves_ha() {
        // "ha" means "has" in Spanish
        let text = "ha sido un buen día";
        let result = filter_transcription_output(text, "es", &None);
        assert_eq!(result, "ha sido un buen día");
    }

    #[test]
    fn test_filter_language_code_with_region() {
        // "pt-BR" should normalize to "pt"
        let text = "um gato bonito";
        let result = filter_transcription_output(text, "pt-BR", &None);
        assert_eq!(result, "um gato bonito");
    }

    #[test]
    fn test_filter_custom_filler_words_override() {
        let custom = Some(vec!["okay".to_string(), "right".to_string()]);
        let text = "okay so I think right this works";
        let result = filter_transcription_output(text, "en", &custom);
        assert_eq!(result, "so I think this works");
    }

    #[test]
    fn test_filter_custom_filler_words_empty_disables() {
        let custom = Some(vec![]);
        let text = "So uhm I was thinking uh about this";
        let result = filter_transcription_output(text, "en", &custom);
        // No filler words removed since custom list is empty
        assert_eq!(result, "So uhm I was thinking uh about this");
    }

    #[test]
    fn test_filter_unknown_language_still_removes_universal_fillers() {
        let text = "uh I think uhm this works";
        let result = filter_transcription_output(text, "xx", &None);
        assert_eq!(result, "I think this works");
    }

    #[test]
    fn test_filter_unknown_language_does_not_remove_um() {
        let text = "um I think this works";
        let result = filter_transcription_output(text, "xx", &None);
        assert_eq!(result, "um I think this works");
    }

    #[test]
    fn test_filter_unknown_evidence_removes_universal_keeps_gated() {
        let filtered = remove_filler_words(
            "uhh bueno hmm creo que um ha llegado",
            &OutputLanguageEvidence::Unknown,
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&filtered),
            "bueno creo que um ha llegado"
        );

        let cyrillic = remove_filler_words(
            "хм я думаю ммм это работает",
            &OutputLanguageEvidence::Unknown,
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&cyrillic),
            "я думаю это работает"
        );
    }

    #[test]
    fn custom_words_do_not_expand_short_partial_terms_across_paragraphs() {
        let words = vec![CustomWord::new("OpenAI")];
        assert_eq!(apply_custom_words("Open\nAI", &words, 0.18), "Open\nAI");
    }

    #[test]
    fn test_filter_german_gated_fillers_require_evidence() {
        let text = "äh ich glaube ähm das passt";

        let unknown = remove_filler_words(text, &OutputLanguageEvidence::Unknown, &None, true);
        assert_eq!(normalize_transcription_output(&unknown), text);

        let result = filter_transcription_output(text, "de", &None);
        assert_eq!(result, "ich glaube das passt");
    }

    #[test]
    fn test_filter_preserves_millimetre_unit() {
        // "mm" was removed from the filler lists because it eats units.
        let text = "the screw is 5 mm long";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "the screw is 5 mm long");
    }

    #[test]
    fn test_filter_detected_evidence_unlocks_gated_fillers() {
        let model = remove_filler_words(
            "um I think this works",
            &OutputLanguageEvidence::ModelDetected("en".to_string()),
            &None,
            true,
        );
        assert_eq!(normalize_transcription_output(&model), "I think this works");

        let text = remove_filler_words(
            "euh je pense que ça marche",
            &OutputLanguageEvidence::TextDetected("fr".to_string()),
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&text),
            "je pense que ça marche"
        );
    }

    #[test]
    fn test_filter_master_toggle_disables_custom_and_builtin_removal() {
        let text = "um customword I think";
        let language = OutputLanguageEvidence::UserSelected("en".to_string());
        let custom = Some(vec!["customword".to_string()]);

        let result = remove_filler_words(text, &language, &custom, false);

        assert_eq!(result, text);
    }

    #[test]
    fn test_filter_custom_words_apply_without_language_evidence() {
        let custom = Some(vec!["customword".to_string()]);
        let text = "customword should be removed but um should remain";

        let filtered = remove_filler_words(text, &OutputLanguageEvidence::Unknown, &custom, true);
        let result = normalize_transcription_output(&filtered);

        assert_eq!(result, "should be removed but um should remain");
    }

    #[test]
    fn test_apply_custom_words_ngram_two_words() {
        let text = "il cui nome è Charge B, che permette";
        let custom_words = vec![CustomWord::new("ChargeBee")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert!(result.contains("ChargeBee,"), "unexpected result: {result}");
        assert!(!result.contains("Charge B"));
    }

    #[test]
    fn test_apply_custom_words_ngram_three_words() {
        let text = "use Chat G P T for this";
        let custom_words = vec![CustomWord::new("ChatGPT")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert!(result.contains("ChatGPT"));
    }

    #[test]
    fn test_apply_custom_words_prefers_longer_ngram() {
        let text = "Open AI GPT model";
        let custom_words = vec![CustomWord::new("OpenAI"), CustomWord::new("GPT")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "OpenAI GPT model");
    }

    #[test]
    fn test_apply_custom_words_ngram_uses_dictionary_case() {
        let text = "CHARGE B is great";
        let custom_words = vec![CustomWord::new("ChargeBee")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "ChargeBee is great");
    }

    #[test]
    fn test_apply_custom_words_ngram_with_spaces_in_custom() {
        // Custom word with space should also match against split words
        let text = "using Mac Book Pro";
        let custom_words = vec![CustomWord::new("MacBook Pro")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "using MacBook Pro");
    }

    #[test]
    fn test_apply_custom_words_trailing_number_not_doubled() {
        // Verify that trailing non-alpha chars (like numbers) aren't double-counted
        // between build_ngram stripping them and extract_punctuation capturing them
        let text = "use GPT4 for this";
        let custom_words = vec![CustomWord::new("GPT-4")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        // Should NOT produce "GPT-44" (double-counting the trailing 4)
        assert!(
            !result.contains("GPT-44"),
            "got double-counted result: {}",
            result
        );
    }

    #[test]
    fn test_apply_custom_words_matches_ampersand_word() {
        let text = "send it to RD for review";
        let custom_words = vec![CustomWord::new("R&D")];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_matches_spoken_ampersand_word() {
        let text = "send it to R and D for review";
        let custom_words = vec![CustomWord::new("R&D")];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_preserves_ampersand_word() {
        let text = "send it to R&D for review";
        let custom_words = vec![CustomWord::new("R&D")];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_handles_unicode_punctuation() {
        let text = "「Handee。」";
        let custom_words = vec![CustomWord::new("Handy")];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "「Handy。」");
    }

    #[test]
    fn test_apply_custom_words_skips_cjk_fuzzy_matching() {
        let text = "你好。";
        let custom_words = vec![CustomWord::new("你号")];
        let result = apply_custom_words(text, &custom_words, 1.0);
        assert_eq!(result, text);
    }
}
