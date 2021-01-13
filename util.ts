import {
  exec,
  IExecResponse,
  OutputMode,
} from "https://deno.land/x/exec/mod.ts";
import { bold, red } from "https://deno.land/std@0.79.0/fmt/colors.ts";

/**
 * Choose a number of workers based on the numbers of *physical* cores on the machine
 * A simple `grep -c processor /proc/cpuinfo` isn't what I want because it would give
 * the number of threads, i.e. twice the number of physical cores in hyperthreaded systems
 * Therefore we use `grep ^cpu\\scores /proc/cpuinfo | uniq |  awk '{print $4}'`, with
 * backslashes escaped
 */
export const chooseNumberOfWorkers = (): Promise<number> =>
  exec(
    `bash -c "grep ^cpu\\\\scores /proc/cpuinfo | uniq |  awk '{print $4}'"`,
    { output: OutputMode.Capture },
  ).then((systemResponse: IExecResponse) => parseInt(systemResponse.output));

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
    "is the path to a text file containing one commad per line, to be executed by workers (through bash)",
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
