import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  bleService,
  DeviceStatus,
  BluetoothUnavailableError,
  ParsedDeviceState,
} from '../ble/index';
import { stimulationEngine } from '../ble/StimulationEngine';
import { DeviceRole } from '../ble/constants';
import {
  intensityUserToFirmware,
  intensityFirmwareToUser,
  fullDelayUserToMs,
  fullDelayMsToUser,
  motorDelayUserToMs,
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  FULL_DELAY_USER_MIN,
  FULL_DELAY_USER_MAX,
  MOTOR_DELAY_USER_MIN,
  MOTOR_DELAY_USER_MAX,
  DEFAULT_LED_COUNT,
  LED_COUNT_MIN,
  LED_COUNT_MAX,
} from '../utils/rangeMapping';

export type RGBColor = { r: number; g: number; b: number };

const LED_COUNT_STORAGE_KEY = 'emdr.settings.ledCount';

interface SessionState {
  pulsatorsEnabled: boolean;
  lightBarEnabled: boolean;
  statuses: Partial<Record<DeviceRole, DeviceStatus>>;
  batteryLevels: Partial<Record<DeviceRole, number>>;
  intensityUser: number; // 1-16, see rangeMapping
  fullDelayUser: number; // 1-17 user level, used when lightBarEnabled - see rangeMapping
  motorDelayUser: number; // 1-14 user level, used when pulsators run without the light bar
  color: RGBColor;
  ledCount: number; // app-side setting (Settings screen), persisted
  running: boolean;
  connecting: boolean;
  bleError: 'permissions_denied' | 'powered_off' | null;
  lastError: string | null;
}

interface SessionContextValue extends SessionState {
  togglePulsators: () => void;
  toggleLightBar: () => void;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  toggleRunning: () => Promise<void>;
  setIntensityUser: (value: number) => void;
  setFullDelayUser: (value: number) => void;
  setMotorDelayUser: (value: number) => void;
  setColor: (color: RGBColor) => void;
  setLedCount: (value: number) => void;
  clearLastError: () => void;
  allConnected: boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

const DEFAULT_COLOR: RGBColor = { r: 66, g: 165, b: 173 };

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [pulsatorsEnabled, setPulsatorsEnabled] = useState(true);
  const [lightBarEnabled, setLightBarEnabled] = useState(true);
  const [statuses, setStatuses] = useState<Partial<Record<DeviceRole, DeviceStatus>>>({});
  const [batteryLevels, setBatteryLevels] = useState<Partial<Record<DeviceRole, number>>>({});
  const [intensityUser, setIntensityUserState] = useState(
    Math.round((INTENSITY_USER_MIN + INTENSITY_USER_MAX) / 2),
  );
  const [ledCount, setLedCountState] = useState(DEFAULT_LED_COUNT);
  const [fullDelayUser, setFullDelayUserState] = useState(
    Math.round((FULL_DELAY_USER_MIN + FULL_DELAY_USER_MAX) / 2),
  );
  const [motorDelayUser, setMotorDelayUserState] = useState(
    Math.round((MOTOR_DELAY_USER_MIN + MOTOR_DELAY_USER_MAX) / 2),
  );
  const [color, setColorState] = useState<RGBColor>(DEFAULT_COLOR);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [bleError, setBleError] = useState<'permissions_denied' | 'powered_off' | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LED_COUNT_STORAGE_KEY).then(value => {
      const parsed = value ? parseInt(value, 10) : NaN;
      if (!Number.isNaN(parsed)) setLedCountState(parsed);
    });
  }, []);

  const setLedCount = useCallback((value: number) => {
    const clamped = Math.round(Math.min(LED_COUNT_MAX, Math.max(LED_COUNT_MIN, value)));
    setLedCountState(clamped);
    AsyncStorage.setItem(LED_COUNT_STORAGE_KEY, String(clamped)).catch(() => {});
  }, []);

  const clearLastError = useCallback(() => setLastError(null), []);

  // Turns a batch of per-operation failure strings (from StimulationEngine) into
  // one banner message, or clears the banner when nothing failed.
  const reportEngineErrors = useCallback((errors: string[]) => {
    setLastError(errors.length > 0 ? errors.join('; ') : null);
  }, []);

  const togglePulsators = useCallback(() => setPulsatorsEnabled(v => !v), []);
  const toggleLightBar = useCallback(() => setLightBarEnabled(v => !v), []);

  // Only the one-time initial read (right after connecting) seeds the sliders -
  // see BleService's ConnectCallbacks doc comment for why notifications afterward
  // don't keep re-seeding (they're mostly just echoes of our own writes, and
  // re-applying them live would fight the user's own slider drags).
  const onStateUpdate = useCallback(
    (role: DeviceRole, state: ParsedDeviceState, isInitialRead: boolean) => {
      if (!isInitialRead) return;
      if (role === 'lightBar' && 'lightState' in state) {
        setFullDelayUserState(fullDelayMsToUser(state.delay));
        setColorState({ r: state.r, g: state.g, b: state.b });
      } else if (role === 'pulsator1' && 'motorState' in state) {
        setIntensityUserState(intensityFirmwareToUser(state.motorIntensity));
      }
    },
    [],
  );

  const onBatteryUpdate = useCallback((role: DeviceRole, percent: number) => {
    setBatteryLevels(prev => ({ ...prev, [role]: percent }));
  }, []);

  const connect = useCallback(async () => {
    const roles: DeviceRole[] = [];
    if (pulsatorsEnabled) roles.push('pulsator1', 'pulsator2');
    if (lightBarEnabled) roles.push('lightBar');
    if (roles.length === 0) return;

    setConnecting(true);
    setStatuses({});
    setBatteryLevels({});
    setBleError(null);
    setLastError(null);
    try {
      await bleService.scanAndConnect(roles, {
        onStatusChange: (role, status) => setStatuses(prev => ({ ...prev, [role]: status })),
        onStateUpdate,
        onBatteryUpdate,
      });
    } catch (err) {
      if (err instanceof BluetoothUnavailableError) {
        setBleError(err.reason);
      } else {
        setLastError(`Connecting failed: ${describeError(err)}`);
      }
    } finally {
      setConnecting(false);
    }
  }, [pulsatorsEnabled, lightBarEnabled, onStateUpdate, onBatteryUpdate]);

  // Best-effort cleanup: always finishes (clears running state, clears connections)
  // even if a BLE write along the way fails, so the caller can always navigate away.
  const disconnect = useCallback(async () => {
    const errors = await stimulationEngine.stop();
    try {
      await bleService.disconnectAll();
    } catch (err) {
      errors.push(`disconnect: ${describeError(err)}`);
    }
    setStatuses({});
    setBatteryLevels({});
    setRunning(false);
    reportEngineErrors(errors);
  }, [reportEngineErrors]);

  const buildConfig = useCallback(
    () => ({
      pulsatorsEnabled,
      lightBarEnabled,
      fullDelayMs: fullDelayUserToMs(fullDelayUser),
      pulsatorOnlyDelayMs: motorDelayUserToMs(motorDelayUser),
      color,
      ledCount,
    }),
    [pulsatorsEnabled, lightBarEnabled, fullDelayUser, motorDelayUser, color, ledCount],
  );

  // Always flips `running` and reports whatever failed - never gets stuck showing
  // "Start Session" just because one BLE write along the way had a problem.
  const toggleRunning = useCallback(async () => {
    if (running) {
      const errors = await stimulationEngine.stop();
      setRunning(false);
      reportEngineErrors(errors);
    } else {
      const startErrors = await stimulationEngine.start(buildConfig());
      const intensityErrors = await stimulationEngine.setIntensity(intensityUserToFirmware(intensityUser));
      setRunning(true);
      reportEngineErrors([...startErrors, ...intensityErrors]);
    }
  }, [running, buildConfig, intensityUser, reportEngineErrors]);

  const setIntensityUser = useCallback(
    (value: number) => {
      setIntensityUserState(value);
      if (running) {
        stimulationEngine.setIntensity(intensityUserToFirmware(value)).then(reportEngineErrors);
      }
    },
    [running, reportEngineErrors],
  );

  const setFullDelayUser = useCallback(
    (value: number) => {
      setFullDelayUserState(value);
      if (running) {
        stimulationEngine
          .updateTiming({ ...buildConfig(), fullDelayMs: fullDelayUserToMs(value) })
          .then(reportEngineErrors);
      }
    },
    [running, buildConfig, reportEngineErrors],
  );

  const setMotorDelayUser = useCallback(
    (value: number) => {
      setMotorDelayUserState(value);
      if (running) {
        stimulationEngine
          .updateTiming({ ...buildConfig(), pulsatorOnlyDelayMs: motorDelayUserToMs(value) })
          .then(reportEngineErrors);
      }
    },
    [running, buildConfig, reportEngineErrors],
  );

  const setColor = useCallback(
    (next: RGBColor) => {
      setColorState(next);
      if (running) {
        stimulationEngine.setColor(next.r, next.g, next.b).then(reportEngineErrors);
      }
    },
    [running, reportEngineErrors],
  );

  const allConnected = useMemo(() => {
    const roles: DeviceRole[] = [];
    if (pulsatorsEnabled) roles.push('pulsator1', 'pulsator2');
    if (lightBarEnabled) roles.push('lightBar');
    return roles.length > 0 && roles.every(role => statuses[role] === 'connected');
  }, [pulsatorsEnabled, lightBarEnabled, statuses]);

  const value: SessionContextValue = {
    pulsatorsEnabled,
    lightBarEnabled,
    statuses,
    batteryLevels,
    intensityUser,
    fullDelayUser,
    motorDelayUser,
    color,
    ledCount,
    running,
    connecting,
    bleError,
    lastError,
    togglePulsators,
    toggleLightBar,
    connect,
    disconnect,
    toggleRunning,
    setIntensityUser,
    setFullDelayUser,
    setMotorDelayUser,
    setColor,
    setLedCount,
    clearLastError,
    allConnected,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
