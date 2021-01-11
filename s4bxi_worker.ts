import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

self.onmessage = async (e: MessageEvent) => {
  const command: string = e.data.command;
  const commandFile = `./_worker_exec_${Math.random()}.sh`;
  await Deno.writeTextFile(commandFile, command);
  let bashCommand = `bash ${commandFile}`;
  if (e.data.timeout) {
    bashCommand = `timeout ${e.data.timeout} ${bashCommand}`;
  }
  const response = await exec(bashCommand, { output: OutputMode.StdOut });
  await Deno.remove(commandFile);
  self.postMessage(
    {
      done: true,
      success: response.status.success,
      timeout: response.status.code == 124,
    },
  );
};
