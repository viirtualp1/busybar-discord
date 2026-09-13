# busybar-discord

> [!IMPORTANT]
> **Unofficial community project.** Built and maintained by [@viirtualp1](https://github.com/viirtualp1), **not** an official Flipper Devices / BUSY product, and not affiliated with, endorsed by, or supported by them. "BUSY Bar" remains their trademark. Nor is it affiliated with Discord Inc. For the real hardware and official apps, visit **[busy.app](https://busy.app/)**.

Your voice channel, on the strip. Everyone in the call is a circle with their
own face in it, and the circle round whoever is talking lights up.

```
  ╭───╮ ╭───╮ ╭───╮ ╭───╮ ╭───╮      green: talking
  │ ● │ │   │ │   │ │   │ │   │      red:   muted
  ╰───╯ ╰───╯ ╰───╯ ╰───╯ ╰───╯      dim:   listening
        72 × 16, and nothing else
```

The Bar's **START** button mutes and unmutes your microphone.

## No bot, no server

This does not join your Discord server and there is nothing to invite. It talks
to the Discord desktop app already running on this machine, over the local
socket it opens for overlays — the same one Streamkit uses. Discord tells it
who is in the call and who is speaking; nothing goes near your audio.

Two consequences worth knowing before you start:

- **The desktop app has to be running, on this machine.** No client, no
  picture — the display says so and waits.
- **RPC permissions are only granted to the account that owns the
  application.** Discord whitelists these scopes per app, and the owner is
  always on the list for their own. So make the application under the account
  that sits in the call, and it works; hand it to somebody else and it will
  not.

## Getting it going

```bash
npm install
cp .env.example .env
```

Make an application at
[discord.com/developers/applications](https://discord.com/developers/applications).
It needs no bot and no permissions. From its **OAuth2** page copy the client id
and client secret into `.env`, and add `http://localhost` to its redirects.

```bash
npm run login    # approve the dialog Discord puts up, once
npm start
```

`npm run login` writes `discord-token.json` beside the app and the token is
refreshed from then on, so the dialog happens once rather than every start.

## The row

The faces size themselves, the way a flex row does. Every circle has the same
basis — fourteen pixels, which is the largest square a sixteen-pixel strip has
room for — and when the row gets crowded the **gap closes first**, then the
circles shrink together.

| In the call | Circle | Gap |
| ----------- | ------ | --- |
| 1           | 14px   | —   |
| 2           | 14px   | 3px |
| 3           | 14px   | 3px |
| 4           | 14px   | 3px |
| 5           | 13px   | 1px |
| 6           | 11px   | 1px |
| 7           | 9px    | 1px |

Nine pixels is the floor: below that a face is a smudge. Anyone past
`MAX_AVATARS` is counted at the end of the strip instead — `+3` — rather than
being squeezed in.

The row is ordered by **who arrived**, never by who is talking. Sorting by
speech would be livelier and much worse: the circles would reshuffle
mid-conversation and you would lose track of which one is which person, which
is the only thing the display is for.

### Seeing it without five friends

```bash
npm run shot -- --all          # one PNG per size, 1 through 7
npm run shot -- --people 5 --speaking 2
```

No device and no Discord involved — it writes the exact frame the Bar would
draw into `preview/`.

## The ring

| Colour   |                                        |
| -------- | -------------------------------------- |
| green    | talking                                |
| red      | muted, by themselves or by the server  |
| dark red | deafened — they cannot hear you either |
| dim grey | in the call, listening                 |

The outline is one pixel, always. Colour is what carries the meaning, so a
thicker line says nothing extra and takes the space out of the face.

The ring stays on for **350ms** after speech stops. Discord reports every gap
between words, and without the hold the ring strobes at conversational speed,
which is unreadable and unpleasant to sit beside.

The circle is a rectangle with its corner radius set to half its side, which is
how the device is asked for a circle. It is drawn **after** the avatar on
purpose: an avatar is a square picture and the ring is round, so the picture's
corners fall outside the outline and would cut four bites out of it. The
corners are also left transparent, which fixes the same thing a second way, on
a device that honours an alpha channel in an uploaded asset.

## The button

**START** toggles your microphone, and that is not a setting. `busybar-wm` takes
**OK** to cycle apps and **BACK** to hand the choice back, so START is the only
button left over — binding either of the others only breaks the window manager.

> [!WARNING]
> **`busybar-nowplaying` also binds START**, to play/pause. Every app behind
> the proxy sees every button, so if you run both, one press does both things.

`BAR_INPUT=0` leaves your microphone alone entirely.

## What it asks of the Bar

The device is a small embedded thing on the end of Wi-Fi, and a voice channel
is a firehose: five people interrupting each other produce speaking events many
times a second, and every one of them changes the picture. Three limits keep
that from turning into a denial of service:

- **At most one draw every 250ms.** Anything that happens in between replaces
  what is queued rather than adding to it, so the frame that goes out is still
  the newest one. This is a rate limit on the device, not a frame rate.
- **Uploads go up one at a time.** A full call is five pictures, all wanted in
  the same instant at startup. Sent together, that is five concurrent uploads
  at a device that is also being drawn on for the first time.
- **The screen is only wiped when somebody leaves.** Elements persist by id, so
  a disappearance needs a clear — but an arrival does not, and the avatars all
  arrive one upload apart.

**The back panel is not used at all**, and that is the fourth limit. Drawing it
meant the same faces again plus their names — twenty-six elements a frame
instead of ten, and twice the pictures for the device to hold — for a surface
nobody looks at unless the Bar is turned round. It was enough to wedge the Bar
outright, so it is gone rather than optional.

If the device still struggles, `MAX_AVATARS=3`.

## Behind busybar-wm

Point `BUSY_ADDR` at the daemon and leave the credentials empty:

```env
BUSY_ADDR=http://127.0.0.1:4111
```

Nothing else changes. A rank around 45 suits it — a conversation is worth
interrupting the clock or the album cover for, and not worth interrupting a
live match for.

In a profile the app is a package rather than a checkout, so `npm run login`
is not there to run. The same step is installed as its own command:

```bash
cd ~/.busybar/discord && ../node_modules/.bin/busybar-discord-login
```

It has to run from the app's own directory, because that is where its `.env`
is and where the token is written.

`busybar-config` picks the app up with nothing added: it scans the profile's
packages for anything carrying a `busybar` field, and finds the spec this one
ships. There is no list of apps anywhere to add to.

## Configuration

Everything is in [.env.example](.env.example). The ones worth knowing:

|                         |                                                         |
| ----------------------- | ------------------------------------------------------- |
| `DISCORD_CLIENT_ID`     | The application you made. Required.                     |
| `DISCORD_CLIENT_SECRET` | Beside it on the same page. Required.                   |
| `MAX_AVATARS`           | How many faces at once. Default 5.                      |
| `HIDE_BOTS`             | A music bot is in the channel, not in the conversation. |
| `AVATAR_GAIN`           | Photographs are dark at twelve pixels. Default 1.15.    |

The app also ships a machine-readable description of all of this, so
`busybar-deck` can offer the settings without knowing anything about Discord.

## Avatars

Fetched from Discord's CDN once, circled, and kept — on disk in `avatars/` and
on the device as assets. Steady state touches neither: the ring changes colour
many times a minute, the picture behind it does not change at all.

One file per person, named by the avatar hash, so a new avatar is a
new file and the set stays bounded by the people you actually talk to.

## Layout

```
src/discord/   ipc (the pipe), rpc (commands and events), auth (the one
               dialog), voice (who is in the call), client (all of it, wired)
src/avatars/   fetching, circling, caching, uploading
src/view/      layout (the flex row), frame (what to show), elements (as the
               device wants it)
src/bar/       the display, kept in step
```

`voice.ts` and `layout.ts` are pure and have no idea Discord or a Bar exist,
which is why the two things most likely to be wrong — how a room behaves as
people join and talk over each other, and whether five faces fit — are testable
without either.

## License

MIT
