// Must stay byte-for-byte in sync with the firmware UUIDs
// (Pulsators/main/main.ino and Light Bar/main/main.ino).

// Bumped whenever a characteristic's byte layout changes - the firmware rejects any
// write whose first byte doesn't match. See root README's BLE protocol contract.
export const PROTOCOL_VERSION = 1;

export const PULSATOR_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const MOTOR_STATE_CHARACTERISTIC_UUID = '668b943b-2cac-4de0-8091-332dedc91739';
export const MOTOR_INTENSITY_CHARACTERISTIC_UUID = '9f1dc367-ee23-4254-a52a-e41b59f50502';
export const PULSATOR_DEVICE_STATE_CHARACTERISTIC_UUID = '5d55e432-99f8-4293-ae12-a024c9510362';

export const LIGHTBAR_SERVICE_UUID = '1fb5c201-4faf-459e-8fcc-c5c9c331914b';
export const LED_STATE_CHARACTERISTIC_UUID = '2cac943b-668b-4de0-8091-332dedc91739';
export const LED_COLOR_CHARACTERISTIC_UUID = '526f1035-4262-4175-8ad0-16387b946fce';
export const LED_DELAY_CHARACTERISTIC_UUID = 'ee231dc3-9f67-4254-a52a-e41b59f50502';
export const LED_SYNC_CHARACTERISTIC_UUID = '822ff8ad-58e1-44f8-8cb5-f4048a0ee3c3';
export const LIGHTBAR_DEVICE_STATE_CHARACTERISTIC_UUID = '78cb7a5e-4253-461c-83c5-75d3faa4fe2c';

// Standard Bluetooth SIG Battery Service - same on every device (Pulsators and Light Bar).
export const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL_CHARACTERISTIC_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

// Advertised BLE local names. Each physical unit's config.h (gitignored,
// per-device) must set device_Name to exactly one of these - the two
// pulsators run identical firmware and are told apart only by this name.
export const DEVICE_NAME_PULSATOR_1 = 'Pulsator 1';
export const DEVICE_NAME_PULSATOR_2 = 'Pulsator 2';
export const DEVICE_NAME_LIGHT_BAR = 'Light Bar';

export type DeviceRole = 'pulsator1' | 'pulsator2' | 'lightBar';

export const DEVICE_ROLE_NAMES: Record<DeviceRole, string> = {
  pulsator1: DEVICE_NAME_PULSATOR_1,
  pulsator2: DEVICE_NAME_PULSATOR_2,
  lightBar: DEVICE_NAME_LIGHT_BAR,
};

// How long to collect advertisements before connecting. Fixed (not "stop as soon
// as found") so that when multiple kits share a room, we've actually seen enough
// samples to pick the strongest-RSSI match per device name rather than the first one.
export const SCAN_WINDOW_MS = 6000;
