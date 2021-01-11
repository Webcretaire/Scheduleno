import { exec, OutputMode } from "https://deno.land/x/exec/mod.ts";

self.onmessage = async (e: MessageEvent) => {
  const command: string = e.data.command;
  const commandFile = `./_worker_exec_${Math.random()}.sh`;
  await Deno.writeTextFile(commandFile, command);
  await exec(`bash ${commandFile}`, { output: OutputMode.StdOut });
  await Deno.remove(commandFile);
  self.postMessage({ done: true })
};
