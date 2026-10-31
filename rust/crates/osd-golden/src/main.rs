//! `osd-golden` CLI: extract fixtures, compare runs, explain a divergence.

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "osd-golden", about = "Golden-master harness", version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand, Debug)]
enum Command {
    /// Extract inputs and inline snapshots from the TypeScript tests.
    Extract {
        repo_root: PathBuf,
        out_dir: PathBuf,
    },
    /// Compare two output directories and print the semantic report.
    Compare {
        baseline: PathBuf,
        candidate: PathBuf,
    },
    /// Explain the first membership divergence between two runs.
    ExplainDivergence {
        baseline: PathBuf,
        candidate: PathBuf,
    },
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Extract { .. } => todo!("wire up osd_golden::extract_fixtures"),
        Command::Compare { .. } => todo!("wire up osd_golden::compare"),
        Command::ExplainDivergence { .. } => todo!("wire up osd_golden::explain_divergence"),
    }
}
