import ProgressBar from "https://deno.land/x/progress@v1.2.3/mod.ts";
import { green, red } from "https://deno.land/std@0.79.0/fmt/colors.ts";
import { chooseNumberOfWorkers } from "./util.ts";

type voidFunc = () => void;

export enum JobStatus {
  PENDING,
  STARTED,
  FINISHED,
}

export class Job {
  command: string;
  process: Deno.Process<Deno.RunOptions> | null;
  status: JobStatus;
  timeout: boolean;
  success: boolean;
  time: number;

  constructor(command: string) {
    this.command = command;
    this.status = JobStatus.PENDING;
    this.timeout = false;
    this.success = false;
    this.time = -1;
    this.process = null;
  }
}

export class WorkerWrapper {
  currentJob: Job | undefined;

  submitJob(job: Job, timeout: string) {
    this.currentJob = job;
    this.currentJob.status = JobStatus.STARTED;

    const randId: string = Math.random().toString(20).substr(2, 10);
    const commandFile = `./__scheduleno_worker_${randId}.sh`;

    let t0: number, t1: number, status: Deno.ProcessStatus;

    return new Promise<void>((resolve, reject) => {
      Deno.writeTextFileSync(commandFile, job.command);
      t0 = performance.now();
      job.process = Deno.run({
        cmd: ["timeout", timeout, "bash", commandFile],
      });
      job.process.status()
        .then((status) => {
          t1 = performance.now();
          job.process = null;
          Deno.removeSync(commandFile);
          job.time = t1 - t0;
          job.timeout = status.code == 124;
          job.success = status.success && status.code == 0;
          resolve();
        })
        .catch(reject);
    });
  }

  get busy(): boolean {
    return this.currentJob != undefined;
  }
}

export class Session {
  private jobTimeout: string;
  private requestedParallelWorkers: number;
  private jobs: Job[];
  private progress: ProgressBar;
  private workerPool: WorkerWrapper[];
  private progressTimeout: number;
  private cleanExitCallback: voidFunc | null;

  constructor(
    commandScriptFilename: string,
    parallelWorkers: number,
    timeout: string,
  ) {
    this.progressTimeout = 0;
    this.jobTimeout = timeout;
    this.requestedParallelWorkers = parallelWorkers;
    this.cleanExitCallback = null;

    const commandScript = Deno.readTextFileSync(commandScriptFilename);

    this.jobs = commandScript
      .split(/\r?\n/) // Split the file to get each individual lines
      .filter((c: string) => c.trim().length) // Remove empty commands
      .map((c: string) => new Job(c)); // And finally make nice Job objects

    const jobNumber: number = this.jobs.length;

    this.progress = new ProgressBar({
      total: jobNumber,
      width: Deno.consoleSize(Deno.stdout.rid).columns,
      complete: "=",
      incomplete: " ",
      display: ":completed/:total | :time [:bar] :percent",
    });

    this.workerPool = [];
  }

  /**
   * Render progress bar
   * Will be called either when something happens or every 1 to 1.5 seconds
   */
  private renderProgress() {
    if (this.progressTimeout) {
      clearTimeout(this.progressTimeout);
    }
    // Make the next timeout date a bit random, otherwise some digits of the time don't change,
    // and that's ugly (it's the only reason really)
    this.progressTimeout = setTimeout(
      () => this.renderProgress(),
      1000 + Math.random() * 500,
    );

    this.progress.render(
      this.jobs.filter(({ status }) => status == JobStatus.FINISHED).length,
    );
  }

  /**
   * Remove a worker from the pool
   */
  private killWorker(w: WorkerWrapper) {
    const workerIndex = this.workerPool.indexOf(w);
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

    worker.submitJob(job, this.jobTimeout)
      .then(() => this.workerDoneWorking(worker));
  }

  /**
   * Final output when all jobs have been executed
   */
  private terminateSession() {
    // Stop progress bar update, we're done
    clearTimeout(this.progressTimeout);
    this.progressTimeout = 0;

    for (const w of this.workerPool) {
      this.killWorker(w);
    }

    console.log("All jobs finished, here is the result:");
    this.jobs.map((j: Job) =>
      console.log(
        j.command.length > 50 ? `${j.command.substr(0, 47)}...` : j.command,
        "→",
        j.timeout ? red("timeout") : (j.success ? green("OK") : red("error")),
        `(${j.time / 1000.0}s)`,
      )
    );

    if (this.cleanExitCallback) {
      this.cleanExitCallback();
    }
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

  public async emergencyStop() {
    const kills: Promise<Deno.ProcessStatus>[] = [];

    this.jobs.map((j) => {
      if (j.process) {
        kills.push(Deno.run({ cmd: ["kill", String(j.process.pid)] }).status());
      }
    });

    await Promise.all(kills);

    // Might be a bit brutal, but the pattern is very specific, doesn't seem excessively dangerous
    await Deno.run({ cmd: ["bash", "-c", "rm ./__scheduleno_worker_*.sh"] })
      .status();

    Deno.exit(100);
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
      this.workerPool.push(new WorkerWrapper());
    }

    this.renderProgress();

    const initialJobsToStart = Math.min(workersToStart, this.jobs.length);
    for (let i = 0; i < initialJobsToStart; ++i) {
      this.scheduleNextJob();
    }
  }

  public onCleanExit(callback: voidFunc | null) {
    this.cleanExitCallback = callback;
  }
}
