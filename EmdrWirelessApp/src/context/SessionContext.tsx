import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { bleService, DeviceStatus, BluetoothUnavailableError } from '../ble/BleService';
import { stimulationEngine } from '../ble/StimulationEngine';
import { DeviceRole } from '../ble/constants';
import {
  intensityUserToFirmware,
  INTENSITY_USER_MIN,
  INTENSITY_USER_MAX,
  CYCLE_MS_MIN,
  CYCLE_MS_MAX,
  snapPulsatorDelayMs,
} from '../utils/rangeMapping';

export type RGBColor = { r: number; g: number; b: number };

interface SessionState {
  pulsatorsEnabled: boolean;
  lightBarEnabled: boolean;
  statuses: Partial<Record<DeviceRole, DeviceStatus>>;
  intensityUser: number; // 1-16, see rangeMapping
  cycleMs: number; // full round-trip sweep time, used when lightBarEnabled
  pulsatorOnlyDelayMs: number; // used when pulsators run without the light bar
  color: RGBColor;
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
  setCycleMs: (value: number) => void;
  setPulsatorOnlyDelayMs: (value: number) => void;
  setColor: (color: RGBColor) => void;
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
  const [intensityUser, setIntensityUserState] = useState(
    Math.round((INTENSITY_USER_MIN + INTENSITY_USER_MAX) / 2),
  );
  const [cycleMs, setCycleMsState] = useState(Math.round((CYCLE_MS_MIN + CYCLE_MS_MAX) / 2 / 190) * 190);
  const [pulsatorOnlyDelayMs, setPulsatorOnlyDelayMsState] = useState(500);
  const [color, setColorState] = useState<RGBColor>(DEFAULT_COLOR);
  const [running, setRunning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [bleError, setBleError] = useState<'permissions_denied' | 'powered_off' | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const clearLastError = useCallback(() => setLastError(null), []);

  // Turns a batch of per-operation failure strings (from StimulationEngine) into
  // one banner message, or clears the banner when nothing failed.
  const reportEngineErrors = useCallback((errors: string[]) => {
    setLastError(errors.length > 0 ? errors.join('; ') : null);
  }, []);

  const togglePulsators = useCallback(() => setPulsatorsEnabled(v => !v), []);
  const toggleLightBar = useCallback(() => setLightBarEnabled(v => !v), []);

  const connect = useCallback(async () => {
    const roles: DeviceRole[] = [];
    if (pulsatorsEnabled) roles.push('pulsator1', 'pulsator2');
    if (lightBarEnabled) roles.push('lightBar');
    if (roles.length === 0) return;

    setConnecting(true);
    setStatuses({});
    setBleError(null);
    setLastError(null);
    try {
      await bleService.scanAndConnect(roles, (role, status) => {
        setStatuses(prev => ({ ...prev, [role]: status }));
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
  }, [pulsatorsEnabled, lightBarEnabled]);

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
    setRunning(false);
    reportEngineErrors(errors);
  }, [reportEngineErrors]);

  const buildConfig = useCallback(
    () => ({
      pulsatorsEnabled,
      lightBarEnabled,
      cycleMs,
      pulsatorOnlyDelayMs,
      color,
    }),
    [pulsatorsEnabled, lightBarEnabled, cycleMs, pulsatorOnlyDelayMs, color],
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

  const setCycleMs = useCallback(
    (value: number) => {
      setCycleMsState(value);
      if (running) {
        stimulationEngine.updateTiming({ ...buildConfig(), cycleMs: value }).then(reportEngineErrors);
      }
    },
    [running, buildConfig, reportEngineErrors],
  );

  const setPulsatorOnlyDelayMs = useCallback(
    (value: number) => {
      const snapped = snapPulsatorDelayMs(value);
      setPulsatorOnlyDelayMsState(snapped);
      if (running) {
        stimulationEngine
          .updateTiming({ ...buildConfig(), pulsatorOnlyDelayMs: snapped })
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
    intensityUser,
    cycleMs,
    pulsatorOnlyDelayMs,
    color,
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
    setCycleMs,
    setPulsatorOnlyDelayMs,
    setColor,
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
