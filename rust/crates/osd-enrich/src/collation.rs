//! `String.prototype.localeCompare`, as V8 computes it.
//!
//! `sortPlaces` (`PlaceUtils.ts`) orders places by locality, then region, then country, each
//! with `localeCompare`, so the order of `places` in every output file depends on the
//! collation. V8 uses ICU's collator for the default locale (`en-US`, root collation rules,
//! tertiary strength: case and accents matter, punctuation is not ignored, digits compare as
//! characters). ICU4X implements the same algorithm from the same CLDR data; the vectors in
//! `tests/collation_vectors.json` record what this Node's ICU says for 36,000 pairs.
//!
//! A difference between the CLDR version this crate's data comes from and the one Node ships
//! can reorder rare characters; the test pins what was checked.

use icu_collator::options::CollatorOptions;
use icu_collator::{Collator, CollatorBorrowed};
use std::cmp::Ordering;

thread_local! {
    // The collator is not `Sync`, so each thread builds its own, once.
    static COLLATOR: CollatorBorrowed<'static> =
        Collator::try_new(Default::default(), CollatorOptions::default())
            .expect("the compiled-in collation data loads");
}

/// `a.localeCompare(b)`: the order of two strings in the default locale.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    COLLATOR.with(|collator| collator.compare(a, b))
}
