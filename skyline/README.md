# Skyline Flyer

A Flappy Bird–style game for mobile browsers: fly a little propeller plane through the gaps in the skyscrapers. Plain JavaScript and canvas, no dependencies.

## Play

Open `skyline/index.html` in a browser, or serve the repo with any static server and go to `/skyline/`:

```sh
npx serve .   # or: python3 -m http.server
```

On a phone, "Add to Home Screen" gives you a full-screen app.

## Controls

- **Tap** anywhere (or press Space / ↑) to climb.
- **❚❚** (or P / Esc) pauses. The game pauses by itself when you switch apps, and after resuming it waits for your next tap.
- **🔊** (or M) toggles sound. Crashing plays a scream.

## How it plays

- Each skyscraper you clear scores a point. Hit one and it comes down: the lights go out, the top crashes onto the bottom and the whole tower sinks into the street in a cloud of dust. The plane speeds up and the gaps get tighter as your score climbs, up to a limit.
- The sky cycles from day to dusk to night and back every few points, and the city lights come on at night.
- Your best score is saved on the device.
