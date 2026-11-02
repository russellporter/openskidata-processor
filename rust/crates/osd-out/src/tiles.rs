//! Vector tiles through tippecanoe.
//!
//! Replaces `src/transforms/TilesGenerator.ts`. tippecanoe is already C++ and
//! multithreaded, so it is kept; this only drives it.
//!
//! The flags are a contract with the rendered map, not incidental: `-z`/`-Z` set the zoom
//! range each layer is built for, `-B` the zoom at which features start to be included, and
//! `--drop-densest-as-needed` decides what survives at low zoom. Changing any of them
//! changes which features appear on the map, so they are as upstream's, and a test pins
//! them.
//!
//! The four layer builds are independent, so they run concurrently -- but bounded, because
//! four simultaneous planet-scale builds can exhaust the memory of a smaller machine.
//! `TILE_CONCURRENCY` sets the bound (default 2).

use anyhow::{Context, Result, bail};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy)]
pub struct TileLayer {
    /// The layer name inside the tiles.
    pub name: &'static str,
    /// The intermediate tileset this layer is built into.
    pub output_file: &'static str,
    /// The slimmed GeoJSON this layer is built from, in the mapboxgl directory.
    pub source_file: &'static str,
    pub args: &'static [&'static str],
}

pub const TILE_LAYERS: [TileLayer; 4] = [
    TileLayer {
        name: "lifts",
        output_file: "lifts.mbtiles",
        source_file: "mapboxgl_lifts.geojson",
        args: &[
            "-z",
            "15",
            "-Z",
            "5",
            "--simplify-only-low-zooms",
            "--drop-densest-as-needed",
        ],
    },
    TileLayer {
        name: "runs",
        output_file: "runs.mbtiles",
        source_file: "mapboxgl_runs.geojson",
        args: &[
            "-z",
            "15",
            "-Z",
            "9",
            "--simplify-only-low-zooms",
            "--drop-densest-as-needed",
        ],
    },
    TileLayer {
        name: "skiareas",
        output_file: "ski_areas.mbtiles",
        source_file: "mapboxgl_ski_areas.geojson",
        args: &["-z", "15", "-Z", "0", "-B", "0", "--drop-densest-as-needed"],
    },
    TileLayer {
        name: "spots",
        output_file: "spots.mbtiles",
        source_file: "mapboxgl_spots.geojson",
        args: &[
            "-z",
            "15",
            "-Z",
            "9",
            "-B",
            "10",
            "--simplify-only-low-zooms",
            "--drop-densest-as-needed",
        ],
    },
];

/// The tippecanoe invocation for one layer.
pub fn tippecanoe_command(layer: &TileLayer, mapboxgl_dir: &Path, working_dir: &Path) -> Command {
    let mut command = Command::new("tippecanoe");
    command
        .arg("-Q")
        .arg("-o")
        .arg(working_dir.join(layer.output_file))
        .arg("-f")
        .args(layer.args)
        .arg(format!(
            "--named-layer={}:{}",
            layer.name,
            mapboxgl_dir.join(layer.source_file).display()
        ));
    command
}

/// The `tile-join` invocation that combines the four layers.
pub fn tile_join_command(working_dir: &Path, output: &Path) -> Command {
    let mut command = Command::new("tile-join");
    command
        .arg("-f")
        .arg("--no-tile-size-limit")
        .arg("-o")
        .arg(output);
    // Upstream's order: ski areas, runs, lifts, spots.
    for file in [
        "ski_areas.mbtiles",
        "runs.mbtiles",
        "lifts.mbtiles",
        "spots.mbtiles",
    ] {
        command.arg(working_dir.join(file));
    }
    command
}

fn run(mut command: Command) -> Result<()> {
    let description = format!("{command:?}");
    let status = command
        .status()
        .with_context(|| format!("starting {description}"))?;
    if !status.success() {
        bail!("{description} failed with {status}");
    }
    Ok(())
}

/// The number of layer builds to run at once.
pub fn concurrency() -> usize {
    std::env::var("TILE_CONCURRENCY")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(2)
        .clamp(1, TILE_LAYERS.len())
}

/// Builds the four layers, at most [`concurrency`] at a time, then joins them.
pub fn generate_tiles(mapboxgl_dir: &Path, working_dir: &Path, output: &Path) -> Result<()> {
    std::fs::create_dir_all(working_dir)?;
    let queue = Mutex::new(TILE_LAYERS.iter());
    let failures: Mutex<Vec<anyhow::Error>> = Mutex::new(Vec::new());

    std::thread::scope(|scope| {
        for _ in 0..concurrency() {
            scope.spawn(|| {
                loop {
                    let Some(layer) = queue.lock().expect("not poisoned").next() else {
                        return;
                    };
                    if let Err(error) = run(tippecanoe_command(layer, mapboxgl_dir, working_dir)) {
                        failures.lock().expect("not poisoned").push(error);
                        return;
                    }
                }
            });
        }
    });

    if let Some(error) = failures
        .into_inner()
        .expect("not poisoned")
        .into_iter()
        .next()
    {
        return Err(error);
    }
    run(tile_join_command(working_dir, output))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(OsString::from)
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    /// These are `TilesGenerator.ts`'s flags, copied; the test is the contract.
    #[test]
    fn layer_flags_are_upstreams() {
        let dir = Path::new("/in");
        let work = Path::new("/work");
        let lifts = args(&tippecanoe_command(&TILE_LAYERS[0], dir, work));
        assert_eq!(
            lifts,
            [
                "-Q",
                "-o",
                "/work/lifts.mbtiles",
                "-f",
                "-z",
                "15",
                "-Z",
                "5",
                "--simplify-only-low-zooms",
                "--drop-densest-as-needed",
                "--named-layer=lifts:/in/mapboxgl_lifts.geojson",
            ]
        );
        let skiareas = args(&tippecanoe_command(&TILE_LAYERS[2], dir, work));
        assert!(skiareas.windows(2).any(|w| w == ["-B", "0"]));
        assert!(
            skiareas.contains(&"--named-layer=skiareas:/in/mapboxgl_ski_areas.geojson".to_string())
        );
        let spots = args(&tippecanoe_command(&TILE_LAYERS[3], dir, work));
        assert!(spots.windows(2).any(|w| w == ["-B", "10"]));
        assert!(spots.windows(2).any(|w| w == ["-Z", "9"]));
    }

    #[test]
    fn tile_join_combines_in_upstreams_order() {
        let join = args(&tile_join_command(
            Path::new("/work"),
            Path::new("/out/openskimap.mbtiles"),
        ));
        assert_eq!(
            join,
            [
                "-f",
                "--no-tile-size-limit",
                "-o",
                "/out/openskimap.mbtiles",
                "/work/ski_areas.mbtiles",
                "/work/runs.mbtiles",
                "/work/lifts.mbtiles",
                "/work/spots.mbtiles",
            ]
        );
    }

    #[test]
    fn concurrency_is_bounded() {
        assert!((1..=4).contains(&concurrency()));
    }
}
