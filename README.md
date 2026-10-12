# Lakeshore Exit

First-person skydiving over the Chicago lakefront. Ride a Twin Otter east of the beach, walk to the door, and exit over Lake Michigan. Pull when you want. If the main fails, cut away and throw the reserve before the hard deck, then fly the canopy back to the sand.

## Run

```bash
npm install
npm run dev
```

The dev server listens on port 8080.

## Publish

`npm run build:web` builds a static, installable copy of the game into `dist-web/` (relative paths, so it works under any subpath). Pushes to `main` deploy it to GitHub Pages through `.github/workflows/pages.yml`, which serves it at https://www.jameskeithharwood.com/lakeshore-exit/. Runtime asset URLs in game code should start with `import.meta.env.BASE_URL`.

## Jump

- Exit altitude 8,000–20,000 ft. Malfunction chance 0–40%.
- Cabin: mouse look, WASD to walk. Space only jumps from the door.
- Freefall: mouse is body attitude. A/D turn, W arches, S dives.
- Two jumpers leave just ahead of you and build a base with a slot open for you. Fly to the BASE marker and face in to dock. At 5,500 ft everyone breaks off: turn away, track, and get clear before you pull.
- Canopy: A/D turn, W drives, S flares. Face the lake and land into the wind.
- Audible altimeter and a full-screen banner at 4,500 ft. Pull-now at 3,000. Hard deck at 2,000.
- A bad main is a streamer or a line twist. Cut away, then deploy the reserve. Too low and you go in.

Best beach landing is saved in the browser.
