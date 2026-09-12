import Config from 'react-native-config';
import { bleService as realBleService } from './BleService';
import { mockBleService } from './MockBleService';
import { IBleService } from './types';

// Set USE_MOCK_BLE=true in .env to develop/test the whole app - screens, sync
// engine, everything - against simulated Pulsators/Light Bar, no ESP32 required.
// Everything above this module (StimulationEngine, SessionContext, screens)
// imports `bleService` from here, never directly from BleService/MockBleService,
// so swapping backends never needs a second code change anywhere else.
export const bleService: IBleService = Config.USE_MOCK_BLE === 'true' ? mockBleService : realBleService;

export { BluetoothUnavailableError } from './types';
export type { DeviceStatus, ParsedDeviceState, ConnectCallbacks } from './types';
