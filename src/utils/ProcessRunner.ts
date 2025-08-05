import { spawn } from "child_process";

export interface RunCommandOptions {
  stdio?: "inherit" | "pipe" | "ignore";
  cwd?: string;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running: ${command} ${args.join(" ")}`);

    const process = spawn(command, args, {
      stdio: options.stdio || "inherit",
      cwd: options.cwd,
    });

    process.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `Command failed with exit code ${code}: ${command} ${args.join(" ")}`,
          ),
        );
      }
    });

    process.on("error", (error) => {
      reject(
        new Error(`Failed to start command "${command}": ${error.message}`),
      );
    });
  });
}
