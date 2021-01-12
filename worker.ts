import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

self.onmessage = async (e: MessageEvent) => {
  const command: string = e.data.command;
  const randId: string = Math.random().toString(20).substr(2, 10);
  const commandFile = `./_worker_exec_${randId}.sh`;
  await Deno.writeTextFile(commandFile, command);
  let bashCommand = `bash ${commandFile}`;
  if (e.data.timeout) {
    bashCommand = `timeout ${e.data.timeout} ${bashCommand}`;
  }
  const t0 = performance.now();
  const response = await exec(bashCommand, { output: OutputMode.StdOut });
  const t1 = performance.now();
  await Deno.remove(commandFile);
  self.postMessage(
    {
      done: true,
      success: response.status.success,
      timeout: response.status.code == 124,
      time: t1 - t0
    },
  );
};
