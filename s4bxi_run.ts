import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

// Make sure we have a list of commands to run
if (Deno.args.length != 1) {
  console.error("This script requires exactly one parameter");
  Deno.exit(1);
}

const commandScript: string = await Deno.readTextFile(Deno.args[0].toString()); // Read whole command file
const commands: string[] = commandScript
  .split(/\r?\n/) // Split the file to get each individual lines
  .filter((c: string) => c.trim().length) // Remove empty commands
  .reverse(); // Reverse because we'll pop() them from the end

// Get number of cores on this machine
const systemResponse = await exec(
  "grep -c processor /proc/cpuinfo",
  { output: OutputMode.Capture },
);

// Divide by two because most machine are hyperthreaded, and I don't like that
// Also subtract one so that the current process (s4bxi_run) has its own core
// Finally, Math.max(..., 1) to be sure we have at least one process (should always be the case but let's make sure anyways)
const maxParallelProcesses = Math.max(
  Math.floor(parseInt(systemResponse.output) / 2) - 1,
  1,
);

const workerUrl = new URL("s4bxi_worker.ts", import.meta.url).href;

class S4BXIWorker {
  worker = new Worker(
    workerUrl,
    {
      type: "module",
      deno: true,
    },
  );
  busy = false;
}

const workerPool: S4BXIWorker[] = [];

/**
 * Util function to sleep. Obviously await it or it won't do anything
 * @param ms 
 */
async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killWorker(w: S4BXIWorker) {
  console.log("Terminating worker");
  console.table(workerPool);
  const workerIndex = workerPool.indexOf(w);
  w.worker.terminate();
  if (workerIndex == -1) {
    console.error(
      "Terminating a worker that wasn't present in the worker pool",
    );
  } else {
    workerPool.splice(workerPool.indexOf(w), 1);
  }
}

/**
 * Take a job in our command list and give it to a worker
 * @param selectedWorker Optionnal, if set this worker will be used instead of searching for one
 */
function scheduleNextJob(selectedWorker?: S4BXIWorker) {
  const command = commands.pop();

  // No command left
  if (!command) {
    // If the request comes from a worker, kill it, we don't need it anymore
    if (selectedWorker) {
      killWorker(selectedWorker);
    }

    return;
  }

  const w = selectedWorker || workerPool.find(({ busy }) => !busy);

  if (!w) { // No worker found, should not happen
    console.error("No available worker found");
    commands.push(command);
    return;
  }

  w.busy = true;
  w.worker.postMessage({ command: command });
}

function terminateSession() {
  for (const w of workerPool) {
    killWorker(w);
  }

  console.log("All jobs finished");
}

function workerDoneWorking(w: S4BXIWorker) {
  w.busy = false;
  if (commands.length) {
    scheduleNextJob(w);
  } else { // No more commands
    killWorker(w);
    if (!workerPool.find(({ busy }) => busy)) { // No more busy workers either
      terminateSession();
    }
  }
}

/**
 * Create a new worker in a separate thread
 */
function createWorker() {
  console.log("Creating worker");

  const w = new S4BXIWorker();

  w.worker.addEventListener("message", (e: MessageEvent) => {
    if (e.data.done) {
      workerDoneWorking(w);
    } else {
      console.error("Unrecognized message from worker");
    }
  });

  workerPool.push(w);
}

// Main script: create workers and start initial tasks

createWorker();
await sleep(1000); // Very important to make sure Deno has read the whole worker file, or it will explode

for (let i = 1; i < maxParallelProcesses; ++i) {
  createWorker();
  await sleep(100); // Don't create them too quickly or Deno explodes
}

for (let i = 0; i < Math.min(maxParallelProcesses, commands.length); ++i) {
  scheduleNextJob();
}
