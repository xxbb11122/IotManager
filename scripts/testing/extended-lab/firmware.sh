#!/usr/bin/env bash
# Compile verification only; never flashes a connected board.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true && "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || exit 64
root="$(pwd)"
output="$root/artifacts/extended-lab/firmware"
workspace="$RUNNER_TEMP/iot-zephyr-$GITHUB_RUN_ID"
mkdir -p "$output" "$workspace"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends cmake ninja-build gperf device-tree-compiler python3-venv
python3 -m venv "$workspace/venv"
source "$workspace/venv/bin/activate"
pip install west==1.4.0
# Exact peeled commit of the official v3.7.2 tag.
zephyr_sha=bbbf8b30094dacd0d6830946ba206bcec8af6b0c
west init -m https://github.com/zephyrproject-rtos/zephyr --mr "$zephyr_sha" "$workspace/source"
cd "$workspace/source"
west update cmsis hal_nordic tinycrypt
pip install -r zephyr/scripts/requirements-base.txt
sdk_version=0.16.8
cd "$workspace"
release="https://github.com/zephyrproject-rtos/sdk-ng/releases/download/v$sdk_version"
curl --fail --location --retry 3 "$release/sha256.sum" -o sha256.sum
minimal="zephyr-sdk-${sdk_version}_linux-x86_64_minimal.tar.xz"
toolchain=toolchain_linux-x86_64_arm-zephyr-eabi.tar.xz
for archive in "$minimal" "$toolchain"; do
  curl --fail --location --retry 3 "$release/$archive" -o "$archive"
  grep -F "$archive" sha256.sum | sha256sum --check --strict -
done
tar -xf "$minimal"
tar -xf "$toolchain" -C "zephyr-sdk-$sdk_version"
export ZEPHYR_SDK_INSTALL_DIR="$workspace/zephyr-sdk-$sdk_version"
export ZEPHYR_TOOLCHAIN_VARIANT=zephyr
cd "$workspace/source"
west build -b nrf52840dk/nrf52840 "$root/firmware/nrf52840-reference-switch" -d "$workspace/build"
cp "$workspace/build/zephyr/zephyr.hex" "$workspace/build/zephyr/zephyr.bin" "$workspace/build/zephyr/zephyr.elf" "$output/"
cp "$workspace/build/zephyr/.config" "$output/zephyr.config"
west manifest --freeze > "$output/west-manifest.yml"
(cd "$output" && sha256sum zephyr.hex zephyr.bin zephyr.elf zephyr.config > SHA256SUMS)
SOURCE_SHA="$GITHUB_SHA" ZEPHYR_SHA="$zephyr_sha" OUTPUT="$output" python3 - <<'PY'
import json, os
from pathlib import Path
Path(os.environ['OUTPUT'], 'summary.json').write_text(json.dumps({
  'passed': True, 'sourceSha': os.environ['SOURCE_SHA'],
  'zephyrVersion': '3.7.2', 'zephyrSha': os.environ['ZEPHYR_SHA'],
  'sdkVersion': '0.16.8', 'board': 'nrf52840dk/nrf52840',
  'hardwareTested': False, 'productionApproved': False
}, indent=2) + '\n')
PY
