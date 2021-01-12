import { Args, parse } from "https://deno.land/std@0.79.0/flags/mod.ts";
import { bold, red } from "https://deno.land/std@0.79.0/fmt/colors.ts";
import { Session } from "./scheduler.ts";

const args: Args = parse(Deno.args, {
  alias: {
    timeout: "t",
    help: "h",
    "parallel-workers": "p",
  },
  boolean: ["help"],
  string: ["timeout"],
  default: {
    help: false,
    timeout: "1d",
    "parallel-workers": 0,
  },
});

const usageStr = `${bold("Usage:")} scheduleno [OPTIONS] FILENAME`;

if (args.help) {
  console.log(
    "This utility helps schedule jobs efficiently on a multi-core machine",
  );
  console.log(" ");
  console.log(usageStr);
  console.log(" ");
  console.log(
    bold("FILENAME"),
    "is the path to a text file containing one commad per line, to be executed by workers",
  );
  console.log(" ");
  console.log(bold("OPTIONS"), " can include :");
  console.log(" ");
  console.log(
    "  ",
    bold("--parallel-workers (-p) :"),
    "Request a specific number of workers. If unspecified, the scheduler will try to find the optimal number based on the number of cores on the machine",
  );
  console.log(" ");
  console.log(
    "  ",
    bold("--timeout (-t) :"),
    "Timeout for each job, the expected format is similar to GNU's timeout utility. Defaults to 1 day (1d)",
  );
  console.log(" ");
  console.log(
    "  ",
    bold("--help (-h) :"),
    "Display this help message and exit",
  );

  Deno.exit(0);
}

// Make sure we have a list of commands to run
if (args._.length != 1) {
  console.error(
    red(bold("Error:")),
    "This script requires a filename (command file)",
  );
  console.error(usageStr);
  console.error(
    "For more details run `./scheduleno --help`",
  );
  Deno.exit(1);
}

const s = new Session(
  args._[0].toString(), // toString is redundant but it pleases TS
  args["parallel-workers"],
  args.timeout,
);
s.start();
