//! Feature id hashing.
//!
//! Replaces: `src/transforms/FeatureBuilder.ts`, which derives `properties.id` as
//! `objectHash({ type: "Feature", properties: { type }, geometry })`.
//!
//! # The compatibility hazard
//!
//! `object-hash` walks the object graph and SHA-1s a textual encoding of it, formatting
//! numbers with JS `Number.prototype.toString()` — shortest round-trip (Ryu/Grisu)
//! output, with JavaScript's own exponent rules and `-0` handling. **Every feature `id`
//! in every output file depends on that formatting.** Reproducing it byte-for-byte in
//! Rust is possible but is a last-digit minefield.
//!
//! The agreed bar is equivalent-or-better output rather than byte-identical, so the plan
//! is to switch to a canonical binary encoding hashed with xxh3 and accept that ids
//! change wholesale. Two things must be confirmed before that lands:
//!
//! 1. Nothing downstream pins the old ids. They are content hashes and change whenever a
//!    feature changes, so consumers should already treat them as opaque — but
//!    openskimap.org and `metadata.json` need checking.
//! 2. The golden-master harness must count id changes separately, so an *unexpected* id
//!    change is still a build failure rather than noise.
//!
//! An efficiency note carried over from the audit: upstream hashes every run **twice** —
//! once in `RunFormatter` and again in `RunNormalizerAccumulator` after normalization.
//! The first is dead, because `id` is in `ignoredPropertiesForComparison`
//! (`RunJoining.ts:16`) and nothing reads it in between. Hash once, after normalization.

use crate::{FeatureIdx, FeatureStore};

/// Compute the content hash that becomes `properties.id`.
pub fn compute(_store: &FeatureStore, _idx: FeatureIdx) -> String {
    todo!("canonical binary encoding of (feature_type, geometry) hashed with xxh3")
}

/// Bit-compatible reimplementation of upstream `object-hash`, for the migration window.
///
/// Only needed if the golden-master diff has to show zero id changes; see the module
/// docs. Left unimplemented deliberately — do not reach for this without deciding that
/// byte-identical ids are actually required.
pub fn compute_object_hash_compatible(_store: &FeatureStore, _idx: FeatureIdx) -> String {
    todo!("only if byte-identical ids turn out to be required")
}
