/* Compile the actual callback, not a reimplementation of its protocol. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#define main firmware_start
#include "../../src/main.c"
#undef main

static bool gpio_ready;
static int configure_result;
static int write_result;
static int writes;
static int sends;
static uint8_t last_reply[FRAME_LENGTH];
static unsigned checks;

bool device_is_ready(const struct device *device) { return device != NULL && gpio_ready; }
int gpio_pin_configure_dt(const struct gpio_dt_spec *spec, int flags)
{
    ARG_UNUSED(spec); ARG_UNUSED(flags);
    return configure_result;
}
int gpio_pin_set_dt(const struct gpio_dt_spec *spec, int value)
{
    ARG_UNUSED(spec); ARG_UNUSED(value);
    writes++;
    return write_result;
}
int bt_nus_send(struct bt_conn *conn, const void *data, uint16_t length)
{
    ARG_UNUSED(conn);
    assert(length == FRAME_LENGTH);
    memcpy(last_reply, data, length);
    sends++;
    return 0;
}
int bt_enable(void *callback) { ARG_UNUSED(callback); return 0; }
int bt_nus_cb_register(struct bt_nus_cb *callbacks, void *context)
{
    ARG_UNUSED(callbacks); ARG_UNUSED(context); return 0;
}
int bt_le_adv_start(const void *parameters, const struct bt_data *data, size_t count,
                    const struct bt_data *scan_data, size_t scan_count)
{
    ARG_UNUSED(parameters); ARG_UNUSED(data); ARG_UNUSED(count);
    ARG_UNUSED(scan_data); ARG_UNUSED(scan_count); return 0;
}

static void reset(bool ready, int configuration_error)
{
    gpio_ready = ready;
    configure_result = configuration_error;
    write_result = 0;
    writes = sends = 0;
    actuator_ready = power_state = false;
    memset(last_reply, 0, sizeof(last_reply));
    assert(firmware_start() == 0);
}

static void command(uint8_t opcode, uint8_t on, uint8_t result, bool expected_power)
{
    uint8_t frame[FRAME_LENGTH] = { COMMAND_MAGIC, FRAME_VERSION, opcode, 0, 0x12, 0x34, 0x56, 0x78, on, 0 };
    frame[9] = crc8(frame, FRAME_LENGTH - 1);
    int previous_sends = sends;
    nus_received(NULL, frame, sizeof(frame), NULL);
    assert(sends == previous_sends + 1);
    assert(last_reply[0] == RESPONSE_MAGIC && last_reply[1] == FRAME_VERSION);
    assert(last_reply[2] == opcode && last_reply[3] == result);
    assert(memcmp(last_reply + 4, frame + 4, 4) == 0);
    assert(last_reply[8] == (expected_power ? 1U : 0U));
    assert(last_reply[9] == crc8(last_reply, FRAME_LENGTH - 1));
    assert(power_state == expected_power);
    checks++;
}

int main(void)
{
    reset(false, 0);
    command(SET_POWER_OPCODE, 1, 4, false); /* Missing GPIO cannot acknowledge success. */
    assert(writes == 0);
    reset(true, -1);
    command(SET_POWER_OPCODE, 1, 4, false); /* Failed startup configuration stays closed. */
    assert(writes == 0);
    reset(true, 0);
    gpio_ready = false;
    command(SET_POWER_OPCODE, 1, 4, false); /* Device disappeared after configuration. */
    assert(writes == 0);
    reset(true, 0);
    write_result = -1;
    command(SET_POWER_OPCODE, 1, 4, false); /* Failed ON does not change reported state. */
    write_result = 0;
    command(SET_POWER_OPCODE, 1, 0, true);
    write_result = -1;
    command(SET_POWER_OPCODE, 0, 4, true); /* Failed OFF retains last successful ON. */
    write_result = 0;
    command(SET_POWER_OPCODE, 0, 0, false);
    int previous_writes = writes;
    command(0x7F, 1, 2, false);
    command(SET_POWER_OPCODE, 2, 3, false);
    command(SET_POWER_OPCODE, 255, 3, false);
    assert(writes == previous_writes);

    uint8_t malformed[FRAME_LENGTH + 1] = { COMMAND_MAGIC, FRAME_VERSION, SET_POWER_OPCODE, 0, 1, 2, 3, 4, 1, 0, 0 };
    malformed[9] = crc8(malformed, FRAME_LENGTH - 1);
    int previous_sends = sends;
    nus_received(NULL, malformed, 0, NULL); checks++;
    nus_received(NULL, malformed, FRAME_LENGTH - 1, NULL); checks++;
    nus_received(NULL, malformed, FRAME_LENGTH + 1, NULL); checks++;
    malformed[0] = 0;
    nus_received(NULL, malformed, FRAME_LENGTH, NULL); checks++;
    malformed[0] = COMMAND_MAGIC; malformed[1] = 2;
    nus_received(NULL, malformed, FRAME_LENGTH, NULL); checks++;
    malformed[1] = FRAME_VERSION; malformed[9] ^= 1;
    nus_received(NULL, malformed, FRAME_LENGTH, NULL); checks++;
    assert(sends == previous_sends && writes == previous_writes && !power_state);
    printf("Firmware ACK host checks: %u passed (no hardware acceptance)\n", checks);
    return 0;
}
