#!/bin/bash
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
mkdir -p ${DIR}/build
deno compile --allow-read --allow-write --allow-run --unstable -o ${DIR}/build/scheduleno ${DIR}/scheduleno.ts 