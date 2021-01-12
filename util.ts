import {
  exec,
  IExecResponse,
  OutputMode,
} from "https://deno.land/x/exec/mod.ts";

/**
 * Choose a number of workers based on the numbers of cores on the machine
 */
export function chooseNumberOfWorkers(): Promise<number> {
  // Get number of cores on this machine
  return exec(
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
}
