import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const robloxId = (option) => option.setName("roblox_user_id").setDescription("Roblox numeric user ID").setRequired(true);
const amount = (option, description, minimum = 1) => option.setName("amount").setDescription(description).setMinValue(minimum).setMaxValue(100000000).setRequired(true);
const reason = (option) => option.setName("reason").setDescription("Staff note (optional)").setMaxLength(200);
const permission = (option) => option.setName("command").setDescription("TWF Mod area to grant or remove").setRequired(true).addChoices(
  { name: "🛡️ Mod panel + bans", value: "mod" }, { name: "🎭 Character gifts + revokes", value: "characters" },
  { name: "🪙 Coin controls", value: "coins" }, { name: "🎟️ Coin-code controls", value: "codes" },
  { name: "📜 Audit log", value: "audit" }, { name: "📡 Live server controls", value: "server" }, { name: "👑 Everything", value: "all" },
);

const commands = [
  new SlashCommandBuilder().setName("twf").setDescription("The Witches Fate staff controls.")
    .addSubcommand((sub) => sub.setName("mod").setDescription("Open advanced TWF Mod controls for a Roblox user.").addStringOption(robloxId))
    .addSubcommand((sub) => sub.setName("gift").setDescription("Give a permanent TWF character.").addStringOption(robloxId).addStringOption((option) => option.setName("character").setDescription("Choose or type the TWF character").setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName("revoke").setDescription("Revoke a permanently gifted TWF character.").addStringOption(robloxId).addStringOption((option) => option.setName("character").setDescription("Choose or type the TWF character").setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName("coins-add").setDescription("Add coins to a Roblox user, online or offline.").addStringOption(robloxId).addIntegerOption((option) => amount(option, "Coins to add")).addStringOption(reason))
    .addSubcommand((sub) => sub.setName("coins-remove").setDescription("Remove coins from a Roblox user, never below zero.").addStringOption(robloxId).addIntegerOption((option) => amount(option, "Coins to remove")).addStringOption(reason))
    .addSubcommand((sub) => sub.setName("coins-set").setDescription("Set a Roblox user's exact saved coin balance.").addStringOption(robloxId).addIntegerOption((option) => amount(option, "New coin balance", 0)).addStringOption(reason))
    .addSubcommand((sub) => sub.setName("code-create").setDescription("Create a redeemable TWF coin code.").addStringOption((option) => option.setName("code").setDescription("3-24 letters, numbers, _ or -").setRequired(true).setMinLength(3).setMaxLength(24)).addIntegerOption((option) => amount(option, "Coins per redemption")).addIntegerOption((option) => option.setName("max_uses").setDescription("0 = unlimited uses").setMinValue(0).setMaxValue(1000000).setRequired(true)).addIntegerOption((option) => option.setName("expires_minutes").setDescription("0 = never expires").setMinValue(0).setMaxValue(525600).setRequired(true)))
    .addSubcommand((sub) => sub.setName("code-disable").setDescription("Disable a coin code immediately.").addStringOption((option) => option.setName("code").setDescription("Coin code to disable").setRequired(true).setMinLength(3).setMaxLength(24)))
    .addSubcommand((sub) => sub.setName("ban").setDescription("Immediately permanently ban a Roblox player from TWF.").addStringOption(robloxId).addStringOption((option) => option.setName("reason").setDescription("Why this player is being banned").setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName("tempban").setDescription("Temporarily ban a Roblox player from TWF.").addStringOption(robloxId).addStringOption((option) => option.setName("duration").setDescription("Use 30m, 1h, 7d, or 1w").setRequired(true).setMaxLength(5)).addStringOption((option) => option.setName("reason").setDescription("Why this player is being banned").setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName("unban").setDescription("Remove a TWF ban from a Roblox player.").addStringOption(robloxId).addStringOption(reason))
    .addSubcommand((sub) => sub.setName("announce").setDescription("Send a polished staff announcement to every active TWF server.").addStringOption((option) => option.setName("message").setDescription("Message to show every player").setRequired(true).setMaxLength(180)))
    .addSubcommand((sub) => sub.setName("pvp").setDescription("Turn the TWF PvP event state on or off live.").addBooleanOption((option) => option.setName("enabled").setDescription("True = enable PvP, false = disable PvP").setRequired(true)))
    .addSubcommand((sub) => sub.setName("character-menu").setDescription("Lock or unlock character switching live for all players.").addBooleanOption((option) => option.setName("locked").setDescription("True = lock switching, false = unlock it").setRequired(true)))
    .addSubcommand((sub) => sub.setName("warn").setDescription("Send an immediate staff warning to an online Roblox player.").addStringOption(robloxId).addStringOption((option) => option.setName("message").setDescription("Warning message shown to the player").setRequired(true).setMaxLength(300)))
    .addSubcommand((sub) => sub.setName("heal").setDescription("Fully heal an online Roblox player immediately.").addStringOption(robloxId))
    .addSubcommand((sub) => sub.setName("roles-add").setDescription("Allow a Discord role to use TWF Mod.").addRoleOption((option) => option.setName("role").setDescription("Staff role to allow").setRequired(true)))
    .addSubcommand((sub) => sub.setName("roles-remove").setDescription("Remove a Discord role's TWF Mod access.").addRoleOption((option) => option.setName("role").setDescription("Staff role to remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("permissions-list").setDescription("Show the detailed TWF Mod permission setup."))
    .addSubcommand((sub) => sub.setName("permissions-role").setDescription("Grant or remove one TWF Mod permission for a Discord role.").addRoleOption((option) => option.setName("role").setDescription("Role to update").setRequired(true)).addStringOption(permission).addBooleanOption((option) => option.setName("enabled").setDescription("True = grant, false = remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("permissions-user").setDescription("Grant or remove one TWF Mod permission for a Discord user.").addUserOption((option) => option.setName("user").setDescription("Discord user to update").setRequired(true)).addStringOption(permission).addBooleanOption((option) => option.setName("enabled").setDescription("True = grant, false = remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("character-list").setDescription("Browse every character available through TWF Mod gifts."))
    .addSubcommand((sub) => sub.setName("help").setDescription("Open the TWF Mod staff-command guide."))
    .addSubcommand((sub) => sub.setName("audit").setDescription("View the latest TWF Mod audit actions.")),
].map((command) => command.toJSON());

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) throw new Error("Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in .env first.");
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands });
console.log("Discord slash commands registered.");
