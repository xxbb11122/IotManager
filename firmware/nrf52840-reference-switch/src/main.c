#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/services/nus.h>
#include <zephyr/logging/log.h>

LOG_MODULE_REGISTER(iot_reference_switch, LOG_LEVEL_INF);

#define FRAME_LENGTH 10
#define COMMAND_MAGIC 0xA5
#define RESPONSE_MAGIC 0x5A
#define FRAME_VERSION 1
#define SET_POWER_OPCODE 0x01

static const struct gpio_dt_spec relay = GPIO_DT_SPEC_GET_OR(DT_ALIAS(led0), gpios, {0});
static bool power_state;

static uint8_t crc8(const uint8_t *data, size_t length)
{
    uint8_t crc = 0;

    for (size_t index = 0; index < length; index++) {
        crc ^= data[index];
        for (int bit = 0; bit < 8; bit++) {
            crc = (crc & 0x80U) ? (uint8_t)((crc << 1U) ^ 0x07U) : (uint8_t)(crc << 1U);
        }
    }
    return crc;
}

static void send_reply(struct bt_conn *conn, const uint8_t *command, uint8_t result)
{
    uint8_t reply[FRAME_LENGTH] = {
        RESPONSE_MAGIC,
        FRAME_VERSION,
        command[2],
        result,
        command[4], command[5], command[6], command[7],
        power_state ? 1U : 0U,
        0U
    };

    reply[9] = crc8(reply, FRAME_LENGTH - 1);
    int error = bt_nus_send(conn, reply, sizeof(reply));
    if (error) {
        LOG_WRN("Unable to send command acknowledgement: %d", error);
    }
}

static void nus_received(struct bt_conn *conn, const void *data, uint16_t length, void *ctx)
{
    const uint8_t *frame = data;
    uint8_t result = 0;

    ARG_UNUSED(ctx);

    if (length != FRAME_LENGTH || frame[0] != COMMAND_MAGIC || frame[1] != FRAME_VERSION ||
        crc8(frame, FRAME_LENGTH - 1) != frame[FRAME_LENGTH - 1]) {
        LOG_WRN("Ignoring malformed command frame");
        return;
    }

    if (frame[2] != SET_POWER_OPCODE) {
        result = 2;
    } else if (frame[8] > 1U) {
        result = 3;
    } else {
        power_state = frame[8] == 1U;
        if (device_is_ready(relay.port) && gpio_pin_set_dt(&relay, power_state ? 1 : 0) != 0) {
            result = 4;
        }
    }

    send_reply(conn, frame, result);
}

static struct bt_nus_cb nus_callbacks = {
    .received = nus_received,
};

static const struct bt_data advertising[] = {
    BT_DATA_BYTES(BT_DATA_FLAGS, BT_LE_AD_GENERAL | BT_LE_AD_NO_BREDR),
};

int main(void)
{
    int error;

    if (device_is_ready(relay.port)) {
        error = gpio_pin_configure_dt(&relay, GPIO_OUTPUT_INACTIVE);
        if (error) {
            LOG_ERR("LED/relay GPIO configuration failed: %d", error);
        }
    }

    error = bt_enable(NULL);
    if (error) {
        LOG_ERR("Bluetooth initialization failed: %d", error);
        return 0;
    }

    error = bt_nus_cb_register(&nus_callbacks, NULL);
    if (error) {
        LOG_ERR("NUS callback registration failed: %d", error);
        return 0;
    }

    error = bt_le_adv_start(BT_LE_ADV_CONN, advertising, ARRAY_SIZE(advertising), NULL, 0);
    if (error) {
        LOG_ERR("Advertising start failed: %d", error);
        return 0;
    }

    LOG_INF("IoT reference switch is advertising");
    return 0;
}
