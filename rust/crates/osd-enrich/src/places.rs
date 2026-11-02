//! `sortPlaces` and `uniquePlaces` from `src/transforms/PlaceUtils.ts`.

use crate::collation::locale_compare;
use openskidata_format::place::Place;
use std::cmp::Ordering;
use std::collections::HashSet;

/// Compares two optional names, nulls last. A non-null pair that differs as strings goes
/// straight to `localeCompare`, whose `0` for canonically equivalent strings ends the
/// comparison there (it does not fall through to the next field).
fn compare_names(a: Option<&str>, b: Option<&str>) -> Option<Ordering> {
    match (a, b) {
        (None, None) => None,
        (None, Some(_)) => Some(Ordering::Greater),
        (Some(_), None) => Some(Ordering::Less),
        (Some(a), Some(b)) if a != b => Some(locale_compare(a, b)),
        (Some(_), Some(_)) => None,
    }
}

/// The comparison `sortPlaces` passes to `sort`.
fn compare_places(a: &Place, b: &Place) -> Ordering {
    let (a, b) = (&a.localized.en, &b.localized.en);
    compare_names(a.locality.as_deref(), b.locality.as_deref())
        .or_else(|| compare_names(a.region.as_deref(), b.region.as_deref()))
        .unwrap_or_else(|| locale_compare(&a.country, &b.country))
}

/// V8's `Array.prototype.sort` for fewer than 64 elements, which its TimSort handles as one
/// run: find the leading ascending (or strictly descending, then reversed) run, and extend it
/// by binary insertion.
///
/// For a consistent comparator any stable sort gives the same answer. This one is not
/// consistent when two names are canonically equivalent but not equal (`Zürich` composed and
/// decomposed): `localeCompare` says 0 and `sortPlaces` stops there instead of comparing the
/// next field, so such a place ties with two others that differ from each other. Then the
/// result depends on the algorithm, and this is V8's.
fn v8_sort_small<T>(items: &mut [T], compare: impl Fn(&T, &T) -> Ordering) {
    let length = items.len();
    debug_assert!(length < 64);
    if length < 2 {
        return;
    }
    // CountAndMakeRun
    let descending = compare(&items[1], &items[0]) == Ordering::Less;
    let mut run = 2;
    while run < length {
        let order = compare(&items[run], &items[run - 1]);
        let stop = if descending {
            order != Ordering::Less
        } else {
            order == Ordering::Less
        };
        if stop {
            break;
        }
        run += 1;
    }
    if descending {
        items[..run].reverse();
    }
    // BinaryInsertionSort
    for start in run..length {
        let (mut left, mut right) = (0, start);
        while left < right {
            let mid = left + ((right - left) >> 1);
            if compare(&items[start], &items[mid]) == Ordering::Less {
                right = mid;
            } else {
                left = mid + 1;
            }
        }
        items[left..=start].rotate_right(1);
    }
}

/// `sortPlaces`: by locality, then region, then country, each by `localeCompare`, places
/// without a locality (then region) after those with one. Stable; for fewer than 64 places
/// it is V8's sort step for step, and for more it is a stable sort (identical whenever the
/// comparison is consistent -- see [`v8_sort_small`]).
pub fn sort_places(places: &[Place]) -> Vec<Place> {
    let mut sorted = places.to_vec();
    if sorted.len() < 64 {
        v8_sort_small(&mut sorted, compare_places);
    } else {
        sorted.sort_by(compare_places);
    }
    sorted
}

/// `uniquePlaces`: the first of each place with the same country code, region code and
/// locality.
pub fn unique_places(places: &[Place]) -> Vec<Place> {
    let mut seen: HashSet<(&str, Option<&str>, Option<&str>)> = HashSet::new();
    places
        .iter()
        .filter(|place| {
            seen.insert((
                place.iso3166_1_alpha2.as_str(),
                place.iso3166_2.as_deref(),
                place.localized.en.locality.as_deref(),
            ))
        })
        .cloned()
        .collect()
}
