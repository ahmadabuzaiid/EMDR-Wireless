import { DeviceRole } from './constants';

export type PulsatorRole = 'pulsator1' | 'pulsator2';

export type DeviceStatus = 'scanning' | 'connecting' | 'connected' | 'not_found' | 'error';

// Thrown by scanAndConnect before it ever starts scanning, so the UI can show a
// specific message instead of every device silently sitting at "not found".
export class BluetoothUnavailableError extends Error {
  constructor(public reason: 'permissions_denied' | 'powered_off') {
    super(reason);
  }
}

export interface PulsatorState {
  motorState: 0 | 1;
  motorIntensity: number;
}

export interface LightBarState {
  lightState: 0 | 1;
  r: number;
  g: number;
  b: number;
  delay: number;
}

export type ParsedDeviceState = PulsatorState | LightBarState;

export interface ConnectCallbacks {
  onStatusChange: (role: DeviceRole, status: DeviceStatus) => void;
  // isInitialRead is true only for the one-time read right after connecting - use
  // it to seed UI sliders. Subsequent notifications (isInitialRead: false) fire
  // whenever the device's applied state changes, which is mostly just an echo of
  // our own writes - deliberately not meant to keep fighting a live user drag.
  onStateUpdate?: (role: DeviceRole, state: ParsedDeviceState, isInitialRead: boolean) => void;
  onBatteryUpdate?: (role: DeviceRole, percent: number) => void;
}

// Implemented by both the real (BleService.ts, react-native-ble-plx-backed) and
// mock (MockBleService.ts, in-memory simulated) backends - see ble/index.ts for
// which one a build actually uses. Keeping this as a real interface (not just
// structural duck-typing) means a signature change fails to compile on whichever
// implementation you forgot to update, instead of silently drifting apart.
export interface IBleService {
  scanAndConnect(roles: DeviceRole[], callbacks: ConnectCallbacks): Promise<void>;
  isConnected(role: DeviceRole): boolean;
  disconnectAll(): Promise<void>;
  writeMotorState(role: PulsatorRole, on: boolean): Promise<void>;
  writeMotorIntensity(role: PulsatorRole, firmwareValue: number): Promise<void>;
  writeLedState(on: boolean): Promise<void>;
  writeLedColor(r: number, g: number, b: number): Promise<void>;
  writeLedDelay(perLedDelayMs: number): Promise<void>;
  pingLedSync(): Promise<void>;
  destroy(): void;
}
