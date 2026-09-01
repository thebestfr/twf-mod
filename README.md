# Discord Character Gift Bot

This bot gives or revokes Roblox game characters from Discord and uses the same permanent gift ledger as the in-game Control Panel.

## Setup

1. Install Node.js 20 or newer.
2. In this folder run `npm install`.
3. Copy `.env.example` to `.env`, then fill in the Discord app token, client ID, guild ID, allowed Discord role IDs, and a long bridge secret.
4. Run `npm run register` once to create the slash commands in your Discord server.
5. Run `npm start`.
6. Host the bot at a public HTTPS address. Configure that address and the same secret in Roblox `ServerStorage.ServerModules.DiscordBridgeSettings`.
7. In Roblox Studio Game Settings > Security, enable **Allow HTTP Requests**.
8. Add a persistent disk to the bot host and set `TWF_DATA_DIR` to its mount path (for example `/var/data/twf-mod` on Render). This keeps role and user permissions, audits, moderation records, and queued actions after restarts or deployments.

## Commands

- `/twf mod roblox_user:<username-or-id>` — opens the TWF Mod card with Gift, Revoke, Character History, moderation, refresh, and Roblox-profile controls.
- `/twf gift roblox_user:<username-or-id> character:<character>` — type part of a name and choose a character suggestion, then press **Confirm Gift**.
- `/twf revoke roblox_user:<username-or-id> character:<character>` — choose the character, then press **Confirm Revoke**.
- `/twf ping`

## Economy commands

- `/twf coins-add roblox_user:<username-or-id> amount:<amount> reason:<optional>`
- `/twf coins-remove roblox_user:<username-or-id> amount:<amount> reason:<optional>`
- `/twf coins-set roblox_user:<username-or-id> amount:<amount> reason:<optional>`
- `/twf code-create code:<code> amount:<coins> max_uses:<0 for unlimited> expires_minutes:<0 for never>`
- `/twf code-disable code:<code>`

Every economy action shows a confirmation card first. Coin changes are saved for online and offline players, and coin codes use the same redeem system as the in-game Control Panel.

## Staff roles and audit log

- `/twf roles-list` — see every Discord role allowed to use TWF Mod.
- `/twf roles-add role:<role>` — allow a staff role to use the bot.
- `/twf roles-remove role:<role>` — remove that role's bot access.
- `/twf audit` — see the latest staff actions, who used them, their target, and when.

Only the owner of the Discord server can add or remove bot roles. You can also set `BOT_OWNER_ID` in `.env` if you want a specific Discord account to manage roles even if it does not own the server. The audit log keeps the latest 300 bot actions.

Gift and revoke requests expire if they are not confirmed within five minutes. The Character History button shows every gift and revoke recorded for that Roblox user. Only users with a Discord role listed in `ALLOWED_ROLE_IDS` can use the commands, and Roblox validates the character name before saving a gift.
