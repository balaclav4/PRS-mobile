# PRS Precision - Mobile App Handoff Spec

> **What this package is:** a design prototype and implementation spec for the PRS Precision
> mobile app. The prototype (`PRS Mobile.dc.html`) is a **design artifact, not shippable code** -
> it fakes the backend, camera, and persistence. This document tells a developer (or Claude Code)
> what to build for real.
>
> **Existing codebase to reuse:** `balaclav4/PRS` (React web app). Port screens/flows here;
> reuse its data models, ballistics math, and API where they already exist.

---

## 0. How to use this with Claude Code

1. Clone your repo, create a branch: `git checkout -b prs-mobile-app`
2. Copy this whole `design_handoff_prs_mobile/` folder into the repo (or attach it).
3. Prompt Claude Code:
   > "Attached is a design prototype + SPEC.md for the PRS mobile app, plus the existing
   > balaclav4/PRS React web codebase. Implement the screens in SPEC.md as an **Expo (React
   > Native) app** using expo-router. Reuse the web app's ballistics/statistics modules where
   > they exist; scaffold what's missing. Start with the data model (§4) and the Capture pipeline
   > (§5) - that's the core feature. Wire navigation per §2. Don't port the HTML/CSS; rebuild
   > natively from the screen specs and screenshots."
4. Review the diff screen-by-screen, then `git add -A && git commit && git push`, open a PR.

**Recommended target:** Expo / React Native. Closest to the existing React app (max logic reuse),
ships to the App Store. If native camera performance for shot-plotting proves insufficient, drop to
a native SwiftUI camera module behind an RN bridge - but start in RN.

---

## 1. Identity

| Token | Value |
|---|---|
| Primary gradient | `#7B4DF0 → #5A2FD0` (150deg) |
| Primary solid | `#6D3BEB` |
| Accent tint (light) | violet `--acs` fills behind icons |
| Marker/target color | `#F0872B` (orange) |
| Good/pass | `#15A34A` (green) - **only** when a value passes threshold |
| Warn | `#D97706` (amber) |
| Sans | Manrope (weights 500-800) |
| Mono (all figures) | JetBrains Mono - use `font-variant-numeric: tabular-nums` |
| Icons | lucide |
| Theming | full light/dark via CSS variables; app must ship both, user-toggled in Settings |

**Rule:** numeric colors are conditional, not decorative. Green means "meets goal" (≤0.5 MOA in the
prototype's thresholds), otherwise neutral text color. Don't paint every stat green.

---

## 2. Navigation & IA

**Bottom tab bar (5 slots):** Home · Sessions · **Capture (center FAB)** · Analytics · More

- **More** is a bottom sheet, not a screen: Ballistics, Reloading, Equipment, Settings.
- Ballistics lives in More (it's read-only reference); do not give it a primary tab.
- Session Detail is reached from Sessions (or Home "recent") and its back button returns to Sessions.
- The Capture FAB always starts a **fresh** session (resets photo/scale/shots).

Screens (9): Login · Home · Capture wizard · Sessions (history) · Session Detail · Analytics ·
Ballistics · Reloading (load-dev wizard) · Equipment · Settings.

---

## 3. Screen specs

### Login *(stubbed in prototype - implement real auth)*
Email/password → Home. Needs real auth + session token. No social login in scope.

### Home / Dashboard
- Hero "Capture your next group" card → starts Capture.
- 3 stat tiles: Sessions count, Best Group (`"` + conditional color), Rifles count.
- "Recent Sessions" (latest 3) with best-group figure; "See all" → Sessions.

### Capture wizard - **5 steps** (the core feature; see §5 for math)
1. **Photo** - real camera capture OR image upload. "Use a demo target" for testing.
2. **Setup** - distance (yd), rifle, load; **marker/target diameter (inches)** = the scale reference.
3. **Scale** - user taps the two opposite edges of the marker on the photo → sets pixels-per-inch.
4. **Mark Shots** - user taps each bullet hole (tap a marker to remove); live shot count + running group.
5. **Review** - computed Group Size ("), Group MOA, Mean Radius, shot count; Save Session.
   - "Next" is gated: Scale requires 2 points; Mark requires ≥2 shots.

### Sessions (history)
- Count header + "New" → Capture.
- Horizontal rifle filter chips (All + one per rifle); tapping filters the list live.
- Each row: name, date · rifle, distance · targets, best-group (conditional color), chevron → detail.

### Session Detail
- Group plot, velocity stats, per-target breakdown. Back → Sessions.

### Analytics
- Rifle filter chips (live - recompute all charts on tap).
- Avg Group + Total Rounds tiles (per selected rifle).
- **Group-Size Trend** line: labeled MOA y-axis (0.2-0.8), x-axis oldest→latest.
- **Shot Distribution** scatter on a target with **labeled rings (0.5 / 1 MOA)**.
- **Load Comparison** with two-sample t-test (keep this - it's the credibility feature).

### Ballistics
Active-load card, environmentals, full 100-1000 yd dope card.
**Recommended upgrade (not yet built):** make range/wind/temp inputs recompute drops live.

### Reloading - load-dev wizard (8 steps)
Goal · Screen · Max Charge · Accuracy · Primers · **Ladder (built)** · Seating · Ref.
- Step rail is tappable. Step 6 (charge ladder w/ node detection) is the only interactive one;
  other steps show an honest "not built yet" state. **Build out the remaining steps for production.**

### Equipment
Rifles & loads (CRUD). Settings: theme, units, CSV/Excel export.

---

## 4. Data model (build real; prototype uses in-memory arrays)

```
Rifle      { id, name, cartridge, barrelLength, twist, notes }
Load       { id, rifleId, bullet, powder, chargeGr, primer, brass, coalOrCbto, velocityFps }
Session    { id, date, rifleId, loadId, distanceYd, suppressed, targets[], notes }
Target     { id, sessionId, photoUri, scale{ p1, p2, diameterIn }, shots[] }
Shot       { x, y }              // normalized 0..1 image coords
Derived    { extremeSpreadIn, groupMoa, meanRadiusIn, sd, es, poiOffset }
```

Persistence: local DB (SQLite/WatermelonDB) + photo file storage; sync to the existing backend if present.

---

## 5. Core math (this is the product - get it exact)

Given shots as normalized image coords and a scale from two marker-edge taps:

```
scaleDistNorm = hypot(p1.x-p2.x, p1.y-p2.y)      // marker edge-to-edge, normalized
inchesPerUnit = markerDiameterIn / scaleDistNorm

centroid      = mean(x), mean(y)
extremeSpread = max pairwise distance between shots  × inchesPerUnit      // "group size"
meanRadius    = mean(dist(shot, centroid))           × inchesPerUnit
groupMOA      = extremeSpreadIn / (1.047 × distanceYd / 100)
```

Production must additionally handle: EXIF orientation, lens distortion (at minimum document the
assumption of a flat, square-on photo), and let the user zoom/pan the photo while tapping.

Load comparison uses a **two-sample t-test** on group sizes (or velocities) between two loads - keep it.

---

## 6. Known gaps to implement (prototype fakes these)

- Real camera + photo persistence (prototype: file upload / demo SVG)
- The full tap-to-plot → scale → stats pipeline against real photos
- Real DB + auth + CSV/Excel export
- Load-dev wizard steps 1-5, 7-8 (only ladder is built)
- Interactive dope card; empty states; chrono/velocity import; press feedback/haptics

---

## 7. App Store checklist

- Apple Developer Program ($99/yr), bundle identifier, signing in Xcode.
- Expo: `eas build --platform ios` then `eas submit`.
- Privacy: camera + photo-library usage strings; note that shot photos are user data.

---

## Files in this package

- `PRS Mobile.dc.html` - the interactive prototype (open in a browser to click through).
- `support.js` - runtime for the prototype (not app code; ignore for the port).
- `screens/` - reference screenshots (Home, Sessions, Analytics, More, Capture).
