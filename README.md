# Games in Common

Find out which Steam games you and a friend both own, then ping them to play — all from one page, without digging through Steam's own UI.

Pick a friend from your Steam friends list, see the games you have in common (as long as their library is public), and click "Ask to play" on any of them to open a Steam chat with that friend and copy a ready-made message to your clipboard.

## Screenshots

<!-- Add screenshots here, e.g.: -->
<!-- ![Friends list with common games](docs/screenshot-friends.png) -->
<!-- ![Ask to play a game](docs/screenshot-ask-to-play.png) -->

## Requirements

- The [Steam desktop client](https://store.steampowered.com/about/) installed and running (needed for the "Ask to play" button to open a chat window)
- A free Steam Web API key — get one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (any domain name works, e.g. "localhost")
- Your Steam friends list set to public (Steam won't tell this app who your friends are otherwise), and a friend's game library needs to be public for it to show up as "in common"

## Install

### Option A: Download the app (Windows / Linux)

Grab the latest build from the [Releases](../../releases) page (or the [Actions](../../actions) tab if a release hasn't been published yet), install it, and launch it. On first run it'll ask for your Steam Web API key — paste it in and you're set up.

### Option B: Run from source

Requires [Node.js](https://nodejs.org/) 18+.

```bash
git clone https://github.com/GH-Samir/games-in-common.git
cd games-in-common
npm install
npm start
```

Then open http://localhost:3000 and follow the first-run setup screen to enter your Steam Web API key.

## How it works

- Sign in with your Steam account (via Steam's own login page — this app never sees your password)
- It compares your owned games against each public-library friend's owned games
- Click a friend to expand their list of shared games
- Click "Ask to play" on a game to open a Steam chat with that friend and copy a suggested message ("Hey! Want to play &lt;game&gt;?") to your clipboard, ready to paste
