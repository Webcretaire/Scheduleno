This small Deno utility helps schedule jobs efficiently on a multi-core machine

**Requirements:** Only runs on Linux systems where `bash`, `kill`, `grep`, `uniq` and `awk` commands are available (so most Linux systems). Deno must be available in your PATH (if not you can run `scheduleno.ts` manually instead of the bash script `scheduleno`)
 
**Usage:** `./scheduleno [OPTIONS] FILENAME`

**FILENAME** is the path to a text file containing one command per line, to be executed by workers (through bash)
 
**OPTIONS**  can include :
 
- **--parallel-workers (-p) :** Request a specific number of workers. If unspecified, the scheduler will try to find the optimal number based on the number of cores on the machine

- **--timeout (-t) :** Timeout for each job, the expected format is similar to GNU's timeout utility. Defaults to 1 day (1d)

- **--help (-h) :** Display help message and exit
