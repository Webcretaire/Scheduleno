import { Args, parse } from "https://deno.land/std@0.79.0/flags/mod.ts";
import { Session } from "./scheduler.ts";
import { printBadUsage, printHelp } from "./util.ts";

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

if (args.help) {
  printHelp();
  Deno.exit(0);
}

// Make sure we have a list of commands to run
if (args._.length != 1) {
  printBadUsage();
  Deno.exit(1);
}

const s = new Session(
  args._[0].toString(), // toString is redundant but it pleases TS
  args["parallel-workers"],
  args.timeout,
);

const sig = Deno.signal(Deno.Signal.SIGINT);

s.onCleanExit(() => sig.dispose());
s.start();

for await (const _ of sig) {
  console.log("\n\nKilling all running workers before exit, please be patient");
  s.emergencyStop();
}
