import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

const robloxUser = (option) => option.setName("roblox_user").setDescription("Roblox username or numeric user ID").setRequired(true).setMinLength(1).setMaxLength(40);
const amount = (option, description, minimum = 1) => option.setName("amount").setDescription(description).setMinValue(minimum).setMaxValue(100000000).setRequired(true);
const note = (option) => option.setName("reason").setDescription("Private staff note (optional)").setMaxLength(200);
const accessArea = (option) => option.setName("command").setDescription("Staff-console area to allow or remove").setRequired(true).addChoices(
  { name: "🛡️ Safety & moderation", value: "mod" }, { name: "✨ Character access", value: "characters" },
  { name: "💎 Currency controls", value: "coins" }, { name: "🎟️ Voucher controls", value: "codes" },
  { name: "📚 Activity archive", value: "audit" }, { name: "👑 Full console", value: "all" },
);

const commands = [
  new SlashCommandBuilder().setName("fate").setDescription("The Witches Fate • modern staff console")
    .addSubcommand((sub) => sub.setName("profile").setDescription("Open a live Roblox player command centre.").addStringOption(robloxUser))
    .addSubcommand((sub) => sub.setName("unlock").setDescription("Permanently unlock a character for a Roblox player.").addStringOption(robloxUser).addStringOption((option) => option.setName("character").setDescription("Character to unlock").setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName("lock").setDescription("Remove a previously gifted character.").addStringOption(robloxUser).addStringOption((option) => option.setName("character").setDescription("Character to lock again").setRequired(true).setAutocomplete(true)))
    .addSubcommand((sub) => sub.setName("credit").setDescription("Add currency to a Roblox player.").addStringOption(robloxUser).addIntegerOption((option) => amount(option, "Currency to add")).addStringOption(note))
    .addSubcommand((sub) => sub.setName("debit").setDescription("Remove currency, never below zero.").addStringOption(robloxUser).addIntegerOption((option) => amount(option, "Currency to remove")).addStringOption(note))
    .addSubcommand((sub) => sub.setName("balance").setDescription("Set a Roblox player's exact currency balance.").addStringOption(robloxUser).addIntegerOption((option) => amount(option, "New balance", 0)).addStringOption(note))
    .addSubcommand((sub) => sub.setName("voucher-create").setDescription("Create a redeemable currency voucher.").addStringOption((option) => option.setName("code").setDescription("3-24 letters, numbers, _ or -").setRequired(true).setMinLength(3).setMaxLength(24)).addIntegerOption((option) => amount(option, "Currency per redemption")).addIntegerOption((option) => option.setName("max_uses").setDescription("0 = unlimited uses").setMinValue(0).setMaxValue(1000000).setRequired(true)).addIntegerOption((option) => option.setName("expires_minutes").setDescription("0 = never expires").setMinValue(0).setMaxValue(525600).setRequired(true)))
    .addSubcommand((sub) => sub.setName("voucher-close").setDescription("Disable a voucher immediately.").addStringOption((option) => option.setName("code").setDescription("Voucher code to disable").setRequired(true).setMinLength(3).setMaxLength(24)))
    .addSubcommand((sub) => sub.setName("roles").setDescription("View staff roles allowed in the Fate console."))
    .addSubcommand((sub) => sub.setName("role-allow").setDescription("Allow a Discord role to use the console.").addRoleOption((option) => option.setName("role").setDescription("Staff role to allow").setRequired(true)))
    .addSubcommand((sub) => sub.setName("role-remove").setDescription("Remove a Discord role from the console.").addRoleOption((option) => option.setName("role").setDescription("Staff role to remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("access").setDescription("View detailed staff-console permissions."))
    .addSubcommand((sub) => sub.setName("access-role").setDescription("Edit one permission for a Discord role.").addRoleOption((option) => option.setName("role").setDescription("Role to update").setRequired(true)).addStringOption(accessArea).addBooleanOption((option) => option.setName("enabled").setDescription("True = allow, false = remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("access-member").setDescription("Edit one permission for a Discord user.").addUserOption((option) => option.setName("user").setDescription("Discord user to update").setRequired(true)).addStringOption(accessArea).addBooleanOption((option) => option.setName("enabled").setDescription("True = allow, false = remove").setRequired(true)))
    .addSubcommand((sub) => sub.setName("roster").setDescription("Browse characters staff can unlock."))
    .addSubcommand((sub) => sub.setName("activity").setDescription("View the staff-action archive."))
    .addSubcommand((sub) => sub.setName("overview").setDescription("View your access and the console's health."))
    .addSubcommand((sub) => sub.setName("guide").setDescription("Open the Fate staff-console guide."))
    .addSubcommand((sub) => sub.setName("pulse").setDescription("Check that the Fate console is online.")),
].map((command) => command.toJSON());

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) throw new Error("Set DISCORD_TOKEN, DISCORD_CLIENT_ID, and DISCORD_GUILD_ID in .env first.");
const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID), { body: commands });
console.log("Fate staff-console commands registered.");
