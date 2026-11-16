#ifndef IOT_ZEPHYR_TEST_API_H
#define IOT_ZEPHYR_TEST_API_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LOG_LEVEL_INF 0
#define LOG_MODULE_REGISTER(...)
#define LOG_WRN(...) ((void)0)
#define LOG_ERR(...) ((void)0)
#define LOG_INF(...) ((void)0)
#define ARG_UNUSED(value) ((void)(value))
#define ARRAY_SIZE(value) (sizeof(value) / sizeof((value)[0]))
#define GPIO_OUTPUT_INACTIVE 0
#define GPIO_DT_SPEC_GET_OR(...) { &host_gpio_device, 0 }
#define BT_DATA_FLAGS 0
#define BT_LE_AD_GENERAL 0
#define BT_LE_AD_NO_BREDR 0
#define BT_DATA_BYTES(...) { 0 }
#define BT_LE_ADV_CONN NULL

struct device { int unused; };
struct gpio_dt_spec { const struct device *port; int pin; };
struct bt_conn { int unused; };
struct bt_data { int unused; };
struct bt_nus_cb {
    void (*received)(struct bt_conn *, const void *, uint16_t, void *);
};
static struct device host_gpio_device;
bool device_is_ready(const struct device *device);
int gpio_pin_configure_dt(const struct gpio_dt_spec *spec, int flags);
int gpio_pin_set_dt(const struct gpio_dt_spec *spec, int value);
int bt_nus_send(struct bt_conn *conn, const void *data, uint16_t length);
int bt_enable(void *callback);
int bt_nus_cb_register(struct bt_nus_cb *callbacks, void *context);
int bt_le_adv_start(const void *parameters, const struct bt_data *data, size_t count,
                    const struct bt_data *scan_data, size_t scan_count);
#endif
