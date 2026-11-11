# The Serial

A small multiplayer game for the Cyborg Garden arcade. It runs inside a Discord Activity and on the web.

You are guard units on a very dull contract, and your favourite space soap, *The Gilded Airlock*, is on. The show plays for the whole room, scene by scene, and after each scene everyone votes on what happens next. Meanwhile small client emergencies ring for individual players. Respond to one and your helmet display slides over the show until the job is done, so you miss whatever airs. Let it ring out and the crew's shared rating drops. Do your job, or watch your show.

At the end you get the finale your votes led to, the crew rating, and each player's "episode watched" percentage with a one-line verdict.

- 1 to 8 players, about six minutes an episode.
- Mouse, touch and keyboard all work. Keys: `1` `2` `3` to vote or pick, `R` to respond to a call, digits and Enter for codes, arrow keys for dials, hold Space for hold tasks.
- No sound, no network requests other than the room socket, system fonts only.

## How it is put together

This folder is only the browser client. It draws whatever the server sends and holds no script and no answers.

| File | What it is |
| --- | --- |
| `index.html`, `style.css`, `game.js` | The client. No inline scripts, because Discord blocks them. |
| `config.js` | Where the rooms server lives. Empty means "this same host". |
| `rooms-client.js` | An unchanged copy of `arcade-rooms/client/rooms-client.js`. |
| `meta.json` | The arcade listing. |

The game itself (the rules, the timers, the show's script and the emergencies) lives server-side in the `arcade-rooms` repo under `games/the-serial/`. Each player is only ever sent the current scene, a line at a time, so nobody can read ahead.

## Run it locally

You need Node 22 or newer and the `arcade-rooms` repo checked out next to this one.

```sh
cd ../arcade-rooms
npm install
node dev/server.mjs --port 8813 --client ../the-serial
```

Then open <http://localhost:8813/>. To play with more than one player, open the same address (including the `?room=` code it adds) in another browser profile or a private window. Each browser profile is one player.

Add `&pace=fast` to the address to run the episode at several times normal speed, which is handy when testing.

## Tests

The rules are tested in `arcade-rooms`:

```sh
cd ../arcade-rooms
node --test                                  # logic tests, including a walk of the whole script
node games/the-serial/e2e.mjs --port 8813    # three socket players, whole episode; needs the dev server running
```

## Deploying

Set the deployed rooms address in `config.js`. Inside Discord the address is worked out automatically.
