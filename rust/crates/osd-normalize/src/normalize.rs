//! Run normalization: the whole of `RunNormalizerAccumulator.results()`.
//!
//! topology, then `mergeOverlappingRuns`, then `combineRunSegments`.
//!
//! This is the **global** form: one topology over every run it is given. The partitioned
//! form (see the crate docs) calls this per connected component, and the property test in
//! `tests/` shows the two agree.
//!
//! # What the stages do
//!
//! 1. **Topology.** Lines are split wherever another run branches off, and shared stretches
//!    become one arc. (`crate::topology`.)
//! 2. **Merge overlapping.** Where several runs share an arc, the arc is emitted once with
//!    their properties merged, and consecutive arcs with the same group of runs are
//!    concatenated back into one line. This is how two ways mapped along the same piste
//!    become one run.
//! 3. **Combine segments.** Neighbouring segments describing the same run are joined end to
//!    end into chains. (`crate::chains`.)
//!
//! Output order is part of the contract: polygons first, in input order, then the line
//! segments in the order they were produced. Downstream steps are order-sensitive.
//!
//! # Viewport hints
//!
//! Every segment produced here gets a fresh viewport hint computed from its geometry, as
//! upstream does. The computation is supplied by the caller (it is float-sensitive and
//! lives in `openskidata-format`), which also lets the tests substitute a constant.

use crate::chains::{ChainGraph, JoinKey, Segment};
use crate::components::ComponentIndex;
use crate::properties::{comparison_key, identity_key, merged_properties};
use crate::topology::{InputGeometry, TopoGeometry, Topology, topology};
use anyhow::{Result, anyhow};
use openskidata_format::run::RunProperties;
use openskidata_format::viewport_hint::{ViewportHint, compute_viewport_hint};
use osd_store::FixedCoord;
use std::collections::HashMap;

/// A run going in.
#[derive(Debug, Clone, PartialEq)]
pub struct RunInput {
    pub geometry: InputGeometry,
    pub properties: RunProperties,
}

/// A run coming out.
#[derive(Debug, Clone, PartialEq)]
pub struct RunOutput {
    pub geometry: InputGeometry,
    pub properties: RunProperties,
}

/// The viewport hint of a 2D line, which is what normalization produces: elevation is added
/// after this stage, and the hint is recomputed then.
pub fn line_viewport_hint(coordinates: &[FixedCoord]) -> ViewportHint {
    let positions: Vec<[f64; 3]> = coordinates
        .iter()
        .map(|c| [c.lng_degrees(), c.lat_degrees(), 0.0])
        .collect();
    compute_viewport_hint(&[&positions]).expect("a line has positions")
}

/// Computes the viewport hint of a line.
pub type ViewportHinter<'a> = &'a (dyn Fn(&[FixedCoord]) -> ViewportHint + Sync);

/// Where an output run sits in the global output order.
///
/// Polygons come first, in input order. Lines follow, ordered by the input line that
/// generated them and then by position along it. This is what lets components be normalized
/// separately and the results put back in the order a single global run would produce.
///
/// `sequence` is redundant with the stable sort used to reassemble (each component's output
/// is already in order), so dropping it changes nothing observable; it is kept so that the
/// order is stated by the key rather than inferred from how the pieces were concatenated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct OutputKey {
    pub is_line: bool,
    pub source: u32,
    pub sequence: u32,
}

/// A use of an arc by one input line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ArcUse {
    is_reversed: bool,
    /// Index of the input run, whose properties are merged.
    run: usize,
    /// Equal for runs whose complete properties are equal (`isDeepStrictEqual`).
    identity: usize,
}

type ArcData = Vec<ArcUse>;

/// Two arc groups are the same group when their runs match pairwise, including direction
/// and the runs' complete properties.
fn same_arc_data(a: &ArcData, b: &ArcData) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(x, y)| x.is_reversed == y.is_reversed && x.identity == y.identity)
}

#[derive(Debug, Clone, Copy)]
struct DirectionData {
    is_reversed: bool,
    oneway: Option<bool>,
}

/// An asymmetric left fold, so the order of runs matters.
fn direction_data(runs: &ArcData, properties: &[RunProperties]) -> DirectionData {
    runs.iter()
        .map(|run| DirectionData {
            is_reversed: run.is_reversed,
            oneway: properties[run.run].oneway,
        })
        .reduce(|previous, current| {
            if previous.oneway == Some(true)
                && current.oneway == Some(true)
                && previous.is_reversed != current.is_reversed
            {
                DirectionData {
                    oneway: Some(false),
                    is_reversed: previous.is_reversed,
                }
            } else if previous.oneway == Some(false) {
                DirectionData {
                    oneway: Some(false),
                    is_reversed: current.is_reversed,
                }
            } else if current.oneway == Some(false) {
                DirectionData {
                    oneway: Some(false),
                    is_reversed: previous.is_reversed,
                }
            } else if previous.oneway == Some(true) {
                previous
            } else if current.oneway == Some(true) {
                current
            } else {
                previous
            }
        })
        .expect("an arc is used by at least one run")
}

/// A segment produced by merging overlapping runs.
struct MergedLine {
    coordinates: Vec<FixedCoord>,
    properties: RunProperties,
    order: OutputKey,
}

fn decode_arc(reference: i32) -> (usize, bool) {
    if reference < 0 {
        ((!reference) as usize, true)
    } else {
        (reference as usize, false)
    }
}

/// `mergeOverlappingRuns`. Returns the merged line segments, in production order.
fn merge_overlapping(
    topology: &Topology,
    runs: &[RunInput],
    global: &[usize],
    hint: ViewportHinter<'_>,
) -> Vec<MergedLine> {
    let properties: Vec<RunProperties> = runs.iter().map(|r| r.properties.clone()).collect();

    // Runs with equal complete properties share an identity.
    let mut identities: HashMap<String, usize> = HashMap::new();
    let identity_of: Vec<usize> = runs
        .iter()
        .map(|run| {
            let next = identities.len();
            *identities
                .entry(identity_key(&run.properties))
                .or_insert(next)
        })
        .collect();

    let lines: Vec<(usize, &Vec<i32>)> = topology
        .geometries
        .iter()
        .enumerate()
        .filter_map(|(i, geometry)| match geometry {
            TopoGeometry::Line(arcs) => Some((i, arcs)),
            TopoGeometry::Polygon(_) => None,
        })
        .collect();

    // Which runs use each arc, in line order.
    let mut arc_data: HashMap<usize, ArcData> = HashMap::new();
    for &(run, arcs) in &lines {
        for &reference in arcs {
            let (arc, is_reversed) = decode_arc(reference);
            arc_data.entry(arc).or_default().push(ArcUse {
                is_reversed,
                run,
                identity: identity_of[run],
            });
        }
    }

    let mut merged: Vec<MergedLine> = Vec::new();

    for &(source_line, arcs) in &lines {
        let mut last: Option<ArcData> = None;
        let mut accumulated: Vec<i32> = Vec::new();
        let mut sequence = 0u32;

        let mut add_line_if_completed =
            |current: Option<&ArcData>,
             force_split: bool,
             last: &mut Option<ArcData>,
             accumulated: &mut Vec<i32>| {
                if let Some(previous) = last.as_ref() {
                    let differs = match current {
                        Some(current) => !same_arc_data(current, previous),
                        None => true,
                    };
                    if (differs || force_split) && !accumulated.is_empty() {
                        let members: Vec<&RunProperties> =
                            previous.iter().map(|u| &properties[u.run]).collect();
                        let mut line_properties = merged_properties(&members);
                        line_properties.oneway = direction_data(previous, &properties).oneway;
                        let coordinates = topology.line_coordinates(accumulated);
                        line_properties.viewport_hint = hint(&coordinates);
                        merged.push(MergedLine {
                            coordinates,
                            properties: line_properties,
                            order: OutputKey {
                                is_line: true,
                                source: global[source_line] as u32,
                                sequence,
                            },
                        });
                        sequence += 1;
                        accumulated.clear();
                    }
                }
                *last = current.cloned();
            };

        for &reference in arcs {
            let (arc, is_reversed) = decode_arc(reference);
            // The first line to reach an arc emits it for every run that shares it.
            let Some(data) = arc_data.remove(&arc) else {
                add_line_if_completed(None, false, &mut last, &mut accumulated);
                continue;
            };

            let is_run_reversed = direction_data(&data, &properties).is_reversed;
            let emitted = if is_run_reversed {
                !(arc as i32)
            } else {
                arc as i32
            };

            add_line_if_completed(
                Some(&data),
                is_run_reversed != is_reversed,
                &mut last,
                &mut accumulated,
            );
            accumulated.push(emitted);
        }

        add_line_if_completed(None, false, &mut last, &mut accumulated);
    }

    merged
}

/// `isDegenerateLineString`.
fn is_degenerate(coordinates: &[FixedCoord]) -> bool {
    coordinates.len() < 2 || coordinates.iter().all(|&c| c == coordinates[0])
}

/// `combineRunSegments` over the polygons and merged lines.
fn combine_segments(
    polygons: Vec<(OutputKey, RunOutput)>,
    lines: Vec<MergedLine>,
    hint: ViewportHinter<'_>,
) -> Result<Vec<(OutputKey, RunOutput)>> {
    let lines: Vec<MergedLine> = lines
        .into_iter()
        .filter(|line| !is_degenerate(&line.coordinates))
        .collect();

    let mut join_keys: HashMap<String, u64> = HashMap::new();
    let segments: Vec<Segment> = lines
        .iter()
        .enumerate()
        .map(|(position, line)| {
            let next = join_keys.len() as u64;
            let key = *join_keys
                .entry(comparison_key(&line.properties))
                .or_insert(next);
            Segment {
                run: position,
                head: line.coordinates[0],
                tail: *line.coordinates.last().expect("not degenerate"),
                join_key: JoinKey(key),
                oneway: line.properties.oneway == Some(true),
            }
        })
        .collect();

    let mut graph = ChainGraph::build(segments);
    let mut output = polygons;

    for position in 0..lines.len() {
        let Some(links) = graph.take_chain(position) else {
            continue;
        };

        let members: Vec<&RunProperties> = links
            .iter()
            .map(|link| &lines[link.run].properties)
            .collect();
        let properties_merged = merged_properties(&members);

        let mut coordinates: Vec<FixedCoord> = Vec::new();
        for link in &links {
            let line = &lines[link.run].coordinates;
            let ordered: Box<dyn Iterator<Item = &FixedCoord>> = if link.reversed {
                Box::new(line.iter().rev())
            } else {
                Box::new(line.iter())
            };
            for (i, &coordinate) in ordered.enumerate() {
                if i == 0 && !coordinates.is_empty() {
                    if coordinates.last() != Some(&coordinate) {
                        return Err(anyhow!("mismatched coords in PointGraph"));
                    }
                    // The shared endpoint is already present from the previous link.
                    continue;
                }
                coordinates.push(coordinate);
            }
        }

        let mut properties = properties_merged;
        properties.viewport_hint = hint(&coordinates);
        // A chain is seeded by its earliest member, so it takes that member's place.
        output.push((
            lines[position].order,
            RunOutput {
                geometry: InputGeometry::Line(coordinates),
                properties,
            },
        ));
    }

    Ok(output)
}

/// Normalizes `runs`, which sit at `global` indices of the full input, returning each
/// output with its place in the global order.
fn normalize_keyed(
    runs: &[RunInput],
    global: &[usize],
    hint: ViewportHinter<'_>,
) -> Result<Vec<(OutputKey, RunOutput)>> {
    let geometries: Vec<InputGeometry> = runs.iter().map(|run| run.geometry.clone()).collect();
    let topology = topology(&geometries)?;

    let merged_lines = merge_overlapping(&topology, runs, global, hint);

    // Polygons keep their own properties and come first, in input order.
    let polygons: Vec<(OutputKey, RunOutput)> = topology
        .geometries
        .iter()
        .zip(runs)
        .enumerate()
        .filter_map(|(local, (geometry, run))| match geometry {
            TopoGeometry::Polygon(rings) => Some((
                OutputKey {
                    is_line: false,
                    source: global[local] as u32,
                    sequence: 0,
                },
                RunOutput {
                    geometry: InputGeometry::Polygon(
                        rings
                            .iter()
                            .map(|ring| topology.ring_coordinates(ring))
                            .collect(),
                    ),
                    properties: run.properties.clone(),
                },
            )),
            TopoGeometry::Line(_) => None,
        })
        .collect();

    combine_segments(polygons, merged_lines, hint)
}

/// Normalizes a set of runs as one topology. See the module docs.
pub fn normalize_runs(runs: &[RunInput], hint: ViewportHinter<'_>) -> Result<Vec<RunOutput>> {
    let global: Vec<usize> = (0..runs.len()).collect();
    Ok(normalize_keyed(runs, &global, hint)?
        .into_iter()
        .map(|(_, run)| run)
        .collect())
}

/// Normalizes a set of runs one spatially-connected component at a time, in parallel, and
/// returns exactly what [`normalize_runs`] would.
///
/// Runs only interact where they share a coordinate, so a component can be normalized on
/// its own: it sees the same arcs and the same relative order of its runs as it would
/// globally. The outputs are put back in global order by their [`OutputKey`]. The
/// equivalence is what `tests/partitioning.rs` checks.
pub fn normalize_runs_partitioned(
    runs: &[RunInput],
    hint: ViewportHinter<'_>,
) -> Result<Vec<RunOutput>> {
    use rayon::prelude::*;

    let mut components = ComponentIndex::default();
    for run in runs {
        match &run.geometry {
            InputGeometry::Line(points) => components.add_run(points),
            InputGeometry::Polygon(rings) => {
                let all: Vec<FixedCoord> = rings.iter().flatten().copied().collect();
                components.add_run(&all);
            }
        }
    }

    let groups = components.groups();
    let per_component: Vec<Vec<(OutputKey, RunOutput)>> = groups
        .par_iter()
        .map(|(_, indices)| {
            let subset: Vec<RunInput> = indices.iter().map(|&i| runs[i].clone()).collect();
            normalize_keyed(&subset, indices, hint)
        })
        .collect::<Result<_>>()?;

    let mut all: Vec<(OutputKey, RunOutput)> = per_component.into_iter().flatten().collect();
    all.sort_by_key(|(key, _)| *key);
    Ok(all.into_iter().map(|(_, run)| run).collect())
}
