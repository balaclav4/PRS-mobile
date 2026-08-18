# Device test

The checks the web preview structurally cannot make. Work top to bottom — the
early ones gate the later ones, and a failure in the first three means the rest
will not be meaningful.

Each names **what it proves** and **what a failure looks like**, so a wrong
result is recognisable rather than merely disappointing. Record the outcome
next to the box; "didn't try" is a useful answer and "seemed fine" is not.

---

## First three: does it run at all

- [ ] **Launches.** Proves the native module graph resolves.
      *Failure:* immediate crash. Most likely `react-native-worklets`, which
      Reanimated needs and which was missing until recently.

- [ ] **Splash, then the app.** Not a white flash, not a stall.
      A permanently blank app used to be possible here and is now not: the error
      from `useFonts` was discarded, so a font that never resolved returned null
      forever. If this still hangs, the cause is something else and worth saying
      so — that one is closed.

- [ ] **Dark mode follows the system,** and switches live from Control Centre
      without a restart.

## Already found and fixed on hardware

Listed so a repeat is recognised immediately rather than re-diagnosed.

- **"Could not process that photo: undefined is not a function"** —
  `expo-image-manipulator` was called on the module namespace instead of the
  exported object. Fixed in both places it appeared. If this exact wording comes
  back, it is a *different* call with the same shape, and
  `scripts/check-native-api.mjs` should have caught it — say so.
- **Blank app forever** if a font failed to load. Fixed.

## The photo path — where native and web differ most

- [ ] **Take a photo with the camera.** Proves `expo-camera`. The web path is a
      canvas and a file input; none of this code has run.

- [ ] **The photo lands upright.** This is the one to watch.
      EXIF orientation is applied by `expo-image-manipulator` natively and by
      canvas on web — *entirely different code*.
      *Failure:* the target appears rotated or mirrored. Every detected hole is
      then 90° from where it should be, and the group shape is transposed. A
      square target makes this hard to see; hold the phone in **landscape** for
      one shot so a rotation is unmistakable.

- [ ] **Import from the photo library.** Proves `expo-image-picker`.

## Touch — the reason this build exists

Native taps carry `locationX`; web carries `offsetX`. These are different
numbers and the zoom bug lived exactly here.

- [ ] **Two-tap placement lands where you tapped,** at 1× and again at 2–3×
      zoom. *Failure:* markers offset from the finger, the offset growing with
      pan distance.

- [ ] **Drag a placement marker.** **Unverified anywhere** — synthetic mouse
      drags do not drive `PanResponder`, so this has never once been exercised.
      It is also the *only* way to adjust a placed bull: taps past the second
      are deliberately inert so a stray tap cannot destroy a calibration.
      *Failure:* the marker will not pick up, or the view pans instead.
      If this is awkward with a thumb, say so — it is the recovery path for a
      refused fit, and it needs a second route if it does not work.

- [ ] **Mark shots with deliberately sloppy thumb taps** on the zoomed Targets
      screen. Grab radius is 34px, marker floor 18px, tap slop 10px, drag slop
      5px. These numbers were chosen for a thumb and tested with a mouse.

- [ ] **Undo after a drag** says "Undo move shot *n*" and puts it back.

- [ ] **Bin on a selected target chip** removes it; undo restores it.

- [ ] **Haptics fire** when placing corners and shots. Silent failure is
      likely if `expo-haptics` is missing — nothing crashes, it just does
      nothing.

## Persistence — never once executed

Web uses localStorage. The device uses SQLite. **No browser check has ever
touched this code.**

- [ ] **Save a session, force-quit, reopen.** Confirm the session, its shots,
      the aim point and the scale all survive.
      *Failure:* empty session list, or a session with no shots.

- [ ] **Account screen names the Firebase project** (`prs-precision`).
      Do this one *first* — it costs a glance and proves the build picked up the
      EAS environment, without signing in to anything.
      *Failure:* it says the app is unconfigured, and every auth check below is
      moot. The iOS build of 5 Aug would have failed exactly here.

- [ ] **Sign in, force-quit, reopen — still signed in.** Proves
      `getReactNativePersistence(AsyncStorage)`. Plain `getAuth` looks identical
      until the app restarts, which is why this needs a real force-quit rather
      than backgrounding.

- [ ] **A custom bull preset survives a restart.**

## Detection, on a real photograph

- [ ] **Detection finds holes,** and the caliber-derived radius is sane.
      Expect to correct it — it is an assist, not an authority. Printed target
      furniture still scores as shots.
      *Watch the timing:* "Suggest shots" used to decode the whole image a
      second time, on the button press. It now reuses the decode the placement
      step already did. If there is still a long pause, the cost is in detection
      itself rather than decoding, which is a different problem and worth
      timing before anyone optimises the wrong half.

- [ ] **A bull with shots on its rim is refused,** not silently mis-scaled.
      Measured on an NRA 50ft sheet: clean rims fit at 100% coverage and read
      square-on; rims broken by holes read 54–55° off-axis and are refused.

## The number-heavy screens

A string-where-a-number-belongs bug surfaces here and nowhere else.

- [ ] **Ballistics** solves and the dope card fills.
- [ ] **Import a drag curve** and confirm the card changes.
- [ ] **Load dev** and **scope evaluation** compute without a crash.
- [ ] **Export CSV** — `expo-sharing` opens the native share sheet.

---

## Not in this build

- **Cloud sync.** The reconciliation engine is built and tested; nothing writes
  to Firestore. The app says data stays on the device, which is true.
- **Training-data upload.** Consent is built; the upload path is not.
- **Account deletion** is testable but destructive — see `RELEASE.md`. Do it
  with a throwaway account, because App Review will.
