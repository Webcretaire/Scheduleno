#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
deno run --allow-read --allow-write --allow-run --unstable ${DIR}/scheduler_main.ts $@