import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";
import Mutex from "https://deno.land/x/await_mutex@v1.0.1/mod.ts";
import ProgressBar from "https://deno.land/x/progress@v1.2.3/mod.ts";
import { green, red } from "https://deno.land/std/fmt/colors.ts";

// Make sure we have a list of commands to run
if (Deno.args.length != 1) {
  console.error("This script requires exactly one parameter");
  Deno.exit(1);
}

const createWorkerMutex = new Mutex();

enum JobStatus {
  PENDING,
  STARTED,
  FINISHED,
}

class Job {
  command: string;
  status: JobStatus;
  timeout: boolean;

  constructor(command: string) {
    this.command = command;
    this.status = JobStatus.PENDING;
    this.timeout = false;
  }
}

const commandScript: string = await Deno.readTextFile(Deno.args[0].toString()); // Read whole command file
const jobs: Job[] = commandScript
  .split(/\r?\n/) // Split the file to get each individual lines
  .filter((c: string) => c.trim().length) // Remove empty commands
  .reverse() // Reverse because we'll pop() them from the end
  .map((c: string) => new Job(c)); // And finally make nice Job objects

const total = jobs.length;
const progress = new ProgressBar({
  total,
  width: Deno.consoleSize(Deno.stdout.rid).columns,
  complete: "=",
  incomplete: " ",
  display: ":completed/:total | :time [:bar] :percent",
});

function renderProgress() {
  progress.render(
    jobs.filter(({ status }) => status == JobStatus.FINISHED).length,
  );
}

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
  worker: Worker;
  currentJob: Job | undefined;

  submitJob(job: Job) {
    this.currentJob = job;
    this.worker.postMessage({ command: job.command, timeout: "3m" });
    this.currentJob.status = JobStatus.STARTED;
  }

  get busy(): boolean {
    return this.currentJob != undefined;
  }

  constructor(workerUrl: string) {
    this.currentJob = undefined;
    this.worker = new Worker(
      workerUrl,
      {
        type: "module",
        deno: true,
      },
    );
  }
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
  const job = jobs.find(({ status }) => status == JobStatus.PENDING);

  // No jobs left
  if (!job) {
    // If the request comes from a worker, kill it, we don't need it anymore
    if (selectedWorker) {
      killWorker(selectedWorker);
    }

    return;
  }

  const worker = selectedWorker || workerPool.find(({ busy }) => !busy);

  if (!worker) { // No worker found, should not happen
    console.error("No available worker found");
    jobs.push(job);
    return;
  }

  worker.submitJob(job);
}

function terminateSession() {
  for (const w of workerPool) {
    killWorker(w);
  }

  console.log("All jobs finished, here is the result:");
  jobs.map((j: Job) =>
    console.log(
      j.command.length > 50 ? `${j.command.substr(0, 47)}...` : j.command,
      "→",
      j.timeout ? red("timeout") : green("OK"),
    )
  );
}

function workerDoneWorking(worker: S4BXIWorker) {
  if (worker.currentJob) {
    worker.currentJob.status = JobStatus.FINISHED;
    worker.currentJob = undefined;
    renderProgress();
  }
  if (jobs.find(({ status }) => status == JobStatus.PENDING)) {
    scheduleNextJob(worker);
  } else { // No more commands
    killWorker(worker);
    if (!workerPool.find(({ busy }) => busy)) { // No more busy workers either
      terminateSession();
    }
  }
}

/**
 * Create a new worker in a separate thread
 */
async function createWorker() {
  const acquisitionId = await createWorkerMutex.acquire();
  await sleep(100); // Don't create them too quickly or Deno explodes

  const w = new S4BXIWorker(workerUrl);

  w.worker.addEventListener("message", (e: MessageEvent) => {
    if (e.data.done) {
      if (e.data.timeout && w.currentJob) {
        w.currentJob.timeout = true;
      }
      workerDoneWorking(w);
    } else {
      console.error("Unrecognized message from worker");
    }
  });

  workerPool.push(w);

  await sleep(100);
  createWorkerMutex.release(acquisitionId);

  return w;
}

console.log(`Using ${maxParallelProcesses} worker(s)`);

// Main script: create workers and start initial tasks

for (let i = 0; i < maxParallelProcesses; ++i) {
  await createWorker();
}

renderProgress();

for (let i = 0; i < Math.min(maxParallelProcesses, jobs.length); ++i) {
  scheduleNextJob();
}
