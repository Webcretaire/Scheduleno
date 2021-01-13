import {
  exec,
  IExecResponse,
  OutputMode,
} from "https://deno.land/x/exec/mod.ts";
import { bold, red } from "https://deno.land/std@0.79.0/fmt/colors.ts";

/**
 * Choose a number of workers based on the numbers of cores on the machine
 */
export const chooseNumberOfWorkers = (): Promise<number> =>
  // Get number of cores on this machine
  exec(
    "grep -c processor /proc/cpuinfo",
    { output: OutputMode.Capture },
  ).then((systemResponse: IExecResponse) =>
    // Divide by two because most machine are hyperthreaded, and I don't like that
    // Also subtract one so that the scheduler process has its own core
    // Finally, Math.max(..., 1) to be sure we have at least one process (should always be the case but let's make sure anyways)
    Math.max(
      Math.floor(parseInt(systemResponse.output) / 2) - 1,
      1,
    )
  );

const usageStr = `${bold("Usage:")} scheduleno [OPTIONS] FILENAME`;

export const printHelp = () => {
  console.log(
    "This utility helps schedule jobs efficiently on a multi-core machine",
  );
  console.log("");
  console.log(usageStr);
  console.log("");
  console.log(
    bold("FILENAME"),
    "is the path to a text file containing one commad per line, to be executed by workers",
  );
  console.log("");
  console.log(bold("OPTIONS"), " can include :");
  console.log("");
  console.log(
    "  ",
    bold("--parallel-workers (-p) :"),
    "Request a specific number of workers. If unspecified, the scheduler will try to find the optimal number based on the number of cores on the machine",
  );
  console.log("");
  console.log(
    "  ",
    bold("--timeout (-t) :"),
    "Timeout for each job, the expected format is similar to GNU's timeout utility. Defaults to 1 day (1d)",
  );
  console.log("");
  console.log(
    "  ",
    bold("--help (-h) :"),
    "Display this help message and exit",
  );
};

export const printBadUsage = () => {
  console.error(
    red(bold("Error:")),
    "This script requires a filename (command file)",
  );
  console.error(usageStr);
  console.error(
    "For more details run `./scheduleno --help`",
  );
};
