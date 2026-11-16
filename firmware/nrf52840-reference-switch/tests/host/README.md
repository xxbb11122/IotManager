# GPIO/ACK host regression

This compiles the actual `src/main.c` callback with small Zephyr API stubs. It
checks missing/configuration-failed/disconnected GPIO, ON/OFF write failures,
successful writes, invalid commands, framing, token echo and CRC. It does not
replace a Zephyr build, board flash, BLE transport test or electrical readback.

From this directory on Linux/macOS:

```sh
cc -std=c11 -Wall -Wextra -Werror -Istubs ack_test.c -o /tmp/iot-ack-test
/tmp/iot-ack-test
```

From a Visual Studio Developer PowerShell on Windows (choose an output directory
outside the source tree):

```powershell
cl /nologo /W4 /WX /Istubs ack_test.c /Fe:$env:TEMP\iot-ack-test.exe /Fo:$env:TEMP\iot-ack-test.obj
& "$env:TEMP\iot-ack-test.exe"
```
