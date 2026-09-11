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
Light Bar Test Rig/main/main.ino Protocol-identical test firmware - built-in
                                  LED only, no strip needed (see below)
EmdrWirelessApp/                 React Native (bare CLI) companion app
```

All three firmware targets run on an **ESP32-C3 SuperMini** board.

## Hardware

| Component | Role | Key pins |
|---|---|---|
| Pulsators (×2) | Vibration motor, PWM-driven | `MOTOR_PIN` = GPIO20 |
| Light Bar | 20-LED WS2812/NeoPixel strip | `LED_PIN` = GPIO2 |
| Light Bar Test Rig | Same protocol, drives the chip's own built-in LED instead of a strip | GPIO8 - a **plain PWM-driven LED**, confirmed by testing (not addressable WS2812, despite some SuperMini variants having one - see note below) |

The two pulsators run **the exact same sketch** - they're told apart only by
the `DEVICE_NAME` constant near the top of `Pulsators/main/main.ino`. Before
flashing a given board, set it to `"Pulsator 1"` or `"Pulsator 2"`.

The **Light Bar Test Rig** exists because the real LED strip isn't always
available to test with. It advertises under the same name and exposes the
identical BLE service/characteristics as the real Light Bar, so the app needs
zero changes to talk to it - only the physical output differs. Useful for
validating app↔firmware communication in isolation.

**Built-in LED gotcha**: some ESP32-C3 SuperMini board variants have an
addressable WS2812 pixel on GPIO8 (which is what the test rig originally
assumed, and what its own header comment used to claim); this specific board
turned out to have a **plain single-color LED** on GPIO8 instead, wired
active-low. The rig was rewritten to drive it with plain PWM
(`analogWrite`/`ledcWrite`-style, no FastLED) - color writes are reflected as
*brightness* (perceived luminance of the RGB value) rather than an actual
color, since a plain LED can't display one. If you're bringing up a new board
and nothing reacts to a FastLED-based test, don't assume the wiring is
broken - confirm with a trivial `digitalWrite` blink test first (toggle the
pin HIGH/LOW with a delay) before suspecting anything else; that's what
resolved it here.

## BLE protocol contract

This is the shared "API" between the firmware and the app - if you change a
UUID or a validated range on one side, update the other
(`EmdrWirelessApp/src/ble/constants.ts` and `.../src/utils/rangeMapping.ts`
mirror everything below).

**Pulsators** - service `4fafc201-1fb5-459e-8fcc-c5c9c331914b`

| Characteristic | UUID | Bytes | Range | Notes |
|---|---|---|---|---|
| Motor state | `668b943b-2cac-4de0-8091-332dedc91739` | 1 | 0/1 | Write-with-response + write-without-response. Applies instantly. |
| Motor intensity | `9f1dc367-ee23-4254-a52a-e41b59f50502` | 1 | 40-200 | Raw PWM value. Applies instantly, even mid-buzz. |

**Light Bar** - service `1fb5c201-4faf-459e-8fcc-c5c9c331914b`

| Characteristic | UUID | Bytes | Range | Notes |
|---|---|---|---|---|
| LED state | `2cac943b-668b-4de0-8091-332dedc91739` | 1 | 0/1 | Turning off applies instantly even mid-sweep. |
| LED color | `526f1035-4262-4175-8ad0-16387b946fce` | 3 | R,G,B each 0-255 | Raw bytes, not a string. |
| LED delay | `ee231dc3-9f67-4254-a52a-e41b59f50502` | 1 | 5-75, multiple of 5 | Per-LED step delay (ms) - **not** a full cycle time, see below. |
| LED sync | `822ff8ad-58e1-44f8-8cb5-f4048a0ee3c3` | 1 | any | Write-without-response trigger, see "Sync model" below. |

**Device names** the app scans for (exact match on advertised local name,
picking strongest RSSI if duplicates are seen - handles multiple kits in one
room): `"Pulsator 1"`, `"Pulsator 2"`, `"Light Bar"`.

**Design choice**: the app never persists a MAC address across sessions.
Every connect is a fresh scan; this is deliberate so the same app works
against whichever specific kit is nearest, without pairing state to manage.

## Sync model - "the app is the clock"

This is the most important architectural decision in the project and isn't
obvious from reading either side of the code in isolation.

**Where this came from**: the real commercial EMDR Kit Wireless (SE Factory
B.V., FCC IDs 2BOUW80045/2BOUW90900) uses its Light Tube as the timing
reference, with Pulsators and Headphone optionally "in sync" with it
(confirmed from its user manual - the "Pulsators in sync" / "Headphone in
sync" toggles, on by default). We adopted the same shape:

- **The Light Bar free-runs its own local sweep animation** off its own
  `millis()`, using whatever `light_delay` (per-LED ms) it was last told.
  This is the one thing the patient directly watches, so it needs to be
  smooth and self-contained - no dependency on live BLE traffic per frame.
- **The pulsators have no local timer at all.** Every on/off transition is a
  live, immediate BLE write from the app (`EmdrWirelessApp/src/ble/StimulationEngine.ts`).
  The app computes when the Light Bar's sweep crosses the middle (twice per
  full cycle, a quarter and three-quarters of the way through, since a round
  trip is two LED-count sweeps) purely from the same parameters it gave the
  Light Bar - it doesn't need the Light Bar to report anything back.
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
  timer directly, alternating the two pulsators. See `pulsatorOnlyDelayMs` /
  `PULSATOR_DELAY_MIN_MS`/`MAX_MS` in `rangeMapping.ts` (100-1500ms,
  carried over from what used to be a firmware-validated range before the
  pulsators became purely reactive).

**What this means for firmware changes**: if you're tempted to add a local
timer back to the pulsators, first re-read this section - it was deliberately
removed (see git history: "remove the local free-running loop, motor_id
phase logic" on the Pulsators sketch) specifically to solve cross-device
drift, and reintroducing it would reintroduce the original problem.

## User-facing ranges vs. firmware ranges

The app never exposes firmware's raw ranges directly - `EmdrWirelessApp/src/utils/rangeMapping.ts`
is the single source of truth for both directions, and screens never talk to
firmware units directly.

| Control | Shown to user | Sent to firmware |
|---|---|---|
| Pulsator intensity | 1-16 (step 1) | 40-200, linear map |
| Cycle time (Light Bar enabled) | 0.19s-2.85s | per-LED delay 5-75ms, snapped to a multiple of 5 (cycle = 2×(LED_COUNT-1)×perLedDelay, i.e. a full sweep out and back) |
| Pulsator delay (pulsators only) | 0.1s-1.5s | same value in ms, snapped to a multiple of 5 |

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
