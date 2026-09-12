# EMDR Therapy Kits app

React Native (bare CLI) companion app for the Pulsators and Light Bar firmware in
this repo (`../Pulsators`, `../Light Bar`). Controls two wireless pulsators and one
light bar over Bluetooth Low Energy, gated by a one-time activation code.

## How it matches the firmware

- **BLE contract**: `src/ble/constants.ts` holds the exact service/characteristic
  UUIDs from `Pulsators/main/main.ino` and `Light Bar/main/main.ino`. If those UUIDs
  ever change in the firmware, update this file to match.
- **Device names**: the app scans for BLE devices advertising exactly `Pulsator 1`,
  `Pulsator 2`, `Light Bar`. Each `.ino` has a `DEVICE_NAME` constant near the top -
  the two Pulsator units run the identical sketch, so before flashing a given board,
  set `DEVICE_NAME` to `"Pulsator 1"` or `"Pulsator 2"` accordingly. Same GATT
  service/characteristic UUIDs on both is fine and expected - UUIDs identify the
  *shape* of the BLE profile, not the physical device; the app keeps separate
  connections per device regardless of them sharing UUIDs.
- **No MAC address is ever stored.** Every connect is a fresh scan, picking the
  strongest-RSSI match per name - so multiple kits in the same room/clinic don't
  collide, and nothing about a specific physical unit persists between sessions.
- **The app is the clock.** The Light Bar free-runs its own local sweep (see the
  firmware's periodic drift-correction notes); the pulsators have no local timer at
  all any more - `src/ble/StimulationEngine.ts` computes the Light Bar's crossing
  points from the same parameters it sent the device, and fires live on/off writes
  to the pulsators at each crossing. This is the same architecture the real EMDR Kit
  Wireless product uses (confirmed from its manual - see project notes).

## Slider ranges (user-facing vs. what's actually sent over BLE)

| Control | Shown to user | Sent to firmware |
|---|---|---|
| Pulsator Intensity | 1-160 | 40-200 (linear map, `rangeMapping.ts`) |
| Cycle Time (Light Bar enabled) | 0.19s-2.85s | per-LED delay 5-75ms, snapped to a multiple of 5 |
| Pulsator Delay (pulsators only) | 0.1s-1.5s | same value, snapped to a multiple of 5ms |

All of this lives in `src/utils/rangeMapping.ts` - screens never talk to firmware
ranges directly.

## OTP activation

TOTP (RFC 6238), SHA1, 30s period, 6 digits - standard, works with Bitwarden,
Google Authenticator, Proton, etc. The secret lives in `.env` (gitignored) and gets
baked into the app at build time via `react-native-config`.

**Known limit, by design, already discussed:** a secret embedded in the app bundle
is not truly secret - anyone who decompiles the APK can extract it and generate
valid codes. What's in place today only raises the bar against a casual look
(kept out of source control, not a literal string, release builds minified via
R8/ProGuard). **The only architecturally real fix is validating the OTP
server-side**, so the secret never ships in the app at all - worth doing if this
ever needs to be more than a "contact the provider" gate. Not built, since it pulls
in backend infrastructure this project doesn't otherwise need.

**Real bug this caused once, worth knowing about**: `react-native-config` reads
`.env` values off the generated `BuildConfig` class via *reflection*
(`RNCConfigModuleImpl.getConfig()`), not a static reference. R8 can't see a
reflective access, so with minification on it silently stripped/renamed
`BuildConfig`'s fields, and `Config.OTP_SECRET` came back `undefined` in JS on a
real device - while the value was still correctly present in the generated
`BuildConfig.java` at build time, making it look like a `.env`/build-time problem
when it was actually purely an R8 stripping problem. Fixed with a targeted keep
rule in `android/app/proguard-rules.pro`
(`-keep class com.emdrwirelessapp.BuildConfig { *; }`) rather than disabling
minification - if `Config.SOMETHING` ever silently comes back empty again on a
release build (debug builds skip R8 entirely, so this class of bug never shows up
there), check that keep rule survived and still matches the app's actual package
name before suspecting anything else.

To generate (or rotate) the secret:

```bash
node scripts/generate-otp-secret.js
```

This writes `.env` and prints the secret plus an `otpauth://` URI you can turn into
a QR code (or enter manually) to add it to your own authenticator app.

## Setup

### 1. Install dependencies

```bash
cd EmdrWirelessApp
npm install
```

### 2. Generate your OTP secret

```bash
node scripts/generate-otp-secret.js
```

(A random one was already generated for initial development - rotate it whenever
you want with the same command.)

### 3. Install Android build tooling (one-time, not done by this session)

This machine has Node 22 and a JDK, but **no Android SDK** - `react-native run-android`
needs it. Easiest path:

1. Install [Android Studio](https://developer.android.com/studio).
2. On first launch, let its Setup Wizard install the Android SDK, platform tools,
   and an emulator image (or skip the emulator - see step 4).
3. Set `ANDROID_HOME` (add to your shell profile, e.g. `~/.bashrc`):
   ```bash
   export ANDROID_HOME=$HOME/Android/Sdk
   export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator
   ```
4. **Use a real Android phone over USB, not an emulator** - BLE generally doesn't
   work in the Android emulator. On the phone: enable Developer Options (tap Build
   Number 7 times in Settings > About Phone), then enable USB Debugging. Plug it in
   and accept the "allow USB debugging" prompt. Verify with:
   ```bash
   adb devices
   ```

### 4. Run it

```bash
npx react-native run-android
```

This builds the debug APK and installs it on whatever device `adb devices` sees.
For subsequent runs, `npx react-native start` (Metro) then `run-android` again, or
just `run-android` (it starts Metro for you if it isn't running).

## Things I couldn't verify without a working Android environment here

- **The color wheel** (`react-native-wheel-color-picker`) is wired up with its
  commonly-documented props, but I couldn't render or click it. Check it works as
  expected once you can run the app - the prop set may need adjusting.
- **Gradle/JDK**: the project's bundled Gradle wrapper (9.4.1) should handle the
  installed JDK fine, but if the first Android build fails on a JDK-related error,
  that's the first place to look.
- **BLE permission prompts and the scan/connect flow** are implemented per the
  Android 12+ and pre-12 permission models, but real hardware is the only way to
  confirm the timing/UX holds up - in particular the 6-second scan window
  (`SCAN_WINDOW_MS` in `src/ble/constants.ts`) is a starting guess, not tuned.

## Project structure

```
src/
  auth/          OTP activation gate (AsyncStorage flag + TOTP verification)
  ble/           BLE constants, connection/scanning, and the live stimulation engine
  context/       SessionContext - shared app state (toggles, connection, session config)
  navigation/    Screen stack
  screens/       Welcome, Otp, DeviceSelect, Control
  theme/         Shared color palette
  utils/         base32/base64/TOTP/range-mapping/color helpers
```
