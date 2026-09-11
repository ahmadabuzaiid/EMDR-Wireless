import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Config from 'react-native-config';
import { verifyTotp } from '../utils/totp';

// Deliberately AsyncStorage, not Keychain/SecureStore: AsyncStorage is reliably
// cleared on uninstall on both platforms, which is what "re-prompt after
// uninstall/reinstall" requires - iOS Keychain items can survive a reinstall.
const STORAGE_KEY = 'emdr.activated';

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
    const secret = Config.OTP_SECRET;
    if (!secret) {
      console.warn('OTP_SECRET is not set - check EmdrWirelessApp/.env');
      return false;
    }
    const ok = verifyTotp(code, secret);
    if (ok) {
      await AsyncStorage.setItem(STORAGE_KEY, 'true');
      setActivated(true);
    }
    return ok;
  }, []);

  return { checking, activated, verify };
}
