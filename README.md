# EMDR Wireless

A wireless EMDR (Eye Movement Desensitization and Reprocessing) bilateral
stimulation kit: two tactile pulsators and one visual light bar, each an
independent ESP32-C3 BLE peripheral, controlled from a single React Native
mobile app. Built for trained EMDR therapists running clinical sessions.

This document is the map of the project - what each piece is, how they talk
to each other, and *why* the design looks the way it does. The individual
`.ino` files and the app's own `EmdrWirelessApp/README.md` have the
implementation detail; this file has the context you'd otherwise have to
reconstruct from git history.

## Repo layout

```
Pulsators/main/main.ino          Firmware for the 2 tactile pulsators
Light Bar/main/main.ino          Firmware for the visual light bar (LED strip)
Pulsators Test Rig/main/main.ino Protocol-identical test firmware - built-in
                                  LED stands in for the motor (see below)
Light Bar Test Rig/main/main.ino Protocol-identical test firmware - built-in
                                  LED only, no strip needed (see below)
EmdrWirelessApp/                 React Native (bare CLI) companion app
```

All three firmware targets run on an **ESP32-C3 SuperMini** board.

## Hardware

| Component | Role | Key pins |
|---|---|---|
| Pulsators (×2) | Vibration motor, PWM-driven | `MOTOR_PIN` = GPIO20 |
| Light Bar | 20-LED WS2811 strip | `LED_PIN` = GPIO20 |
| Pulsators Test Rig | Same protocol, drives the chip's own built-in LED instead of a motor | GPIO8 - a **plain PWM-driven LED**, same board as the Light Bar Test Rig below |
| Light Bar Test Rig | Same protocol, drives the chip's own built-in LED instead of a strip | GPIO8 - a **plain PWM-driven LED**, confirmed by testing (not addressable WS2812, despite some SuperMini variants having one - see note below) |

The two pulsators run **the exact same sketch** - they're told apart only by
the `DEVICE_NAME` constant near the top of `Pulsators/main/main.ino`. Before
flashing a given board, set it to `"Pulsator 1"` or `"Pulsator 2"`. Same for
`Pulsators Test Rig/main/main.ino`.

The Light Bar firmware is configured for a WS2811 strip. Its BLE protocol
remains logical RGB (`[version, R, G, B]`); `LED_COLOR_ORDER` maps those values
to the strip wiring. WS2811 does not guarantee one channel order, so verify
with solid red, green, and blue test colors and switch that macro between `RGB`
and `GRB` if the colors are swapped.

The **Test Rigs** exist because real hardware (the strip, the vibration
motors) isn't always available to test with. Both advertise under the same
name and expose the identical BLE service/characteristics as their real
counterpart, so the app needs zero changes to talk to either - only the
physical output differs:

- **Pulsators Test Rig**: the built-in LED stands in for the motor directly -
  on/off mirrors `MOTOR_STATE` live (so it's lit for exactly the alternation
  period and off for the same period, alternating with the other pulsator,
  matching whatever the app is currently driving), and brightness mirrors
  `MOTOR_INTENSITY` (dim at low intensity, bright at high).
- **Light Bar Test Rig**: a single LED can't render a sweep across a strip,
  so instead it runs the real Light Bar's exact sweep-timing engine
  internally (position, direction, the 2x end-LED dwell, `LED_SYNC`
  phase-nudging - see `Light Bar/main/main.ino`) and lights the LED for one
  direction of that simulated sweep, off for the other. Flashing this
  alongside both Pulsators Test Rigs lets you visually confirm the three
  devices are actually staying in sync: the Light Bar Test Rig's LED and one
  pulsator's LED should turn on together, then both off together as the
  other pulsator's LED turns on - since all three derive their timing from
  the same `fullDelayMs * ledCount` formula (see "Sync model" below).
  `LED_COLOR` writes are still received and echoed back on
  `DEVICE_STATE_CHARACTERISTIC`, but have no visible effect on this board.

**Built-in LED gotcha**: some ESP32-C3 SuperMini board variants have an
addressable WS2812 pixel on GPIO8 (which is what the test rig originally
assumed, and what its own header comment used to claim); this specific board
turned out to have a **plain single-color LED** on GPIO8 instead, wired
active-low. Both test rigs drive it with plain PWM (`analogWrite`-style, no
FastLED) - since a plain LED can't display color, it's used instead for
on/off timing signals (see above), not as a color preview. If you're
bringing up a new board and nothing reacts to a FastLED-based test, don't
assume the wiring is broken - confirm with a trivial `digitalWrite` blink
test first (toggle the
pin HIGH/LOW with a delay) before suspecting anything else; that's what
resolved it here.

## BLE protocol contract

This is the shared "API" between the firmware and the app - if you change a
UUID, a byte layout, or a validated range on one side, update the other
(`EmdrWirelessApp/src/ble/constants.ts` and `.../src/utils/rangeMapping.ts`
mirror everything below).

**Every write's first byte is `PROTOCOL_VERSION` (currently `1`).** Firmware
rejects (logs and ignores) any write whose first byte doesn't match, rather
than risk misinterpreting a differently-shaped packet from a mismatched app/
firmware pair as valid data. Bump this, on both sides together, whenever a
byte layout below changes.

**Pulsators** - service `4fafc201-1fb5-459e-8fcc-c5c9c331914b`

| Characteristic | UUID | Bytes | Payload | Notes |
|---|---|---|---|---|
| Motor state | `668b943b-2cac-4de0-8091-332dedc91739` | 2 | `[version, state 0/1]` | Write-without-response. Applies instantly. |
| Motor intensity | `9f1dc367-ee23-4254-a52a-e41b59f50502` | 2 | `[version, intensity 40-200]` | Write-without-response. Raw PWM value. Applies instantly, even mid-buzz. |
| Device state | see `constants.ts` | 3 | `[version, motor_state, motor_intensity]` | **Read + Notify.** Mirrors what's actually applied - the app reads this once on connect to resync its sliders, so a reconnect never shows stale values. |

**Light Bar** - service `1fb5c201-4faf-459e-8fcc-c5c9c331914b`

| Characteristic | UUID | Bytes | Payload | Notes |
|---|---|---|---|---|
| LED state | `2cac943b-668b-4de0-8091-332dedc91739` | 2 | `[version, state 0/1]` | Write-without-response. Turning off applies instantly even mid-sweep. |
| LED color | `526f1035-4262-4175-8ad0-16387b946fce` | 4 | `[version, R, G, B]` | Write-without-response. Raw bytes, not a string. |
| LED delay | `ee231dc3-9f67-4254-a52a-e41b59f50502` | 2 | `[version, delay 20-100, multiple of 5]` | Write-without-response. Per-LED step delay (ms), a.k.a. "Full Delay" app-side - sent directly, no conversion, see below. |
| LED sync | `822ff8ad-58e1-44f8-8cb5-f4048a0ee3c3` | 1 | `[version]` | Write-without-response trigger, see "Sync model" below. |
| Device state | see `constants.ts` | 6 | `[version, light_state, r, g, b, delay]` | **Read + Notify.** Same resync purpose as the Pulsators' one. |

**Battery Service** (both device types) - standard Bluetooth SIG service, not
a custom one: service `0000180f-0000-1000-8000-00805f9b34fb`, characteristic
`00002a19-0000-1000-8000-00805f9b34fb` (Battery Level), 1 byte, `0`-`100`,
Read + Notify. **No real battery-sensing hardware is confirmed wired yet** -
the GATT plumbing and app-side read/display are complete, but firmware's
`readBatteryPercent()` is a placeholder pending an actual voltage-divider
circuit (see the comment next to it in each `.ino`). The app already
degrades gracefully if a device never answers on this service.

**Device names** the app scans for (exact match on advertised local name,
picking strongest RSSI if duplicates are seen - handles multiple kits in one
room): `"Pulsator 1"`, `"Pulsator 2"`, `"Light Bar"`.

**Auto-reconnect**: the app now retries an unexpected disconnect every 2s,
indefinitely, as long as that device is still toggled on in Device Select -
firmware must keep advertising after a drop for this to find it again (both
sketches already do). A deliberate Disconnect from the Control screen does
not trigger this. **Write retry**: a failed characteristic write is retried
up to 3 times, 1s apart, before the app gives up and surfaces an error.

**Design choice**: the app never persists a MAC address across sessions.
Every connect is a fresh scan; this is deliberate so the same app works
against whichever specific kit is nearest, without pairing state to manage.

**Latency**: every control write (state, color, delay, intensity, motor state)
is write-without-response, and independent devices are written to concurrently
rather than one after another - e.g. `StimulationEngine.start()` fires the
Light Bar's setup writes and the pulsators' first alternation at the same time
via `Promise.all`, instead of waiting for the Light Bar to finish first (see
`EmdrWirelessApp/src/ble/StimulationEngine.ts`). Firmware also does no `Serial`
I/O in any live-session code path any more - it was measurably adding to the
on-screen delay between devices (each `Serial.print` blocks briefly, and it's
called from inside the same BLE callback that applies the value), so all
`Serial.begin`/`Serial.print` calls were removed from all four sketches. This
means **none of the four boards produce Serial Monitor output any more** -
if you need to debug firmware again, temporarily add prints back rather than
assuming something is broken because the monitor is silent.

## Sync model - "the app is the clock"

This is the most important architectural decision in the project and isn't
obvious from reading either side of the code in isolation.

**Where this came from**: the real commercial EMDR Kit Wireless (SE Factory
B.V., FCC IDs 2BOUW80045/2BOUW90900) uses its Light Tube as the timing
reference, with Pulsators and Headphone optionally "in sync" with it
(confirmed from its user manual - the "Pulsators in sync" / "Headphone in
sync" toggles, on by default). We adopted the same shape:

- **The Light Bar free-runs its own local sweep animation** off its own
  `millis()`, using whatever `light_delay` (per-LED ms, "Full Delay" in the
  app) it was last told. This is the one thing the patient directly watches,
  so it needs to be smooth and self-contained - no dependency on live BLE
  traffic per frame. The two end LEDs (where the sweep reverses direction)
  deliberately dwell for **2x** `light_delay` instead of 1x (`dwellMsFor()`
  in `Light Bar/main/main.ino`) - see the next bullet for why.
- **The pulsators have no local timer at all.** Every on/off transition is a
  live, immediate BLE write from the app (`EmdrWirelessApp/src/ble/StimulationEngine.ts`).
  With the Light Bar enabled, each pulsator switches exactly when the sweep
  reaches an end and reverses - i.e. one pulsator is on for a full one-way
  pass, then the other for the return pass. The app computes that pass
  duration as `fullDelayMs * ledCount`, which only lines up with the Light
  Bar's real timing *because* of the end-LED dwell-doubling above: a one-way
  pass without it would take `fullDelayMs * (LED_COUNT - 1)`, not
  `* LED_COUNT`, and the two would slowly drift apart over a session.
- **Why not let pulsators free-run too?** Two independent ESP32 boards
  free-running off their own crystals will always drift apart from each
  other over a session (tens of ms per minute) with no way to correct it
  without either a shared hardware clock or live triggering. Live-triggering
  the pulsators from the app sidesteps the drift problem entirely, at the
  cost of depending on BLE write latency for every single pulse - acceptable
  at the ~1-3 Hz pulse rates this project uses.
- **The Light Bar can still drift from the app's *model* of it**, since it's
  the one thing still running its own local clock. The `LED sync`
  characteristic exists to correct this: the app pings it periodically
  (`StimulationEngine.ts`, every 20s while running), and the firmware nudges
  its phase toward "a step boundary is happening now" by a *capped* amount
  (`SYNC_MAX_CORRECTION_PERCENT` = 20%, `Light Bar/main/main.ino`) rather
  than snapping - so a correction is never large enough for the patient to
  perceive a skipped or stretched step.
- **Pulsators-only sessions** (Light Bar disabled) work the same way, just
  without a Light Bar to derive timing from - the app runs its own interval
  timer directly, alternating the two pulsators on "Motor Delay"
  (`MOTOR_DELAY_FIRMWARE_MIN`/`MAX` in `rangeMapping.ts`, 200-1500ms,
  app-side only, carried over from the original wired-kit design).

**What this means for firmware changes**: if you're tempted to add a local
timer back to the pulsators, first re-read this section - it was deliberately
removed (see git history: "remove the local free-running loop, motor_id
phase logic" on the Pulsators sketch) specifically to solve cross-device
drift, and reintroducing it would reintroduce the original problem.

## User-facing ranges vs. firmware ranges

The app never exposes firmware's raw ranges directly - `EmdrWirelessApp/src/utils/rangeMapping.ts`
is the single source of truth for both directions, and screens never talk to
firmware units directly.

Every slider is a `StepSlider` (`EmdrWirelessApp/src/components/StepSlider.tsx`) -
a discrete "digital" control that only ever rests on a fixed dot, shown to the
user as a plain level number rather than a raw unit value (same treatment
Pulsator Intensity already had).

| Control | Shown to user | Sent to firmware |
|---|---|---|
| Pulsator intensity | 1-16 (step 1) | 40-200, linear map |
| Full delay (Light Bar enabled) | 1-17 (step 1) | per-LED delay 20-100ms (step 5ms) - sent directly |
| Motor delay (pulsators only) | 1-14 (step 1) | 200-1500ms (step 100ms), app-side only |

## Mobile app (`EmdrWirelessApp/`)

Bare React Native CLI (not Expo - BLE needs native modules Expo Go doesn't
provide, and Expo's dev-client would need the same native build step anyway
with none of the upside). React Native 0.87.1, Node 22+, TypeScript.

```
src/
  auth/          OTP activation gate - AsyncStorage flag + TOTP verification
  ble/           BLE constants, scan/connect (BleService.ts), and the live
                 stimulation engine (StimulationEngine.ts) - see sync model above
  context/       SessionContext - shared app state (toggles, connection,
                 session config), the glue between screens and ble/
  navigation/    4-screen stack: Welcome -> Otp -> DeviceSelect -> Control
  screens/       One component per screen
  theme/         Shared color palette
  utils/         base32/base64/TOTP/range-mapping/color helpers
```

**Screen flow**: Welcome (always shown) -> OTP activation (first run only,
gated by an AsyncStorage flag that's cleared on uninstall/reinstall) ->
Device Select (toggle Pulsators/Light Bar independently, explicit "Connect"
button, strongest-RSSI scan) -> Control (sliders + color wheel, a Start/Stop
toggle button that doubles as both, Disconnect returns to Device Select).

**Activation / OTP**: TOTP (RFC 6238), SHA1, 30s period, 6 digits - standard,
works with Bitwarden/Google Authenticator/Proton. The secret lives in `.env`
(gitignored, `react-native-config` bakes it in at build time);
`scripts/generate-otp-secret.js` generates/rotates it and prints an
`otpauth://` URI for adding it to an authenticator app. **Known, accepted
limitation**: a secret embedded in an app bundle isn't truly secret -
decompiling the APK exposes it. This is intentionally a "contact the
provider" gate, not real security; the only architecturally sound fix would
be server-side OTP validation, which was deliberately not built (would
require standing up backend infrastructure this project otherwise doesn't
need). R8/ProGuard minification is enabled on release builds as a partial
mitigation, not a real fix.

Full setup/build instructions (Android SDK, running on a real device,
generating a shareable release APK) are in `EmdrWirelessApp/README.md` -
kept there rather than duplicated here since they're operational, not
architectural.

## Continuous integration

GitHub Actions runs on pushes to `master`, pull requests, and manual workflow
runs. It installs the locked mobile dependencies and runs Jest, ESLint, and
TypeScript checking; compiles all four Arduino sketches for the ESP32-C3; and
builds the Android release APK. The APK is uploaded as the
`android-release-apk` artifact and retained for three days. Pushes to `master`
require the `OTP_SECRET`, `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`
Actions secrets. Pull requests from forks cannot access secrets and therefore
must be validated separately before a production release is built.

Never print `OTP_SECRET` or signing credentials in workflow logs. Generate an
OTP locally with `node EmdrWirelessApp/scripts/generate-otp-secret.js`, add the
value to your authenticator, and save that same value as the repository's
`OTP_SECRET` Actions secret. Generate a production keystore with `keytool`,
base64-encode it, and store the result as `ANDROID_KEYSTORE_BASE64`; keep the
keystore and passwords backed up securely.

## Known environment gotchas (if setting up on a fresh machine)

Hit and fixed once already, documented so they don't need re-diagnosing:

- **NDK "did not have a source.properties file"**: Android Studio's SDK
  Manager can leave a broken/incomplete NDK install. Check
  `android/build.gradle`'s `ndkVersion` actually matches a *fully* installed
  NDK under `$ANDROID_HOME/ndk/` (has more than just an `.installer`
  subfolder) - if Android Studio grabbed a different version than the
  project expects, just update `ndkVersion` to match what's really there.
- **JRE vs JDK**: `java -version` succeeding doesn't mean a compiler is
  present - Ubuntu splits `openjdk-25-jre` and `openjdk-25-jdk` into separate
  packages. Gradle needs the JDK (`javac`) specifically.
- **Stale Gradle daemon**: if you install the JDK *after* a Gradle daemon has
  already started and failed once, it can keep reporting "no compiler"
  against a now-fixed toolchain. `./gradlew --stop` before retrying.
- BLE doesn't work in the Android emulator - test on a real device over USB.

## Project history / research notes worth knowing

- The commercial reference product's actual protocol/sync internals aren't
  public - the "app is the clock" model above is our own design, informed by
  (not copied from) what its user manual documents about default behavior.
  Treat it as our best-effort reconstruction, not a confirmed spec.
- A design mockup of all 4 app screens exists as a published Claude artifact
  (static visuals, created before the app was built, used to align on flow/
  branding). It may drift from the real app over time and isn't a source of
  truth - the actual `EmdrWirelessApp/src/screens/*.tsx` files are.
- Full commit history was retroactively GPG-signed (hashes rewritten,
  content unchanged) - if a commit hash you remember doesn't resolve, that's
  why.
