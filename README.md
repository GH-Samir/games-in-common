# Games in Common

Find out which Steam games you have in common with your friends, discover new ones to play together, and keep track of the games you're considering - all from one app, without digging through Steam's own UI.

## Screenshots

<!-- Add screenshots here, e.g.: -->
<!-- ![Friends list with common games](docs/screenshot-friends.png) -->
<!-- ![Ask to play a game](docs/screenshot-ask-to-play.png) -->

## Features

- **Friends** - see which games you and each Steam friend both own (as long as their library is public), with playtime for both of you, and click "Ask to play" to open a Steam chat with a ready-made message copied to your clipboard.
- **Groups** - organise your friends into named groups (small, medium, or large), see the games everyone in a group has in common, and jump into a group chat.
- **Discover new games** - for any friend or group, find games to buy that fit a budget and currency you choose, prioritised by the genres you play most together, with an option to show multiplayer games only. Roll again for more picks, and save the ones you like.
- **Game Chest** - a saved list of games you're considering, showing the live price, discount, and a link to the Steam store page.
- **Settings** - choose a light, dark, or system theme, an accent colour, comfortable or compact layout, and whether to reduce motion.

## Requirements

- The [Steam desktop client](https://store.steampowered.com/about/) installed and running (needed for "Ask to play" and "Create group chat" to open a Steam chat window)
- A free Steam Web API key: get one at [steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (any domain name works, e.g. "localhost")
- Your Steam friends list set to public (Steam won't tell this app who your friends are otherwise), and a friend's game library needs to be public for it to show up as "in common"

## Install

### Option A: Download the app (Windows / Linux)

Grab the latest build from the [Releases](../../releases) page (or the [Actions](../../actions) tab if a release hasn't been published yet), install it, and launch it. On first run it'll ask for your Steam Web API key - paste it in and you're set up.

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

- Sign in with your Steam account via Steam's own login page - this app never sees your password
- The Friends tab compares your owned games against each public-library friend's owned games
- The Groups tab lets you save named groups of friends, see what the whole group has in common, and start a group chat
- The "Find new games" panel (on a friend or group) suggests store games within your budget, weighted towards the genres you already play most
- Save any suggested game to your Game Chest to keep an eye on its price and revisit it later
