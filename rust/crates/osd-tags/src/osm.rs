//! Shared OSM tag helpers.
//!
//! Replaces: `src/transforms/OSMTransforms.ts`.

use crate::status::Tags;

/// A tag's value, with an absent tag and an unparseable one both unknown.
pub fn osm_string(value: Option<&str>) -> Option<String> {
    value.map(str::to_owned)
}

/// First present tag among `keys`, in priority order.
pub fn get_or_else<'a>(tags: &'a Tags, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| tags.get(*key))
        .map(String::as_str)
}

/// The first value of a semicolon-separated tag.
///
/// Replaces `getOSMFirstValue`. OSM allows several values in one tag; this dataset keeps
/// only the first, which is why `wikidata=Q1;Q2` yields `Q1`.
pub fn first_value(tags: &Tags, key: &str) -> Option<String> {
    let input = tags.get(key)?;
    Some(input.split(';').next().unwrap_or(input).to_owned())
}

/// The reference code of a feature.
///
/// Replaces `getOSMRef`. The priority order is deliberate: a local reference, and a
/// piste-specific one, both beat the generic `ref`.
pub fn osm_ref(tags: &Tags) -> Option<String> {
    osm_string(get_or_else(
        tags,
        &["piste:loc_ref", "piste:ref", "loc_ref", "ref"],
    ))
}

/// Keys that hold a name for `root`: the key itself and its localized variants.
fn name_keys<'a>(tags: &'a Tags, root: &str) -> Vec<&'a String> {
    let prefix = format!("{root}:");
    let mut keys: Vec<&String> = tags
        .keys()
        .filter(|key| key.as_str() == root || key.starts_with(&prefix))
        .collect();
    // Sorted, because the sort order is the join order of the resulting name.
    keys.sort();
    keys
}

/// The name of a feature, combining its localized variants.
///
/// Replaces `getOSMName`. Three behaviours worth naming:
///
/// - Localized variants are all included, joined with `", "` in key order. So
///   `name=Base` plus `name:de=Deutsch` becomes `"Base, Deutsch"` — `name` sorts before
///   `name:de`.
/// - Duplicate values are collapsed first, so the same name under two keys appears once.
/// - The fallback root is only consulted when the primary root has *no* keys at all, not
///   per-key. A `piste:name` therefore suppresses a plain `name` entirely.
///
/// When `reference` is given and the name begins with it, the reference prefix is
/// stripped: OSM names are often `"11 - Peak Chair"` where `11` is already the ref, and
/// repeating it reads badly on a map.
pub fn osm_name(
    tags: &Tags,
    root: &str,
    fallback_root: Option<&str>,
    reference: Option<&str>,
) -> Option<String> {
    let mut keys = name_keys(tags, root);
    if keys.is_empty() {
        if let Some(fallback) = fallback_root {
            keys = name_keys(tags, fallback);
        }
    }
    if keys.is_empty() {
        return None;
    }

    let mut values: Vec<&str> = Vec::new();
    for key in keys {
        let value = tags[key].as_str();
        if !values.contains(&value) {
            values.push(value);
        }
    }
    let name = values.join(", ");

    match reference {
        Some(reference) if !name.is_empty() => Some(strip_ref_prefix(&name, reference)),
        _ => Some(name),
    }
}

/// Removes a leading reference from a name.
///
/// OSM names are often `"11 - Peak Chair"` where `11` is already the reference, and
/// repeating it reads badly on a map.
///
/// This uses the same pattern as upstream — `^{ref}(\s*-?\s+|-\s*)` — rather than a
/// hand-rolled equivalent, because the alternation's backtracking is load-bearing and not
/// obvious. For `"11 -Peak Chair"` the first branch cannot match with the dash consumed
/// (no whitespace follows it), so it backtracks to matching the single space alone and the
/// result keeps the dash: `"-Peak Chair"`. Two attempts at reproducing that by hand got it
/// wrong in different ways, which is the argument for letting a regex engine do it.
///
/// The reference is escaped, since OSM reference codes contain regex metacharacters.
fn strip_ref_prefix(name: &str, reference: &str) -> String {
    let pattern = format!(r"^{}(\s*-?\s+|-\s*)", regex::escape(reference));
    match regex::Regex::new(&pattern) {
        Ok(re) => re.replace(name, "").into_owned(),
        // An unconstructable pattern should be impossible after escaping; leaving the
        // name untouched is the safe failure.
        Err(_) => name.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(pairs: &[(&str, &str)]) -> Tags {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect()
    }

    #[test]
    fn first_value_takes_only_the_first() {
        assert_eq!(
            first_value(&tags(&[("wikidata", "Q1;Q2")]), "wikidata").as_deref(),
            Some("Q1")
        );
        assert_eq!(
            first_value(&tags(&[("wikidata", "Q1")]), "wikidata").as_deref(),
            Some("Q1")
        );
        assert_eq!(first_value(&tags(&[]), "wikidata"), None);
    }

    #[test]
    fn ref_priority_is_local_then_piste_then_generic() {
        let all = tags(&[
            ("piste:loc_ref", "A"),
            ("piste:ref", "B"),
            ("loc_ref", "C"),
            ("ref", "D"),
        ]);
        assert_eq!(osm_ref(&all).as_deref(), Some("A"));
        assert_eq!(
            osm_ref(&tags(&[("loc_ref", "C"), ("ref", "D")])).as_deref(),
            Some("C")
        );
        assert_eq!(osm_ref(&tags(&[("ref", "D")])).as_deref(), Some("D"));
    }

    #[test]
    fn localized_names_join_in_key_order() {
        assert_eq!(
            osm_name(
                &tags(&[("name:zz", "Last"), ("name:aa", "First")]),
                "name",
                None,
                None
            )
            .as_deref(),
            Some("First, Last")
        );
        assert_eq!(
            osm_name(
                &tags(&[("name", "Base"), ("name:de", "Deutsch")]),
                "name",
                None,
                None
            )
            .as_deref(),
            Some("Base, Deutsch")
        );
    }

    #[test]
    fn duplicate_names_are_collapsed() {
        assert_eq!(
            osm_name(
                &tags(&[("name", "Same"), ("name:de", "Same")]),
                "name",
                None,
                None
            )
            .as_deref(),
            Some("Same")
        );
    }

    /// The fallback is consulted only when the primary root has no keys at all.
    #[test]
    fn a_piste_name_suppresses_the_plain_name_entirely() {
        assert_eq!(
            osm_name(
                &tags(&[("piste:name", "Piste"), ("name", "Plain")]),
                "piste:name",
                Some("name"),
                None
            )
            .as_deref(),
            Some("Piste")
        );
        assert_eq!(
            osm_name(
                &tags(&[("name", "Plain")]),
                "piste:name",
                Some("name"),
                None
            )
            .as_deref(),
            Some("Plain")
        );
    }

    #[test]
    fn a_reference_prefix_is_stripped_in_its_accepted_forms() {
        for name in [
            "11 - Peak Chair",
            "11-Peak Chair",
            "11- Peak Chair",
            "11 Peak Chair",
        ] {
            assert_eq!(strip_ref_prefix(name, "11"), "Peak Chair", "name {name:?}");
        }
    }

    /// A space before the dash defeats the first branch of the pattern, which then
    /// backtracks to matching the space alone and leaves the dash behind. Verified
    /// against the live implementation, not assumed.
    #[test]
    fn a_space_before_the_dash_leaves_the_dash_in_the_name() {
        assert_eq!(strip_ref_prefix("11 -Peak Chair", "11"), "-Peak Chair");
    }

    /// Reference codes can contain regex metacharacters, so the pattern escapes them.
    #[test]
    fn a_reference_with_metacharacters_is_matched_literally() {
        assert_eq!(strip_ref_prefix("A.1 - Run", "A.1"), "Run");
        assert_eq!(strip_ref_prefix("AX1 - Run", "A.1"), "AX1 - Run");
    }

    /// Without a separator the leading digits are part of the name, not the reference.
    #[test]
    fn a_reference_without_a_separator_is_not_stripped() {
        assert_eq!(strip_ref_prefix("11Peak Chair", "11"), "11Peak Chair");
        assert_eq!(strip_ref_prefix("110 - Other", "11"), "110 - Other");
        assert_eq!(strip_ref_prefix("Peak Chair 11", "11"), "Peak Chair 11");
    }
}
