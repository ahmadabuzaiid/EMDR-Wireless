import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { verifyTotp } from '../utils/totp';

// Deliberately AsyncStorage, not Keychain/SecureStore: AsyncStorage is reliably
// cleared on uninstall on both platforms, which is what "re-prompt after
// uninstall/reinstall" requires - iOS Keychain items can survive a reinstall.
const STORAGE_KEY = 'emdr.activated';

function checkCode(code: string): boolean {
  const secret = Config.OTP_SECRET;
  if (!secret) {
    console.warn('OTP_SECRET is not set - check EmdrWirelessApp/.env');
    return false;
  }
  return verifyTotp(code, secret);
}

export function useActivation() {
  const [checking, setChecking] = useState(true);
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(value => {
      setActivated(value === 'true');
      setChecking(false);
    });
  }, []);

  const verify = useCallback(async (code: string): Promise<boolean> => {
    const ok = checkCode(code);
    if (ok) {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
      setActivated(true);
    }
    return ok;
  }, []);

  // Revokes this device's activation - only if `code` is a currently valid admin
  // code, so revoking isn't just "tap a button", it needs the same proof of
  // authority activating did. Lets the therapist reset a device from within the
  // app instead of the only other option (uninstall/reinstall).
  const deactivate = useCallback(async (code: string): Promise<boolean> => {
    const ok = checkCode(code);
    if (ok) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      setActivated(false);
    }
    return ok;
  }, []);

  return { checking, activated, verify, deactivate };
}
