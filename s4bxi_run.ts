import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

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

const systemResponse = await exec(
  "grep -c processor /proc/cpuinfo",
  { output: OutputMode.Capture },
);

if (Deno.args.length != 1) {
  console.error(Deno.args);
  Deno.exit(1);
}

const commandScript: string = await Deno.readTextFile(Deno.args[0].toString());
const commands: string[] = commandScript.split(/\r?\n/).reverse();

// Divide by two because most machine are hyperthreaded, and I don't like that
const maxParallelProcesses = Math.max(
  Math.floor(parseInt(systemResponse.output) / 2) - 1,
  1,
);

const workers: S4BXIWorker[] = [];
const workerUrl = new URL("s4bxi_worker.ts", import.meta.url).href;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleNextJob(selectedWorker?: S4BXIWorker) {
  const command = commands.pop();
  if (command) {
    const w = selectedWorker || workers.find(({ busy }) => !busy);

    if (!w) { // No worker found, should not happen
      console.error("No available worker found");
      commands.push(command);
      return;
    }

    w.busy = true;
    w.worker.postMessage({ command: command });
  }
}

function createWorker() {
  console.log("Creating worker");

  const w = new S4BXIWorker();

  w.worker.addEventListener("message", (e: MessageEvent) => {
    if (e.data.done) {
      w.busy = false;
      scheduleNextJob(w);
    } else {
      console.error("Unrecognized message from worker");
    }
  });

  workers.push(w);
}

createWorker();
await sleep(1000); // Very important to make sure Deno has read the whole worker file, or it will explode

for (let i = 1; i < maxParallelProcesses; ++i) {
  createWorker();
  await sleep(100); // Don't create them too quickly or Deno explodes
}

for (let i = 0; i < Math.min(maxParallelProcesses, commands.length); ++i) {
  scheduleNextJob();
}
