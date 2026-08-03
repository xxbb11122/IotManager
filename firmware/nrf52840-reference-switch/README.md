# nRF52840 reference switch

This Zephyr application is the reference firmware for the `nordic-nrf52840-switch-v1` BLE Profile. It uses Nordic UART Service (NUS), drives the board `led0` alias as the reference relay/load output, and returns a token-matched command acknowledgement.

## Frame contract

The client writes exactly 10 bytes to NUS RX (`6e400002-b5a3-f393-e0a9-e50e24dcca9e`):

```text
A5 | version | opcode | flags | token[4] | value | crc8
```

The firmware notifies NUS TX (`6e400003-b5a3-f393-e0a9-e50e24dcca9e`):

```text
5A | version | opcode | result | token[4] | state | crc8
```

`opcode=1` is `set_power`; `value` and `state` are `0` or `1`; result `0` means acknowledged. The CRC-8 polynomial is `0x07`, initialized to zero, over the first nine bytes. The token is copied into the response, allowing the Android client to ignore stale or unrelated notifications.

## Build

Install Zephyr 3.x and run from its initialized environment:

```powershell
west build -b nrf52840dk/nrf52840 .
west flash
```

Use an isolated low-voltage load or the board LED during validation. This reference application does not include mains switching hardware.
