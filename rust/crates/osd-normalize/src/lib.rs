//! Run topology normalization: split at shared vertices, merge overlaps, join chains.
//!
//! Replaces: `src/transforms/accumulator/RunNormalizerAccumulator.ts`,
//! `src/transforms/normalization/MergeOverlappingRuns.ts`, `CombineRunSegments.ts`,
//! `PointGraph.ts`, `PointMultiMap.ts`, `RunJoining.ts`.
//!
//! # Why this is the memory win
//!
//! `RunNormalizerAccumulator` buffers *every run on the planet* in a `Vec`, then builds
//! one global TopoJSON topology over all of it. At peak four copies of the run dataset
//! are live — the input array, the topology, the re-expanded `FeatureCollection` from
//! `topojsonClient.feature`, and the result array — and `accumulate()`
//! (`StreamTransforms.ts:182`) then pushes the whole result array into a Duplex readable
//! buffer while ignoring backpressure. This is the peak-RSS event of the pipeline and the
//! reason `MAX_OLD_SPACE_SIZE` defaults to 4096.
//!
//! # Partitioning is sound, and here is why
//!
//! Topology only couples runs that share coordinates, so it can be built per
//! spatially-connected component, in parallel. Critically, upstream calls
//! `topojsonServer.topology({ runs })` with **one argument**
//! (`RunNormalizerAccumulator.ts:38`), and topojson-server only prequantizes when
//! `quantization > 0`. So there is no `transform`, no prequantization, and arcs hold
//! absolute coordinates with arc identity decided by exact `x,y` equality. Per-partition
//! topology therefore yields identical arcs and identical coordinates — there is no
//! global quantization to reproduce.
//!
//! (The comment at `CombineRunSegments.ts:10-13` claiming "TopoJSON quantizes
//! coordinates to a fixed grid during topology construction" is false at this call site.
//! The degenerate-linestring filter it guards is still needed; the stated cause is not.)
//!
//! # Three preconditions for equivalent output
//!
//! 1. **The partition key must dominate both coupling relations.** TopoJSON shares arcs
//!    on exact float equality, but `PointMultiMap` keys nodes on `toFixed(7)`
//!    (`PointMultiMap.ts:21`), which is *coarser*: two endpoints differing in the 8th
//!    decimal are distinct arcs to TopoJSON but the same node to `PointGraph`, and
//!    `combineRunSegments` will join them. So partition by union-find over
//!    1e-7-rounded coordinates of **every** coordinate of every run, not just endpoints —
//!    interior shared points create junctions in TopoJSON's `join`, which changes the arc
//!    decomposition of both features. That key is conservative with respect to TopoJSON
//!    and exact with respect to `PointGraph`, so it never splits an interacting pair.
//! 2. **Within-partition relative order must equal global relative order.**
//!    `mergeOverlappingRuns` pushes into `arcProperties[arc].runs` in `lines`-array order
//!    (`MergeOverlappingRuns.ts:38-53`), `getDirectionData` is an asymmetric left fold,
//!    and the `isDeepStrictEqual` compares whole `ArcData` *including* `runs` order.
//!    Build each partition by filtering the global list in order and this holds.
//! 3. **Output order must be reassembled.** Tag each produced line with
//!    `(index of its generating line in the global list, sequence within that line)` and
//!    emit globally sorted by that tuple; non-line geometries keep their original
//!    indices. Each line belongs to exactly one partition, so this is well defined.
//!
//! `tests/partitioning.rs` is the property test that holds all three honest: it normalizes
//! interleaved multi-component inputs both ways and requires identical output.
//!
//! # Status
//!
//! Done and verified against the real TypeScript: the topology construction (606 recorded
//! scenes), the property merge (800 merges, 400 comparisons) and the whole pipeline
//! (700 scenes, 3,036 output runs), plus partitioned-equals-global. Not done: the
//! streaming driver below; [`normalize_runs_partitioned`] partitions in memory.
//!
//! # Streaming, because partitioning alone does not bound memory
//!
//! Building components in heap still holds everything. Three passes instead:
//!
//! 1. Stream runs, build the coordinate union-find, retain only
//!    `rounded-coord -> component id`. No features retained.
//! 2. Stream again, writing each run to its component's shard.
//! 3. Process shards with bounded parallelism, emitting in the tuple order above.
//!
//! Two extra reads of the run input are far cheaper than four copies in heap.
//!
//! # Ordering that is load-bearing
//!
//! Elevation is applied **after** normalization upstream
//! (`PrepareGeoJSON.ts:145-151`). TopoJSON's `dedup` compares only `point[0]` and
//! `point[1]`, so if elevation ran first, two arcs with equal `x,y` and different `z`
//! would be silently coalesced. Keep normalization 2D.

pub mod chains;
pub mod components;
pub mod normalize;
pub mod properties;
pub mod topology;

pub use chains::{ChainGraph, JoinKey, Link, Segment, is_degenerate, join_chains};
pub use components::{ComponentId, ComponentIndex};
pub use normalize::{
    OutputKey, RunInput, RunOutput, ViewportHinter, normalize_runs, normalize_runs_partitioned,
};
pub use topology::{InputGeometry, TopoGeometry, Topology, topology};
