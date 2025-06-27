import { runCommand } from "../utils/ProcessRunner";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log("Usage: extract_tiles <input.mbtiles> <output_dir>");
    process.exit(1);
  }

  await runCommand("tile-join", ["--output-to-directory", args[1], args[0]]);
}

if (require.main === module) {
  main();
}