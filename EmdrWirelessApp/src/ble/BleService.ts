import { BleManager, Device, State } from 'react-native-ble-plx';
import {
  DeviceRole,
  DEVICE_ROLE_NAMES,
  SCAN_WINDOW_MS,
  PROTOCOL_VERSION,
  PULSATOR_SERVICE_UUID,
  LIGHTBAR_SERVICE_UUID,
  MOTOR_STATE_CHARACTERISTIC_UUID,
  MOTOR_INTENSITY_CHARACTERISTIC_UUID,
  PULSATOR_DEVICE_STATE_CHARACTERISTIC_UUID,
  LED_STATE_CHARACTERISTIC_UUID,
  LED_COLOR_CHARACTERISTIC_UUID,
  LED_DELAY_CHARACTERISTIC_UUID,
  LED_SYNC_CHARACTERISTIC_UUID,
  LIGHTBAR_DEVICE_STATE_CHARACTERISTIC_UUID,
  BATTERY_SERVICE_UUID,
  BATTERY_LEVEL_CHARACTERISTIC_UUID,
} from './constants';
import { byteToBase64, bytesToBase64, base64ToBytes } from '../utils/base64';
import { requestBlePermissions } from './permissions';
import {
  PulsatorRole,
  BluetoothUnavailableError,
  PulsatorState,
  LightBarState,
  ConnectCallbacks,
  IBleService,
} from './types';

export type { DeviceStatus, ParsedDeviceState, ConnectCallbacks } from './types';
export { BluetoothUnavailableError } from './types';

// How long to wait before trying again after an unexpected disconnect, and how many
// times (plus how long between) to retry a single failed write before giving up.
const RECONNECT_DELAY_MS = 2000;
const WRITE_RETRY_ATTEMPTS = 3;
const WRITE_RETRY_DELAY_MS = 1000;

function parsePulsatorState(bytes: number[]): PulsatorState | null {
  if (bytes.length < 3 || bytes[0] !== PROTOCOL_VERSION) return null;
  return { motorState: bytes[1] === 1 ? 1 : 0, motorIntensity: bytes[2] };
}

function parseLightBarState(bytes: number[]): LightBarState | null {
  if (bytes.length < 6 || bytes[0] !== PROTOCOL_VERSION) return null;
  return { lightState: bytes[1] === 1 ? 1 : 0, r: bytes[2], g: bytes[3], b: bytes[4], delay: bytes[5] };
}

// The app never persists a device's MAC/identifier across sessions - every
// connect is a fresh scan-and-pick-strongest-signal, by design (see project notes).
class BleService implements IBleService {
  private manager = new BleManager();
  private devices: Partial<Record<DeviceRole, Device>> = {};
  private callbacks: ConnectCallbacks | null = null;
  private activeRoles: DeviceRole[] = [];
  private intentionalDisconnect = false;

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
  async scanAndConnect(roles: DeviceRole[], callbacks: ConnectCallbacks): Promise<void> {
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

    this.callbacks = callbacks;
    this.activeRoles = roles;
    this.intentionalDisconnect = false;

    roles.forEach(role => callbacks.onStatusChange(role, 'scanning'));
    const best = await this.scanFor(roles);

    for (const role of roles) {
      const found = best[role];
      if (!found) {
        callbacks.onStatusChange(role, 'not_found');
        continue;
      }
      await this.connectToDevice(role, found);
    }
  }

  isConnected(role: DeviceRole): boolean {
    return !!this.devices[role];
  }

  async disconnectAll(): Promise<void> {
    this.intentionalDisconnect = true;
    this.activeRoles = [];
    await Promise.all(
      Object.values(this.devices).map(device => device?.cancelConnection().catch(() => {})),
    );
    this.devices = {};
  }

  // --- Scanning -------------------------------------------------------------
  private async scanFor(roles: DeviceRole[]): Promise<Partial<Record<DeviceRole, Device>>> {
    const best: Partial<Record<DeviceRole, Device>> = {};
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
    return best;
  }

  // --- Connect lifecycle (initial + auto-reconnect share this) --------------
  private async connectToDevice(role: DeviceRole, found: Device): Promise<void> {
    const callbacks = this.callbacks;
    if (!callbacks) return;
    try {
      callbacks.onStatusChange(role, 'connecting');
      const connected = await found.connect();
      await connected.discoverAllServicesAndCharacteristics();
      this.devices[role] = connected;
      callbacks.onStatusChange(role, 'connected');

      connected.onDisconnected(() => {
        delete this.devices[role];
        if (this.intentionalDisconnect || !this.activeRoles.includes(role)) return;
        callbacks.onStatusChange(role, 'connecting');
        setTimeout(() => this.attemptReconnect(role), RECONNECT_DELAY_MS);
      });

      await this.seedStateAndBattery(role, connected, callbacks);
    } catch (err) {
      console.warn(`[BleService] connect failed for ${role}:`, err);
      callbacks.onStatusChange(role, 'error');
    }
  }

  // Retries indefinitely, matching the documented behavior we're deliberately
  // matching: firmware keeps advertising after a drop, so eventually this finds it.
  private async attemptReconnect(role: DeviceRole): Promise<void> {
    if (this.intentionalDisconnect || !this.activeRoles.includes(role)) return;
    const best = await this.scanFor([role]);
    const found = best[role];
    if (!found) {
      setTimeout(() => this.attemptReconnect(role), RECONNECT_DELAY_MS);
      return;
    }
    await this.connectToDevice(role, found);
  }

  // --- Initial read + live subscription for State and Battery ---------------
  private async seedStateAndBattery(
    role: DeviceRole,
    device: Device,
    callbacks: ConnectCallbacks,
  ): Promise<void> {
    const serviceUUID = role === 'lightBar' ? LIGHTBAR_SERVICE_UUID : PULSATOR_SERVICE_UUID;
    const stateCharUUID =
      role === 'lightBar' ? LIGHTBAR_DEVICE_STATE_CHARACTERISTIC_UUID : PULSATOR_DEVICE_STATE_CHARACTERISTIC_UUID;
    const parse = role === 'lightBar' ? parseLightBarState : parsePulsatorState;

    try {
      const characteristic = await device.readCharacteristicForService(serviceUUID, stateCharUUID);
      const parsed = characteristic.value ? parse(base64ToBytes(characteristic.value)) : null;
      if (parsed) callbacks.onStateUpdate?.(role, parsed, true);
    } catch (err) {
      console.warn(`[BleService] initial state read failed for ${role}:`, err);
    }

    device.monitorCharacteristicForService(serviceUUID, stateCharUUID, (error, characteristic) => {
      if (error || !characteristic?.value) return;
      const parsed = parse(base64ToBytes(characteristic.value));
      if (parsed) callbacks.onStateUpdate?.(role, parsed, false);
    });

    // Battery Service is optional - firmware without it, or hardware that hasn't
    // wired real sense circuitry yet, just won't answer, which is fine either way.
    try {
      const batteryChar = await device.readCharacteristicForService(
        BATTERY_SERVICE_UUID,
        BATTERY_LEVEL_CHARACTERISTIC_UUID,
      );
      const bytes = batteryChar.value ? base64ToBytes(batteryChar.value) : [];
      if (bytes.length >= 1) callbacks.onBatteryUpdate?.(role, bytes[0]);
    } catch {
      // no battery service present - not an error, just nothing to show
    }

    device.monitorCharacteristicForService(
      BATTERY_SERVICE_UUID,
      BATTERY_LEVEL_CHARACTERISTIC_UUID,
      (error, characteristic) => {
        if (error || !characteristic?.value) return;
        const bytes = base64ToBytes(characteristic.value);
        if (bytes.length >= 1) callbacks.onBatteryUpdate?.(role, bytes[0]);
      },
    );
  }

  // --- Write retry ------------------------------------------------------------
  private async writeWithRetry(fn: () => Promise<unknown>): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= WRITE_RETRY_ATTEMPTS; attempt++) {
      try {
        await fn();
        return;
      } catch (err) {
        lastError = err;
        if (attempt < WRITE_RETRY_ATTEMPTS) {
          await new Promise<void>(resolve => setTimeout(resolve, WRITE_RETRY_DELAY_MS));
        }
      }
    }
    throw lastError;
  }

  // --- Pulsator writes (every payload is [PROTOCOL_VERSION, ...fields]) ------
  async writeMotorState(role: PulsatorRole, on: boolean): Promise<void> {
    const device = this.devices[role];
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithoutResponseForService(
        PULSATOR_SERVICE_UUID,
        MOTOR_STATE_CHARACTERISTIC_UUID,
        bytesToBase64([PROTOCOL_VERSION, on ? 1 : 0]),
      ),
    );
  }

  async writeMotorIntensity(role: PulsatorRole, firmwareValue: number): Promise<void> {
    const device = this.devices[role];
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithResponseForService(
        PULSATOR_SERVICE_UUID,
        MOTOR_INTENSITY_CHARACTERISTIC_UUID,
        bytesToBase64([PROTOCOL_VERSION, firmwareValue]),
      ),
    );
  }

  // --- Light bar writes --------------------------------------------------------
  async writeLedState(on: boolean): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithResponseForService(
        LIGHTBAR_SERVICE_UUID,
        LED_STATE_CHARACTERISTIC_UUID,
        bytesToBase64([PROTOCOL_VERSION, on ? 1 : 0]),
      ),
    );
  }

  async writeLedColor(r: number, g: number, b: number): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithResponseForService(
        LIGHTBAR_SERVICE_UUID,
        LED_COLOR_CHARACTERISTIC_UUID,
        bytesToBase64([PROTOCOL_VERSION, r, g, b]),
      ),
    );
  }

  async writeLedDelay(perLedDelayMs: number): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithResponseForService(
        LIGHTBAR_SERVICE_UUID,
        LED_DELAY_CHARACTERISTIC_UUID,
        bytesToBase64([PROTOCOL_VERSION, perLedDelayMs]),
      ),
    );
  }

  async pingLedSync(): Promise<void> {
    const device = this.devices.lightBar;
    if (!device) return;
    await this.writeWithRetry(() =>
      device.writeCharacteristicWithoutResponseForService(
        LIGHTBAR_SERVICE_UUID,
        LED_SYNC_CHARACTERISTIC_UUID,
        byteToBase64(PROTOCOL_VERSION),
      ),
    );
  }

  destroy(): void {
    this.manager.destroy();
  }
}

export const bleService = new BleService();
