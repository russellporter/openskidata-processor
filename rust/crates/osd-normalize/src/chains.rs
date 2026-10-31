//! Joining connected run segments into chains.
//!
//! Replaces: `src/transforms/normalization/PointGraph.ts`, `PointMultiMap.ts`, and the
//! chain-walking half of `CombineRunSegments.ts`.
//!
//! # What this does
//!
//! A run as marked on the mountain arrives from OSM as several ways. Where consecutive
//! segments carry the same properties they are joined back into one feature. Two segments
//! are candidates when one's tail is the other's head, and they are joined when their
//! properties match on everything that defines a run's identity.
//!
//! # Why the walk is shaped the way it is
//!
//! The expansion is bidirectional and *greedy on the first match*: at each endpoint it
//! takes `.find(...)` over the candidates, not all of them. So a junction where three
//! segments meet joins exactly one of them, and which one depends on candidate order.
//! Upstream that order came from a `Set`'s insertion order; here candidates are kept in
//! insertion order explicitly, which is the feature order from the formatter, so the
//! result is a function of the input.
//!
//! A segment may also be joined *reversed*, so that two segments meeting head-to-head can
//! still form a chain — but only if it is not one-way. Reversing a one-way run would
//! invert its direction of travel, so `oneway == true` blocks it. That is the
//! `hasDirection` guard upstream.

use osd_store::FixedCoord;
use std::collections::HashMap;

/// Identity of a run for joining purposes.
///
/// Replaces `isPartOfSameRun`, which filtered the ignored properties out of both features
/// and deep-compared the remainder on every candidate probe. Here the comparison is
/// precomputed into one value.
///
/// The ignored set upstream is `{id, sources, skiAreas, elevationProfile, places,
/// viewportHint}` — keep it exactly, or runs will stop joining where they used to. The key
/// is supplied by the caller rather than derived here, because it is the formatter that
/// knows the full property set; this module only needs equality.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct JoinKey(pub u64);

/// One run segment, as the chain walk sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    /// Index into the caller's run list.
    pub run: usize,
    pub head: FixedCoord,
    pub tail: FixedCoord,
    pub join_key: JoinKey,
    /// A one-way run cannot be traversed reversed.
    pub oneway: bool,
}

/// A link in a produced chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Link {
    pub run: usize,
    /// Whether this segment's coordinates are consumed back to front.
    pub reversed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Forward,
    Backward,
    Both,
}

/// Endpoint index over the segments.
#[derive(Debug, Default)]
pub struct ChainGraph {
    segments: Vec<Segment>,
    /// Segments whose head is at a point — the lines going out of it.
    outbound: HashMap<FixedCoord, Vec<usize>>,
    /// Segments whose tail is at a point — the lines coming into it.
    inbound: HashMap<FixedCoord, Vec<usize>>,
    processed: Vec<bool>,
}

impl ChainGraph {
    /// Builds the index. Segments are added in the caller's order, and candidate lists
    /// preserve it.
    pub fn build(segments: Vec<Segment>) -> ChainGraph {
        let mut graph = ChainGraph {
            processed: vec![false; segments.len()],
            segments,
            ..ChainGraph::default()
        };
        for (position, segment) in graph.segments.iter().enumerate() {
            graph
                .outbound
                .entry(segment.head)
                .or_default()
                .push(position);
            graph
                .inbound
                .entry(segment.tail)
                .or_default()
                .push(position);
        }
        graph
    }

    /// Joins the chain containing `position`, consuming every segment in it.
    ///
    /// Returns `None` when the segment has already been consumed by an earlier chain,
    /// which is how `combineRunSegments` drops the segments that were merged away.
    pub fn take_chain(&mut self, position: usize) -> Option<Vec<Link>> {
        if self.processed[position] {
            return None;
        }
        let links = self.expand(Some(position), Direction::Both, false);
        if links.is_empty() { None } else { Some(links) }
    }

    /// First unprocessed candidate at `point` that is a different segment with the same
    /// join key.
    fn find_candidate(
        &self,
        candidates: Option<&Vec<usize>>,
        of: usize,
        require_reversible: bool,
    ) -> Option<usize> {
        let key = self.segments[of].join_key;
        candidates?.iter().copied().find(|&candidate| {
            candidate != of
                && self.segments[candidate].join_key == key
                && !self.processed[candidate]
                // Only the reversed path needs this: a one-way run cannot be walked
                // backwards without inverting its direction of travel.
                && !(require_reversible && self.segments[candidate].oneway)
        })
    }

    fn expand(
        &mut self,
        position: Option<usize>,
        direction: Direction,
        reversed: bool,
    ) -> Vec<Link> {
        let Some(position) = position else {
            return Vec::new();
        };
        if self.processed[position] {
            return Vec::new();
        }
        self.processed[position] = true;

        let segment = self.segments[position];
        // Walking a segment reversed swaps which of its endpoints leads backwards and
        // which leads forwards.
        let (head, tail) = if reversed {
            (segment.tail, segment.head)
        } else {
            (segment.head, segment.tail)
        };

        let mut links: Vec<Link> = Vec::new();

        if direction != Direction::Forward {
            // Prefer a segment that *ends* where this one begins: it continues the chain
            // in its own direction.
            let inbound = self.inbound.get(&head).cloned();
            let candidate = self.find_candidate(inbound.as_ref(), position, false);
            let mut backward = self.expand(candidate, Direction::Backward, false);
            if backward.is_empty() {
                // Otherwise a segment that also *begins* here, taken reversed so the two
                // run head-to-head.
                let outbound = self.outbound.get(&head).cloned();
                let candidate = self.find_candidate(outbound.as_ref(), position, true);
                backward = self.expand(candidate, Direction::Backward, true);
            }
            links.extend(backward);
        }

        links.push(Link {
            run: segment.run,
            reversed,
        });

        if direction != Direction::Backward {
            let outbound = self.outbound.get(&tail).cloned();
            let candidate = self.find_candidate(outbound.as_ref(), position, false);
            let mut forward = self.expand(candidate, Direction::Forward, false);
            if forward.is_empty() {
                let inbound = self.inbound.get(&tail).cloned();
                let candidate = self.find_candidate(inbound.as_ref(), position, true);
                forward = self.expand(candidate, Direction::Forward, true);
            }
            links.extend(forward);
        }

        links
    }
}

/// Joins every chain in a run list, in order.
///
/// Each returned entry is the chain seeded by that run, or `None` when the run was
/// already consumed by an earlier chain. Keeping the `None`s preserves the caller's
/// indexing, which the output reassembly depends on.
pub fn join_chains(segments: Vec<Segment>) -> Vec<Option<Vec<Link>>> {
    let count = segments.len();
    let mut graph = ChainGraph::build(segments);
    (0..count)
        .map(|position| graph.take_chain(position))
        .collect()
}

/// Whether a coordinate run is degenerate and must be dropped before joining.
///
/// Replaces `isDegenerateLineString`. OSM contains ways with a single coordinate or with
/// every coordinate identical, and splitting at shared vertices can leave a zero-length
/// segment behind. Downstream elevation profile extraction divides by the length, so
/// these have to go.
pub fn is_degenerate(coords: &[FixedCoord]) -> bool {
    coords.len() < 2 || coords.iter().all(|&c| c == coords[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn coord(lng: f64, lat: f64) -> FixedCoord {
        FixedCoord::from_degrees(lng, lat).unwrap()
    }

    fn segment(run: usize, from: f64, to: f64, key: u64) -> Segment {
        Segment {
            run,
            head: coord(from, 47.0),
            tail: coord(to, 47.0),
            join_key: JoinKey(key),
            oneway: false,
        }
    }

    fn runs(links: &Option<Vec<Link>>) -> Vec<usize> {
        links
            .as_ref()
            .map(|l| l.iter().map(|link| link.run).collect())
            .unwrap_or_default()
    }

    #[test]
    fn two_segments_meeting_end_to_start_join() {
        let chains = join_chains(vec![segment(0, 11.0, 11.1, 1), segment(1, 11.1, 11.2, 1)]);
        assert_eq!(runs(&chains[0]), vec![0, 1]);
        assert!(chains[1].is_none(), "the second was consumed by the first");
    }

    #[test]
    fn segments_with_different_keys_do_not_join() {
        let chains = join_chains(vec![segment(0, 11.0, 11.1, 1), segment(1, 11.1, 11.2, 2)]);
        assert_eq!(runs(&chains[0]), vec![0]);
        assert_eq!(runs(&chains[1]), vec![1]);
    }

    #[test]
    fn segments_that_do_not_touch_do_not_join() {
        let chains = join_chains(vec![segment(0, 11.0, 11.1, 1), segment(1, 12.0, 12.1, 1)]);
        assert_eq!(runs(&chains[0]), vec![0]);
        assert_eq!(runs(&chains[1]), vec![1]);
    }

    /// The walk is bidirectional, so seeding from the middle of a chain still collects
    /// the segments on both sides, in geometric order.
    #[test]
    fn a_chain_is_collected_in_order_from_its_middle() {
        // Deliberately listed so that run 0 is the middle segment.
        let chains = join_chains(vec![
            segment(0, 11.1, 11.2, 1),
            segment(1, 11.0, 11.1, 1),
            segment(2, 11.2, 11.3, 1),
        ]);
        assert_eq!(
            runs(&chains[0]),
            vec![1, 0, 2],
            "the chain must read in geometric order, not seed-first"
        );
        assert!(chains[1].is_none());
        assert!(chains[2].is_none());
    }

    /// Two segments whose tails meet can only chain if one is walked reversed.
    #[test]
    fn head_to_head_segments_join_with_one_reversed() {
        let chains = join_chains(vec![segment(0, 11.1, 11.0, 1), segment(1, 11.1, 11.2, 1)]);
        let links = chains[0].as_ref().expect("a chain");
        assert_eq!(links.len(), 2);
        assert!(
            links.iter().any(|l| l.reversed),
            "one of the two has to be taken reversed"
        );
    }

    /// A one-way run must not be reversed, because that would invert its direction of
    /// travel. Upstream's `hasDirection` guard.
    #[test]
    fn a_oneway_segment_is_never_reversed() {
        let mut oneway = segment(1, 11.1, 11.2, 1);
        oneway.oneway = true;
        let chains = join_chains(vec![segment(0, 11.1, 11.0, 1), oneway]);

        // The only possible join needs the second segment reversed, which is forbidden.
        assert_eq!(runs(&chains[0]), vec![0]);
        assert_eq!(runs(&chains[1]), vec![1]);
    }

    /// A one-way run still joins in its own direction; the guard is only about reversal.
    #[test]
    fn a_oneway_segment_still_joins_forwards() {
        let mut a = segment(0, 11.0, 11.1, 1);
        a.oneway = true;
        let mut b = segment(1, 11.1, 11.2, 1);
        b.oneway = true;
        let chains = join_chains(vec![a, b]);
        assert_eq!(runs(&chains[0]), vec![0, 1]);
    }

    /// A long chain joins fully, and every segment is consumed exactly once.
    #[test]
    fn a_long_chain_consumes_every_segment_once() {
        let segments: Vec<Segment> = (0..20)
            .map(|i| segment(i, 11.0 + 0.01 * i as f64, 11.0 + 0.01 * (i as f64 + 1.0), 1))
            .collect();
        let chains = join_chains(segments);

        assert_eq!(runs(&chains[0]).len(), 20);
        assert_eq!(
            chains.iter().filter(|c| c.is_some()).count(),
            1,
            "exactly one chain should survive"
        );
        let mut seen = runs(&chains[0]);
        seen.sort();
        assert_eq!(seen, (0..20).collect::<Vec<_>>());
    }

    /// At a junction of three same-key segments the walk takes one, greedily — it does not
    /// fork. The remaining branch stays a chain of its own.
    #[test]
    fn a_junction_joins_only_one_branch() {
        let chains = join_chains(vec![
            segment(0, 11.0, 11.1, 1),
            segment(1, 11.1, 11.2, 1),
            segment(2, 11.1, 11.3, 1),
        ]);

        let joined: usize = chains
            .iter()
            .filter_map(|c| c.as_ref())
            .map(|c| c.len())
            .sum();
        assert_eq!(joined, 3, "every segment appears exactly once overall");
        assert_eq!(
            runs(&chains[0]).len(),
            2,
            "the seed joins one branch of the junction, not both"
        );
    }

    #[test]
    fn degenerate_geometries_are_detected() {
        assert!(is_degenerate(&[]));
        assert!(is_degenerate(&[coord(11.0, 47.0)]));
        assert!(is_degenerate(&[coord(11.0, 47.0), coord(11.0, 47.0)]));
        assert!(!is_degenerate(&[coord(11.0, 47.0), coord(11.1, 47.0)]));
    }

    /// Repeated runs over the same input give the same chains.
    #[test]
    fn joining_is_deterministic() {
        let build = || {
            vec![
                segment(0, 11.0, 11.1, 1),
                segment(1, 11.1, 11.2, 1),
                segment(2, 11.1, 11.3, 1),
                segment(3, 11.3, 11.4, 1),
                segment(4, 12.0, 12.1, 2),
            ]
        };
        let baseline: Vec<Vec<usize>> = join_chains(build()).iter().map(runs).collect();
        for _ in 0..5 {
            let again: Vec<Vec<usize>> = join_chains(build()).iter().map(runs).collect();
            assert_eq!(again, baseline);
        }
    }
}
