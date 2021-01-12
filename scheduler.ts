import ProgressBar from "https://deno.land/x/progress@v1.2.3/mod.ts";
import Mutex from "https://deno.land/x/await_mutex@v1.0.1/mod.ts";
import { green, red } from "https://deno.land/std@0.79.0/fmt/colors.ts";
import { chooseNumberOfWorkers, sleep } from "./util.ts";

export enum JobStatus {
  PENDING,
  STARTED,
  FINISHED,
}

export class Job {
  command: string;
  status: JobStatus;
  timeout: boolean;
  success: boolean;

  constructor(command: string) {
    this.command = command;
    this.status = JobStatus.PENDING;
    this.timeout = false;
    this.success = false;
  }
}

export class WorkerWrapper {
  worker: Worker;
  currentJob: Job | undefined;

  submitJob(job: Job, timeout: string) {
    this.currentJob = job;
    this.worker.postMessage({ command: job.command, timeout: timeout });
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

export class Session {
  private jobTimeout: string;
  private requestedParallelWorkers: number;
  private createWorkerMutex: Mutex;
  private jobs: Job[];
  private progress: ProgressBar;
  private workerUrl: string;
  private workerPool: WorkerWrapper[];

  constructor(
    commandScriptFilename: string,
    parallelWorkers: number,
    timeout: string,
  ) {
    this.jobTimeout = timeout;
    this.requestedParallelWorkers = parallelWorkers;

    const commandScript = Deno.readTextFileSync(commandScriptFilename);

    this.jobs = commandScript
      .split(/\r?\n/) // Split the file to get each individual lines
      .filter((c: string) => c.trim().length) // Remove empty commands
      .reverse() // Reverse because we'll pop() them from the end
      .map((c: string) => new Job(c)); // And finally make nice Job objects

    const jobNumber: number = this.jobs.length;

    this.progress = new ProgressBar({
      total: jobNumber,
      width: Deno.consoleSize(Deno.stdout.rid).columns,
      complete: "=",
      incomplete: " ",
      display: ":completed/:total | :time [:bar] :percent",
    });

    this.createWorkerMutex = new Mutex();
    this.workerUrl = new URL("worker.ts", import.meta.url).href;
    this.workerPool = [];
  }

  private renderProgress() {
    this.progress.render(
      this.jobs.filter(({ status }) => status == JobStatus.FINISHED).length,
    );
  }

  private killWorker(w: WorkerWrapper) {
    const workerIndex = this.workerPool.indexOf(w);
    w.worker.terminate();
    if (workerIndex == -1) {
      console.error(
        "Terminating a worker that wasn't present in the worker pool",
      );
    } else {
      this.workerPool.splice(this.workerPool.indexOf(w), 1);
    }
  }

  /**
   * Take a job in our command list and give it to a worker
   * @param selectedWorker Optionnal, if set this worker will be used instead of searching for one
   */
  private scheduleNextJob(selectedWorker?: WorkerWrapper) {
    const job = this.jobs.find(({ status }) => status == JobStatus.PENDING);

    // No jobs left
    if (!job) {
      // If the request comes from a worker, kill it, we don't need it anymore
      if (selectedWorker) {
        this.killWorker(selectedWorker);
      }

      return;
    }

    const worker = selectedWorker || this.workerPool.find(({ busy }) => !busy);

    if (!worker) { // No worker found, should not happen
      console.error("No available worker found");
      this.jobs.push(job);
      return;
    }

    worker.submitJob(job, this.jobTimeout);
  }

  /**
   * Final output when all jobs have been executed
   */
  private terminateSession() {
    for (const w of this.workerPool) {
      this.killWorker(w);
    }

    console.log("All jobs finished, here is the result:");
    this.jobs.map((j: Job) =>
      console.log(
        j.command.length > 50 ? `${j.command.substr(0, 47)}...` : j.command,
        "→",
        j.timeout ? red("timeout") : (j.success ? green("OK") : red("error")),
      )
    );
  }

  /**
   * Callback when a worker is done executing its current job
   * @param worker 
   */
  private workerDoneWorking(worker: WorkerWrapper) {
    if (worker.currentJob) {
      worker.currentJob.status = JobStatus.FINISHED;
      worker.currentJob = undefined;
      this.renderProgress();
    }
    if (this.jobs.find(({ status }) => status == JobStatus.PENDING)) {
      this.scheduleNextJob(worker);
    } else { // No more commands
      this.killWorker(worker);
      if (!this.workerPool.find(({ busy }) => busy)) { // No more busy workers either
        this.terminateSession();
      }
    }
  }

  /**
   * Create a new worker in a separate thread
   */
  private async createWorker() {
    const acquisitionId = await this.createWorkerMutex.acquire();
    await sleep(100); // Don't create them too quickly or Deno explodes

    const w = new WorkerWrapper(this.workerUrl);

    w.worker.addEventListener("message", (e: MessageEvent) => {
      if (e.data.done) {
        if (w.currentJob) {
          w.currentJob.timeout = e.data.timeout;
          w.currentJob.success = e.data.success;
        }
        this.workerDoneWorking(w);
      } else {
        console.error("Unrecognized message from worker");
      }
    });

    this.workerPool.push(w);

    await sleep(100);
    this.createWorkerMutex.release(acquisitionId);

    return w;
  }

  /**
   * Start the session: create workers and assign initial jobs
   */
  public async start() {
    let workersToStart = this.requestedParallelWorkers;
    if (!workersToStart) {
      workersToStart = await chooseNumberOfWorkers();
    }

    console.log(`Using ${workersToStart} worker(s)`);

    // Main script: create workers and start initial tasks

    for (let i = 0; i < workersToStart; ++i) {
      await this.createWorker();
    }

    this.renderProgress();

    const initialJobsToStart = Math.min(workersToStart, this.jobs.length);
    for (let i = 0; i < initialJobsToStart; ++i) {
      this.scheduleNextJob();
    }
  }
}
