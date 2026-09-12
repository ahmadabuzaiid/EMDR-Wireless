import { DeviceRole } from './constants';
import {
  PulsatorRole,
  ConnectCallbacks,
  IBleService,
  PulsatorState,
  LightBarState,
} from './types';

// In-memory simulated Pulsators + Light Bar, for developing/testing the whole app
// without any ESP32 hardware attached. Selected instead of the real BleService by
// ble/index.ts when USE_MOCK_BLE=true in .env - see that file and the root README.
// Deliberately implements the exact same IBleService contract as the real one, so
// nothing above this layer (StimulationEngine, SessionContext, every screen) can
// tell the difference.

const SIMULATED_SCAN_MS = 800;
const SIMULATED_CONNECT_MS = 500;
const SIMULATED_WRITE_MS = 80;
const SIMULATED_BATTERY_PERCENT: Partial<Record<DeviceRole, number>> = {
  pulsator1: 87,
  pulsator2: 81,
  lightBar: 93,
};

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function defaultPulsatorState(): PulsatorState {
  return { motorState: 0, motorIntensity: 150 };
}

function defaultLightBarState(): LightBarState {
  return { lightState: 0, r: 0, g: 0, b: 0, delay: 20 };
}

class MockBleService implements IBleService {
  private connected = new Set<DeviceRole>();
  private pulsatorStates: Record<PulsatorRole, PulsatorState> = {
    pulsator1: defaultPulsatorState(),
    pulsator2: defaultPulsatorState(),
  };
  private lightBarState: LightBarState = defaultLightBarState();
  private callbacks: ConnectCallbacks | null = null;

  async scanAndConnect(roles: DeviceRole[], callbacks: ConnectCallbacks): Promise<void> {
    this.callbacks = callbacks;
    roles.forEach(role => callbacks.onStatusChange(role, 'scanning'));
    await delay(SIMULATED_SCAN_MS);

    for (const role of roles) {
      callbacks.onStatusChange(role, 'connecting');
      await delay(SIMULATED_CONNECT_MS);
      this.connected.add(role);
      callbacks.onStatusChange(role, 'connected');

      const state = role === 'lightBar' ? this.lightBarState : this.pulsatorStates[role as PulsatorRole];
      callbacks.onStateUpdate?.(role, state, true);
      const battery = SIMULATED_BATTERY_PERCENT[role];
      if (battery !== undefined) callbacks.onBatteryUpdate?.(role, battery);
    }
  }

  isConnected(role: DeviceRole): boolean {
    return this.connected.has(role);
  }

  async disconnectAll(): Promise<void> {
    this.connected.clear();
    this.pulsatorStates = { pulsator1: defaultPulsatorState(), pulsator2: defaultPulsatorState() };
    this.lightBarState = defaultLightBarState();
  }

  private notifyState(role: DeviceRole): void {
    const state = role === 'lightBar' ? this.lightBarState : this.pulsatorStates[role as PulsatorRole];
    this.callbacks?.onStateUpdate?.(role, state, false);
  }

  async writeMotorState(role: PulsatorRole, on: boolean): Promise<void> {
    if (!this.connected.has(role)) return;
    await delay(SIMULATED_WRITE_MS);
    this.pulsatorStates[role] = { ...this.pulsatorStates[role], motorState: on ? 1 : 0 };
    this.notifyState(role);
  }

  async writeMotorIntensity(role: PulsatorRole, firmwareValue: number): Promise<void> {
    if (!this.connected.has(role)) return;
    await delay(SIMULATED_WRITE_MS);
    this.pulsatorStates[role] = { ...this.pulsatorStates[role], motorIntensity: firmwareValue };
    this.notifyState(role);
  }

  async writeLedState(on: boolean): Promise<void> {
    if (!this.connected.has('lightBar')) return;
    await delay(SIMULATED_WRITE_MS);
    this.lightBarState = { ...this.lightBarState, lightState: on ? 1 : 0 };
    this.notifyState('lightBar');
  }

  async writeLedColor(r: number, g: number, b: number): Promise<void> {
    if (!this.connected.has('lightBar')) return;
    await delay(SIMULATED_WRITE_MS);
    this.lightBarState = { ...this.lightBarState, r, g, b };
    this.notifyState('lightBar');
  }

  async writeLedDelay(perLedDelayMs: number): Promise<void> {
    if (!this.connected.has('lightBar')) return;
    await delay(SIMULATED_WRITE_MS);
    this.lightBarState = { ...this.lightBarState, delay: perLedDelayMs };
    this.notifyState('lightBar');
  }

  async pingLedSync(): Promise<void> {
    if (!this.connected.has('lightBar')) return;
    await delay(SIMULATED_WRITE_MS);
    // Nothing to correct in the mock - there's no real drifting local timer to nudge.
  }

  destroy(): void {
    this.connected.clear();
  }
}

export const mockBleService = new MockBleService();
