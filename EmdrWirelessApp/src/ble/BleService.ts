import { BleManager, Device, State } from 'react-native-ble-plx';
import {
  DeviceRole,
  DEVICE_ROLE_NAMES,
  SCAN_WINDOW_MS,
  PULSATOR_SERVICE_UUID,
  LIGHTBAR_SERVICE_UUID,
  MOTOR_STATE_CHARACTERISTIC_UUID,
  MOTOR_INTENSITY_CHARACTERISTIC_UUID,
  LED_STATE_CHARACTERISTIC_UUID,
  LED_COLOR_CHARACTERISTIC_UUID,
  LED_DELAY_CHARACTERISTIC_UUID,
  LED_SYNC_CHARACTERISTIC_UUID,
} from './constants';
import { byteToBase64, bytesToBase64 } from '../utils/base64';
import { requestBlePermissions } from './permissions';

export type DeviceStatus = 'scanning' | 'connecting' | 'connected' | 'not_found' | 'error';

// Thrown by scanAndConnect before it ever starts scanning, so the UI can show a
// specific message instead of every device silently sitting at "not found".
export class BluetoothUnavailableError extends Error {
  constructor(public reason: 'permissions_denied' | 'powered_off') {
    super(reason);
  }
}

type PulsatorRole = 'pulsator1' | 'pulsator2';

// The app never persists a device's MAC/identifier across sessions - every
// connect is a fresh scan-and-pick-strongest-signal, by design (see project notes).
class BleService {
  private manager = new BleManager();
  private devices: Partial<Record<DeviceRole, Device>> = {};

  async waitForPoweredOn(timeoutMs = 5000): Promise<boolean> {
    if ((await this.manager.state()) === State.PoweredOn) return true;
    return new Promise(resolve => {
      const subscription = this.manager.onStateChange(state => {
        if (state === State.PoweredOn) {
          subscription.remove();
          resolve(true);
        }
      }, true);
      setTimeout(() => {
        subscription.remove();
        resolve(false);
      }, timeoutMs);
    });
  }

  // Scans for every requested role at once (one BLE scan session), tracking the
  // strongest-RSSI match per advertised name, then connects to each in turn.
  async scanAndConnect(
    roles: DeviceRole[],
    onStatusChange: (role: DeviceRole, status: DeviceStatus) => void,
  ): Promise<void> {
    // Neither of these happens automatically - react-native-ble-plx only wraps the
    // native BLE APIs, it doesn't prompt for permission or manage adapter state.
    // Order matters: checking adapter state can itself need BLUETOOTH_CONNECT on
    // Android 12+, so permissions must be granted first.
    const permissionsGranted = await requestBlePermissions();
    if (!permissionsGranted) {
      throw new BluetoothUnavailableError('permissions_denied');
    }
    const poweredOn = await this.waitForPoweredOn(5000);
    if (!poweredOn) {
      throw new BluetoothUnavailableError('powered_off');
    }

    const best: Partial<Record<DeviceRole, Device>> = {};
    roles.forEach(role => onStatusChange(role, 'scanning'));

    await new Promise<void>(resolve => {
      this.manager.startDeviceScan(
        [PULSATOR_SERVICE_UUID, LIGHTBAR_SERVICE_UUID],
        { allowDuplicates: true },
        (error, device) => {
          if (error || !device) return;
          const role = roles.find(
            r => DEVICE_ROLE_NAMES[r] === device.localName || DEVICE_ROLE_NAMES[r] === device.name,
          );
          if (!role) return;

          const current = best[role];
          if (!current || (device.rssi ?? -999) > (current.rssi ?? -999)) {
            best[role] = device;
          }
        },
      );

      setTimeout(() => {
        this.manager.stopDeviceScan();
        resolve();
      }, SCAN_WINDOW_MS);
    });

    for (const role of roles) {
      const found = best[role];
      if (!found) {
        onStatusChange(role, 'not_found');
        continue;
      }
      try {
        onStatusChange(role, 'connecting');
        const connected = await found.connect();
        await connected.discoverAllServicesAndCharacteristics();
        this.devices[role] = connected;
        onStatusChange(role, 'connected');
      } catch {
        onStatusChange(role, 'error');
      }
    }
  }

  isConnected(role: DeviceRole): boolean {
    return !!this.devices[role];
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Object.values(this.devices).map(device => device?.cancelConnection().catch(() => {})),
    );
    this.devices = {};
  }

  // --- Pulsator writes ---------------------------------------------------
  async writeMotorState(role: PulsatorRole, on: boolean): Promise<void> {
    const device = this.devices[role];
    if (!device) return;
    await device.writeCharacteristicWithoutResponseForService(
      PULSATOR_SERVICE_UUID,
      MOTOR_STATE_CHARACTERISTIC_UUID,
      byteToBase64(on ? 1 : 0),
    );
  }

  async writeMotorIntensity(role: PulsatorRole, firmwareValue: number): Promise<void> {
    const device = this.devices[role];
    if (!device) return;
    await device.writeCharacteristicWithResponseForService(
      PULSATOR_SERVICE_UUID,
      MOTOR_INTENSITY_CHARACTERISTIC_UUID,
      byteToBase64(firmwareValue),
    );
  }

  // --- Light bar writes ----------------------------------------------------
  async writeLedState(on: boolean): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await device.writeCharacteristicWithResponseForService(
      LIGHTBAR_SERVICE_UUID,
      LED_STATE_CHARACTERISTIC_UUID,
      byteToBase64(on ? 1 : 0),
    );
  }

  async writeLedColor(r: number, g: number, b: number): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await device.writeCharacteristicWithResponseForService(
      LIGHTBAR_SERVICE_UUID,
      LED_COLOR_CHARACTERISTIC_UUID,
      bytesToBase64([r, g, b]),
    );
  }

  async writeLedDelay(perLedDelayMs: number): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await device.writeCharacteristicWithResponseForService(
      LIGHTBAR_SERVICE_UUID,
      LED_DELAY_CHARACTERISTIC_UUID,
      byteToBase64(perLedDelayMs),
    );
  }

  async pingLedSync(): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await device.writeCharacteristicWithoutResponseForService(
      LIGHTBAR_SERVICE_UUID,
      LED_SYNC_CHARACTERISTIC_UUID,
      byteToBase64(1),
    );
  }

  destroy(): void {
    this.manager.destroy();
  }
}

export const bleService = new BleService();
