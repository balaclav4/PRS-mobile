# Release checklist

State as of the last commit. Items are marked done only where they have actually
been verified, not merely written.

## Blocking

- [ ] **Run on real hardware.** Nothing in this app has ever executed outside
      react-native-web. `expo-sqlite`, `expo-camera`, `expo-image-picker`,
      `expo-haptics` and the AsyncStorage auth persistence have never run once.

      `npm run ios:build` or `npm run android:build` with a device attached.

      The checks below are the ones the web preview structurally cannot make.
      Each names what breaks if it fails, so a failure is recognisable rather
      than merely wrong:

      - [ ] **App launches at all.** Reanimated needs `react-native-worklets`,
            which was missing until recently; a crash on launch points there.
      - [ ] **Splash appears, then the app** - not a white flash.
      - [ ] **Take a photo with the camera.** The web path uses a canvas and a
            file input; nothing about `expo-camera` has run.
      - [ ] **Photo lands upright.** EXIF orientation is applied natively by
            expo-image-manipulator and by canvas on web - different code. If a
            phone photo appears rotated, every detected hole is 90 degrees from
            where it should be.
      - [ ] **Import from the photo library** via expo-image-picker.
      - [ ] **Corners and shots land where tapped.** Native taps carry
            `locationX`; web carries `offsetX`. Zoom and pan too.
      - [ ] **Detection finds holes** in a real photo, and the caliber-derived
            radius is sane.
      - [ ] **Save a session, force-quit, reopen.** This is the SQLite path,
            which no browser check has ever touched - web uses localStorage.
            Confirm the session, its shots, aim point and scale all survive.
      - [ ] **Sign in, force-quit, reopen - still signed in.** Proves
            `getReactNativePersistence(AsyncStorage)`. Plain `getAuth` would
            look identical until the app restarts.
      - [ ] **Haptics fire** when placing corners and shots.
      - [ ] **Export CSV** - expo-sharing opens the native share sheet.
      - [ ] **Load dev, ballistics, scope evaluation** each compute without a
            crash; the number-heavy screens are where a string-vs-number bug
            would surface.
      - [ ] **Dark mode follows the system** and switches live in Control Centre.

- [ ] **Verify account deletion with a throwaway account.** The code
      reauthenticates and calls `deleteUser`, and the prompt is verified, but the
      destructive call is not - confirming it means deleting a real account.
      Create one via "Create an account", delete it, confirm it is gone from the
      Firebase console. App Review will do exactly this.

- [ ] **Deploy the deletion function. Now required, not advisable.**

      This was close to optional while nothing was uploaded: there was no server
      copy to orphan. Sync changed that on 15 Aug 2026. A signed-in shooter's
      sessions, shots, aim points and load development now live under
      `users/{uid}` in Firestore, and deleting the account without this leaves
      every one of those subcollections stored and unreachable — which is both
      the wrong answer to a deletion request and the thing App Review checks.

      `lib/syncremote.purgeRemote()` deletes what the client can reach and is
      called on account deletion, but the web SDK has no recursive delete, so it
      cannot finish the job. It is a mitigation, not a substitute.

      `functions/index.js` removes
      `users/{uid}` recursively when an account is deleted, plus any training
      contributions it submitted. Written, not deployed:

      npm run firebase -- login          # once
      cd functions && npm install && cd ..
      npm run functions:deploy

      Requires Blaze billing on the project; Cloud Functions will not deploy on
      the free Spark plan.

      The client cannot do this - the web SDK has no recursive delete, and
      deleting `users/{uid}` leaves every subcollection beneath it stored and
      orphaned. Firebase's official "Delete User Data" extension is a reasonable
      alternative for the account tree, but does not know about `training-data`.

- [ ] **Privacy policy URL.** Required by App Store Connect, and the app collects
      email addresses through authentication.

      **Re-read it before publishing.** `docs/PRIVACY.md` was drafted for a
      version that *might* sync and says "if cloud sync is enabled on your
      account". That is now simply true for anyone signed in, so the conditional
      wording should become plain. The in-app copy on Account has already been
      corrected and says different things to a signed-in user and a local-only
      one. Drafts are in `docs/PRIVACY.md` and
      `docs/TERMS.md` - they need a lawyer's review, six placeholders filled
      (company name, address, jurisdiction, two contact emails, dates) and
      hosting at a public URL.

- [ ] **Training Data Contribution: consent is built, upload is not.** The
      Settings toggle, the consent record and the per-target stamping all exist
      and are tested. Nothing uploads yet, so the policy language describing what
      is sent is accurate about intent but not yet about behaviour. Before
      publishing, either build the upload path or soften those sections to
      describe a feature that is coming.

- [x] **EAS secrets.** Done, 10 Aug 2026. All six `EXPO_PUBLIC_FIREBASE_*`
      values are registered for the development, preview and production
      environments, and each build profile in `eas.json` now names its
      environment — without that field the build reads none of them and ships
      local-only, which looks identical to a working build until you try to
      sign in. The iOS build of 5 Aug predates this and was unconfigured.

      Original note follows, for the next project.

      `.env.local` is gitignored and is not available to cloud
      builds, so the six `EXPO_PUBLIC_FIREBASE_*` values must be registered with
      EAS or builds will ship unconfigured and run local-only:

      npm run eas -- login               # once
      npm run eas -- secret:create --name EXPO_PUBLIC_FIREBASE_API_KEY --value <value>

      (repeat for AUTH_DOMAIN, PROJECT_ID, STORAGE_BUCKET, MESSAGING_SENDER_ID,
      APP_ID). They are inlined into the bundle in plain text by design - a
      Firebase web key identifies a project and is not a credential. Firestore
      rules are the access control.

- [x] **Deploy the Firestore rules.** Published 10 Aug 2026, as written. That
      closes the two gaps: `loaddev` and `dopecards` were unmatched and
      therefore denied, and `training-data` had no rule at all.

      **What went live for `training-data`:** any signed-in user may read the
      corpus; a contribution can only be created by the account stamping its own
      uid; nothing may be edited or deleted from a client. The read policy was
      raised as a decision rather than a detail and taken deliberately.

      It costs nothing today because the corpus is empty - the upload path does
      not exist yet. If that read rule is ever to be tightened, before the
      upload is built is the moment; afterwards it is retroactive.

- [ ] **Apple privacy nutrition labels** in App Store Connect. This needs
      rewriting since sync landed — the old note said "nothing else leaves the
      device", which was true then and is not now.

      What is collected for a signed-in user: an email address, linked to
      identity, for account management; and their shooting data — sessions,
      shot coordinates, aim points, equipment and load development — linked to
      identity, stored under their own uid so it reaches their other devices.

      What is still never collected: target photographs. A photo is measured
      and discarded, and a saved target keeps only coordinates and the
      reference corners. There is no analytics or tracking SDK of any kind, and
      no crash reporter — problem reports are built locally and sent only if
      the shooter presses send.

      A local-only user uploads nothing at all.

## Tooling

Neither the Firebase nor the EAS CLI is installed globally, and npm's global
prefix here is `/usr/lib/node_modules`, which needs root. Both run through `npx`
instead - no sudo, nothing installed outside the project:

    npm run firebase -- <args>     # e.g. npm run firebase -- login
    npm run eas -- <args>

The `--` matters: it passes the rest through to the CLI rather than to npm.

## Done

- [x] `expo-doctor` passes 20/20. Re-verified 10 Aug 2026 after nine packages
  had drifted to older patches within SDK 57; fixed before the device build so
  the hardware test exercises what would actually ship.
- [x] Bundle identifiers, versions and build numbers set for both platforms.
- [x] Camera and photo library usage descriptions written for iOS and Android.
- [x] Icons, adaptive icons and splash screen configured. The paths were right
  from the start but the artwork was Expo's template chevron until 16 Aug 2026 —
  configured and branded are not the same thing, and the earlier builds shipped
  the placeholder. Sources are SVG in `assets/brand/`; `scripts/make-icons.sh`
  regenerates every PNG from them and fails if the App Store icon comes out
  carrying an alpha channel. Icons are baked at prebuild, so this needs a new
  native build to appear — an OTA update will not carry it.
- [x] `eas.json` with development, preview and production profiles.
- [x] `npm test` - 37 checks: a syntax gate, a schema gate and 35 harnesses.

## Not blocking

- Cloud sync is unwired. The reconciliation engine is built and tested; nothing
  writes to Firestore yet. The app is honest about this - Account says data stays
  on the device.
- The bullet-hole detector is an assist, not an authority, and the shooter should
  expect to correct it. Twenty real photographs have now been measured against it
  and the results are in `scripts/test-photos.mjs`:
    - Search is now scoped to the target the shooter marked, which was the single
      largest source of false positives. An NRA sheet on a cutting mat went from
      104 detections to 14 once scoped to one bull.
    - Printed target furniture is still reported as shots. A printed mark is
      manufactured and a bullet hole is torn, so the printed mark is the cleaner
      blob and outranks real holes. On a Shoot-N-C, five of the six best-scoring
      detections are the lettering; on a clean NRA bull the best-scoring
      detection in the image is the printed centre dot.
    - `expectedShots` exists in the library and is deliberately not offered in the
      UI, because on these photographs it shortens the list without improving it.
    - Splatter targets need colour to separate a torn impact from printed
      chartreuse. `toGrayscale` discards that before detection runs.
- Theme and unit preferences are per-device. They will follow the account once
  sync lands.

## Exempt

- **Sign in with Apple** is not required. It applies only to apps offering
  third-party or social login; this app is email/password only.
