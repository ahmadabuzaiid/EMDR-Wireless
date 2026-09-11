import { PermissionsAndroid, Platform } from 'react-native';

// Android 12+ (API 31+) needs BLUETOOTH_SCAN/BLUETOOTH_CONNECT; Android 6-11
// needs ACCESS_FINE_LOCATION for BLE scanning. Requesting all three is safe on
// every version - Android no-ops permissions a given API level doesn't define.
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  const granted = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);

  return Object.values(granted).every(
    result => result === PermissionsAndroid.RESULTS.GRANTED,
  );
}
