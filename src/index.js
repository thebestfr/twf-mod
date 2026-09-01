import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TWF_CHARACTERS } from "./characters.js";
import { acknowledgeCommand, activeCommands, addAllowedRole, addAudit, addHistory, canUseCommand, claimCommand, enqueue, getAllowedRoles, getAudit, getCommandPermissions, getHistory, moderationStatus, removeAllowedRole, setModeration, setRoleCommandPermission, setUserCommandPermission, storageStatus } from "./store.js";

for (const name of ["DISCORD_TOKEN", "BRIDGE_SECRET"]) if (!process.env[name]) throw new Error(`Missing ${name} in .env.`);
const defaultRoleIds = (process.env.ALLOWED_ROLE_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
const pendingActions = new Map();
const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const validUserId = (value) => /^\d{1,20}$/.test(String(value));
const staff = (interaction) => `${interaction.user.username} (${interaction.user.id})`;
const trim = (text, length = 700) => text ? text.slice(0, length) : "No public description.";
function roleIds(interaction) { const roles = interaction.member?.roles; return roles?.cache ? roles.cache.map((role) => role.id) : Array.isArray(roles) ? roles : []; }
function botOwner(interaction) { return interaction.user.id === process.env.BOT_OWNER_ID || interaction.user.id === interaction.guild?.ownerId; }
function authorized(interaction, permission = "mod") { return botOwner(interaction) || canUseCommand(interaction.user.id, roleIds(interaction), permission, defaultRoleIds); }
function audit(interaction, action, target = "", details = "") { addAudit({ action, target: String(target), details: String(details), issuedBy: staff(interaction), issuedById: interaction.user.id }); }
function durationText(seconds) { if (!seconds) return "Permanent"; if (seconds % 86400 === 0) return `${seconds / 86400} day(s)`; if (seconds % 3600 === 0) return `${seconds / 3600} hour(s)`; return `${Math.ceil(seconds / 60)} minute(s)`; }
function parseDuration(text) { const match = String(text).trim().match(/^(\d{1,3})\s*([mhdw])$/i); return match ? Number(match[1]) * ({ m: 60, h: 3600, d: 86400, w: 604800 })[match[2].toLowerCase()] : null; }
const permissionNames = { mod: "🛡️ Mod panel + bans", characters: "🎭 Characters", coins: "🪙 Coins", codes: "🎟️ Coin codes", audit: "📜 Audit log", all: "👑 Everything" };
const permissionForSubcommand = (sub) => ({ mod: "mod", gift: "characters", revoke: "characters", "coins-add": "coins", "coins-remove": "coins", "coins-set": "coins", "code-create": "codes", "code-disable": "codes", audit: "audit", "character-list": "characters" })[sub] || "mod";
async function fetchJson(url) { try { const response = await fetch(url); return response.ok ? response.json() : null; } catch { return null; } }
async function resolveRobloxUserId(value) {
  const target = String(value || "").trim();
  if (validUserId(target)) return target;
  if (!/^[A-Za-z0-9_]{3,20}$/.test(target)) return null;
  try {
    const response = await fetch("https://users.roblox.com/v1/usernames/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [target], excludeBannedUsers: false }),
    });
    const payload = response.ok ? await response.json() : null;
    const user = payload?.data?.[0];
    return user?.id ? String(user.id) : null;
  } catch { return null; }
}
async function robloxProfile(userId) {
  const profile = await fetchJson(`https://users.roblox.com/v1/users/${userId}`);
  if (!profile) return null;
  const [thumbnail, friends, followers, following, groups] = await Promise.all([
    fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`),
    fetchJson(`https://friends.roblox.com/v1/users/${userId}/friends/count`),
    fetchJson(`https://friends.roblox.com/v1/users/${userId}/followers/count`),
    fetchJson(`https://friends.roblox.com/v1/users/${userId}/followings/count`),
    fetchJson(`https://groups.roblox.com/v2/users/${userId}/groups/roles`),
  ]);
  const primaryGroup = Array.isArray(groups?.data) ? groups.data[0] : null;
  return {
    profile,
    avatar: thumbnail?.data?.[0]?.imageUrl || null,
    social: { friends: Number(friends?.count) || 0, followers: Number(followers?.count) || 0, following: Number(following?.count) || 0 },
    primaryGroup: primaryGroup ? { name: primaryGroup.group?.name || "Unknown", id: primaryGroup.group?.id, role: primaryGroup.role?.name || "Member" } : null,
  };
}

function modCard(userId, data) {
  const profile = data?.profile, name = profile?.name || "Unknown Roblox User", display = profile?.displayName || name, created = profile?.created ? new Date(profile.created) : null, age = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null, ban = moderationStatus(userId), history = getHistory(userId), latest = history[0], social = data?.social || {}, group = data?.primaryGroup;
  const moderation = ban ? (ban.expiresAt ? `🔴 Temp banned • ends <t:${Math.floor(ban.expiresAt / 1000)}:R>` : "🔴 Permanently banned") : "🟢 No active TWF ban";
  const accountStatus = profile?.isBanned ? "🔴 Roblox account banned" : "🟢 Roblox account active";
  const groupText = group ? `[${group.name}](https://www.roblox.com/groups/${group.id})\nRole: **${group.role}**` : "No public primary group";
  const latestText = latest ? `**${latest.action}**\n<t:${Math.floor(latest.at / 1000)}:R> by ${latest.issuedBy}` : "No staff actions recorded.";
  const embed = new EmbedBuilder()
    .setColor(ban ? 0xed4245 : 0x71d7ce)
    .setAuthor({ name: "TWF MODERATION CENTRE • LIVE PROFILE" })
    .setTitle(display)
    .setDescription(`**@${name}**  •  Roblox ID: \`${userId}\`\n${trim(profile?.description, 500)}`)
    .addFields(
      { name: "TWF enforcement", value: moderation, inline: true },
      { name: "Roblox account", value: accountStatus, inline: true },
      { name: "Account age", value: created ? `<t:${Math.floor(created.getTime() / 1000)}:D>\n${age.toLocaleString()} days old` : "Unavailable", inline: true },
      { name: "Social", value: `**${social.friends || 0}** friends • **${social.followers || 0}** followers\n**${social.following || 0}** following`, inline: true },
      { name: "Primary group", value: groupText, inline: true },
      { name: "Quick links", value: `[Roblox Profile](https://www.roblox.com/users/${userId}/profile) • [Inventory](https://www.roblox.com/users/${userId}/inventory)`, inline: true },
      { name: "Moderation reason", value: ban?.reason || "No active restriction.", inline: false },
      { name: `Staff record • ${history.length} action(s)`, value: latestText, inline: false },
    )
    .setFooter({ text: "TWF Mod • All game actions are logged, confirmed, and applied live" })
    .setTimestamp();
  if (data?.avatar) embed.setThumbnail(data.avatar);
  return { embeds: [embed], components: [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:ban:${userId}`).setLabel("🛡️ Restrict").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`twf:tempban:${userId}`).setLabel("⏱️ Timed Restrict").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`twf:unban:${userId}`).setLabel("✅ Restore").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:history:${userId}`).setLabel("📚 Case File").setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:gift:${userId}`).setLabel("✨ Unlock").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:revoke:${userId}`).setLabel("🗝️ Lock").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`twf:gifts:${userId}`).setLabel("🧬 Entitlements").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`twf:refresh:${userId}`).setLabel("⟳ Live Refresh").setStyle(ButtonStyle.Secondary)),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:coins_add:${userId}`).setLabel("💎 Credit").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:coins_remove:${userId}`).setLabel("🧾 Debit").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`twf:coins_set:${userId}`).setLabel("⚖️ Balance").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setLabel("↗ Roblox Profile").setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${userId}/profile`)),
  ] };
}

function modal(action, userId) {
  const titles = { grant: "Gift TWF Character", revoke: "Revoke TWF Character", ban: "Permanently Ban Roblox User", tempban: "Temp Ban Roblox User", coins_add: "Add TWF Coins", coins_remove: "Remove TWF Coins", coins_set: "Set TWF Coin Balance" }, form = new ModalBuilder().setCustomId(`twf:submit:${action}:${userId}`).setTitle(titles[action]);
  if (["grant", "revoke"].includes(action)) form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("character").setLabel("TWF character name").setPlaceholder("Example: Sabrina Morningstar").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
  else if (["coins_add", "coins_remove", "coins_set"].includes(action)) form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("amount").setLabel("Coin amount").setPlaceholder("Example: 15000").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(9)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Staff note").setPlaceholder("Optional note for the audit log").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(200)));
  else { form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason").setPlaceholder("Explain why this action is needed").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))); if (action === "tempban") form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duration").setLabel("Length — use 30m, 1h, 7d, or 1w").setPlaceholder("Example: 1d").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5))); }
  return form;
}
function gift(action, userId, character, issuedBy) { if (!validUserId(userId) || !character || character.length > 80) return { error: "Use a numeric Roblox ID and a valid character name." }; const command = enqueue({ action, userId, character, issuedBy }); addHistory(userId, { action: action === "grant" ? `Gifted ${character}` : `Revoked ${character}`, issuedBy }); return { command }; }
function moderate(action, userId, reason, durationSeconds, issuedBy) { if (!validUserId(userId) || !reason) return { error: "Use a numeric Roblox ID and give a reason." }; const expiresAt = durationSeconds ? Date.now() + durationSeconds * 1000 : 0; enqueue({ action, userId, reason, durationSeconds, issuedBy }); if (action === "unban") setModeration(userId, null); else setModeration(userId, { reason, issuedBy, createdAt: Date.now(), expiresAt }); addHistory(userId, { action: action === "ban" ? "Permanent ban" : action === "tempban" ? `Temp ban (${durationText(durationSeconds)})` : "Unbanned", reason, issuedBy }); return {}; }
function historyCard(userId, characterOnly = false) { const entries = getHistory(userId).filter((entry) => !characterOnly || /^(Gifted|Revoked) /.test(entry.action)); const text = entries.length ? entries.map((entry) => `• <t:${Math.floor(entry.at / 1000)}:R> — **${entry.action}**\n  ${entry.reason ? `${entry.reason} • ` : ""}${entry.issuedBy}`).join("\n") : characterOnly ? "No character gifts or revokes recorded." : "No staff history recorded."; return new EmbedBuilder().setColor(0x5865f2).setTitle(`TWF ${characterOnly ? "Character" : "Mod"} History • ${userId}`).setDescription(text).setFooter({ text: "TWF Mod" }); }
function rolesCard(guild) { const roles = getAllowedRoles(defaultRoleIds).map((id) => guild?.roles.cache.get(id) ? `<@&${id}>` : `Unknown role (\`${id}\`)`); return new EmbedBuilder().setColor(0x5865f2).setTitle("TWF Mod Staff Roles").setDescription(roles.length ? roles.map((role, index) => `${index + 1}. ${role}`).join("\n") : "No staff roles can currently use TWF Mod.").setFooter({ text: "Only the Discord server owner or BOT_OWNER_ID can change these roles." }); }
function auditCard() { const entries = getAudit(25); const text = entries.length ? entries.map((entry) => `• <t:${Math.floor(entry.at / 1000)}:R> — **${entry.action}**\n  By ${entry.issuedBy}${entry.target ? ` • Target: ${entry.target}` : ""}${entry.details ? `\n  ${entry.details}` : ""}`).join("\n") : "No bot actions have been recorded yet."; return new EmbedBuilder().setColor(0xf1c40f).setTitle("TWF Mod Audit Log").setDescription(text).setFooter({ text: "Shows the latest 25 bot actions" }).setTimestamp(); }
function permissionsCard(guild) {
  const config = getCommandPermissions(defaultRoleIds);
  const format = (entries, type) => Object.entries(entries).map(([id, permissions]) => `${type === "role" ? (guild?.roles.cache.get(id) ? `<@&${id}>` : `Role \`${id}\``) : `<@${id}>`}\n${permissions.map((item) => permissionNames[item] || item).join(" • ")}`).join("\n\n") || "None configured.";
  return new EmbedBuilder().setColor(0x8e44ad).setTitle("⚙️ TWF Mod Permission Centre").setDescription("Owners can give a specific role or user only the actions they need. `👑 Everything` grants full access.").addFields({ name: "Role permissions", value: trim(format(config.roles, "role"), 1024), inline: false }, { name: "User overrides", value: trim(format(config.users, "user"), 1024), inline: false }).setFooter({ text: "Use /twf permissions-role or /twf permissions-user to edit access." }).setTimestamp();
}
function helpCard() { return new EmbedBuilder().setColor(0x5865f2).setTitle("✨ TWF Mod • Staff Guide").setDescription("A live Discord control centre for The Witches Fate. Every game-changing action is confirmed and recorded.").addFields({ name: "🛡️ Player moderation", value: "`/twf mod` • profile, ban, temp-ban, unban, history", inline: false }, { name: "🎭 Character access", value: "`/twf gift` • `/twf revoke` • `/twf character-list`", inline: false }, { name: "🪙 Economy", value: "`/twf coins-add` • `/twf coins-remove` • `/twf coins-set` • coin-code commands", inline: false }, { name: "⚙️ Staff setup", value: "`/twf permissions-list` • `/twf permissions-role` • `/twf permissions-user` • `/twf audit`", inline: false }).setFooter({ text: "TWF Mod • actions apply in game within seconds" }).setTimestamp(); }
function statusCard(interaction) { const available = Object.keys(permissionNames).filter((key) => key !== "all" && authorized(interaction, key)).map((key) => permissionNames[key]); const storage = storageStatus(); return new EmbedBuilder().setColor(storage.persistentConfigured ? 0x57f287 : 0xfaa61a).setTitle("🟢 TWF Mod System Status").setDescription("Discord bot is online and connected to the TWF command bridge.").addFields({ name: "Your access", value: botOwner(interaction) ? "👑 Server owner / bot owner — full access" : available.length ? available.join("\n") : "No TWF Mod permissions", inline: false }, { name: "Safety", value: "✅ Confirmations • ✅ Audit logging • ✅ One-time live game actions", inline: false }, { name: "Permission storage", value: storage.persistentConfigured ? "✅ Persistent storage configured — role permissions survive restarts." : "⚠️ Temporary local storage — set `TWF_DATA_DIR` to a persistent disk before relying on role permissions.", inline: false }).setTimestamp(); }
function charactersCard() { return new EmbedBuilder().setColor(0xff4da6).setTitle(`🎭 TWF Character Gift Directory • ${TWF_CHARACTERS.length}`).setDescription(TWF_CHARACTERS.map((name) => `• ${name}`).join("\n")).setFooter({ text: "Use /twf gift with a Roblox ID and character name. Scarlet Sheila is custom-only." }).setTimestamp(); }

function confirmCard(record, title, description, fields, danger = false) {
  const token = crypto.randomBytes(12).toString("hex"); record.expiresAt = Date.now() + 300000; pendingActions.set(token, record);
  const embed = new EmbedBuilder().setColor(danger ? 0xed4245 : 0x57f287).setTitle(title).setDescription(description).addFields(...fields, { name: "Requested by", value: record.issuedBy, inline: false }).setFooter({ text: "Confirm within 5 minutes • The game applies it within a few seconds" }).setTimestamp();
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:confirm:${token}`).setLabel(danger ? "Confirm Action" : "Confirm").setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:cancel:${token}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary))] };
}
function beginCharacterAction(action, userId, character, issuedBy) { if (!validUserId(userId) || !character || character.length > 80) return { error: "Use a numeric Roblox ID and a valid character name." }; const isGift = action === "grant"; return confirmCard({ type: "character", action, userId, character, issuedBy }, isGift ? "Confirm Character Gift" : "Confirm Character Revoke", isGift ? "This permanently gives the selected character through the TWF control-panel grant system." : "This permanently removes the selected gifted character from this player.", [{ name: "Recipient", value: `Roblox ID: \`${userId}\`\n[Open Roblox profile](https://www.roblox.com/users/${userId}/profile)`, inline: true }, { name: "Character", value: `**${character}**`, inline: true }], !isGift); }
function beginCoinAction(action, userId, amount, reason, issuedBy) { if (!validUserId(userId) || !Number.isInteger(amount) || amount < 0 || amount > 100000000) return { error: "Use a numeric Roblox ID and an amount from 0 to 100,000,000." }; const names = { coins_add: "Add Coins", coins_remove: "Remove Coins", coins_set: "Set Coin Balance" }; const danger = action === "coins_remove" || action === "coins_set"; return confirmCard({ type: "coins", action, userId, amount, reason, issuedBy }, `Confirm: ${names[action]}`, action === "coins_add" ? "This adds coins to the player's saved TWF balance." : action === "coins_remove" ? "This removes coins from the player's saved TWF balance, never below zero." : "This replaces the player's saved TWF coin balance with this exact amount.", [{ name: "Recipient", value: `Roblox ID: \`${userId}\``, inline: true }, { name: "Amount", value: `**${amount.toLocaleString()} coins**`, inline: true }, { name: "Staff note", value: reason || "No note provided.", inline: false }], danger); }
function beginCodeAction(action, code, amount, maxUses, expiresMinutes, issuedBy) { const cleanCode = String(code || "").trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,24}$/.test(cleanCode)) return { error: "Code must be 3-24 letters, numbers, `_`, or `-`." }; if (action === "code_create" && (!Number.isInteger(amount) || amount < 1 || amount > 100000000 || !Number.isInteger(maxUses) || maxUses < 0 || maxUses > 1000000 || !Number.isInteger(expiresMinutes) || expiresMinutes < 0 || expiresMinutes > 525600)) return { error: "Use valid coin, use-limit, and expiry amounts." }; const creating = action === "code_create"; return confirmCard({ type: "code", action, code: cleanCode, amount, maxUses, expiresMinutes, issuedBy }, creating ? "Confirm Coin Code" : "Confirm Disable Coin Code", creating ? "This creates a permanent redeemable code. Each player can claim it once." : "This disables this code immediately and cannot be undone.", creating ? [{ name: "Code", value: `\`${cleanCode}\``, inline: true }, { name: "Reward", value: `**${amount.toLocaleString()} coins**`, inline: true }, { name: "Uses", value: maxUses === 0 ? "Unlimited" : `${maxUses.toLocaleString()} total`, inline: true }, { name: "Expiry", value: expiresMinutes === 0 ? "Never" : `${expiresMinutes.toLocaleString()} minutes`, inline: true }] : [{ name: "Code", value: `\`${cleanCode}\``, inline: true }], !creating); }
function completedAction(record) { if (record.type === "character") { const result = gift(record.action, record.userId, record.character, record.issuedBy); if (result.error) return { content: result.error, components: [] }; const verb = record.action === "grant" ? "Gifted" : "Revoked"; return { embeds: [new EmbedBuilder().setColor(record.action === "grant" ? 0x57f287 : 0xed4245).setTitle(`Character ${verb}`).setDescription(`**${record.character}** has been ${verb.toLowerCase()} for Roblox user \`${record.userId}\`.\n\nThe game updates their character menu automatically (normally within one second).`).setFooter({ text: `TWF Mod • ${record.issuedBy}` }).setTimestamp()], components: [] }; } enqueue({ action: record.action, userId: record.userId || "0", amount: record.amount, code: record.code, maxUses: record.maxUses, expiresMinutes: record.expiresMinutes, reason: record.reason, issuedBy: record.issuedBy }); const label = record.type === "coins" ? `${record.action.replace("coins_", "").replace(/^./, (c) => c.toUpperCase())} ${record.amount.toLocaleString()} coins` : record.action === "code_create" ? `Created coin code ${record.code}` : `Disabled coin code ${record.code}`; addHistory(record.userId || "system", { action: label, reason: record.reason, issuedBy: record.issuedBy }); return { embeds: [new EmbedBuilder().setColor(record.action.includes("remove") || record.action.includes("disable") ? 0xed4245 : 0x57f287).setTitle("TWF Action Queued").setDescription(`**${label}** has been sent to the game and will apply within a few seconds.`).setFooter({ text: `TWF Mod • ${record.issuedBy}` }).setTimestamp()], components: [] }; }

app.get("/health", (_request, response) => response.json({ ok: true }));
app.get("/api/roblox/character-commands", (request, response) => { if (request.get("x-bridge-secret") !== process.env.BRIDGE_SECRET) return response.status(401).json({ error: "Unauthorized" }); response.set("Cache-Control", "no-store"); response.json({ commands: activeCommands() }); });
app.post("/api/roblox/character-commands/:id/claim", (request, response) => {
  if (request.get("x-bridge-secret") !== process.env.BRIDGE_SECRET) return response.status(401).json({ error: "Unauthorized" });
  const command = claimCommand(request.params.id, request.get("x-bridge-claim"));
  if (!command) return response.status(409).json({ ok: false });
  response.set("Cache-Control", "no-store");
  return response.json({ ok: true, command });
});
app.post("/api/roblox/character-commands/:id/ack", (request, response) => {
  if (request.get("x-bridge-secret") !== process.env.BRIDGE_SECRET) return response.status(401).json({ error: "Unauthorized" });
  if (!acknowledgeCommand(request.params.id, request.get("x-bridge-claim"))) return response.status(409).json({ ok: false });
  return response.json({ ok: true });
});
client.once(Events.ClientReady, (ready) => console.log(`TWF Mod ready as ${ready.user.tag}`));
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) { if (interaction.commandName !== "fate" || !authorized(interaction, "characters")) return interaction.respond([]); const focused = interaction.options.getFocused().toLowerCase(); return interaction.respond(TWF_CHARACTERS.filter((character) => character.toLowerCase().includes(focused)).slice(0, 25).map((character) => ({ name: character, value: character }))); }
  if (interaction.isButton()) {
    const [, action, value] = interaction.customId.split(":");
    if (["confirm", "cancel"].includes(action)) { const record = pendingActions.get(value), permission = record?.type === "character" ? "characters" : record?.type === "coins" ? "coins" : record?.type === "code" ? "codes" : "mod"; if (!authorized(interaction, permission)) return interaction.reply({ content: "You do not have permission for this TWF Mod action.", ephemeral: true }); if (!record || record.expiresAt <= Date.now()) return interaction.update({ content: "This staff action expired. Please start it again.", embeds: [], components: [] }); if (record.issuedBy !== staff(interaction)) return interaction.reply({ content: "Only the staff member who started this action can confirm it.", ephemeral: true }); pendingActions.delete(value); if (action === "cancel") { audit(interaction, "Cancelled pending action", record.userId || record.code, record.action); return interaction.update({ content: "Staff action cancelled.", embeds: [], components: [] }); } audit(interaction, record.action, record.userId || record.code, record.character || record.code || (record.amount ? `${record.amount} coins` : "")); return interaction.update(completedAction(record)); }
    const buttonPermission = (["gift", "revoke", "gifts"].includes(action) ? "characters" : action.startsWith("coins_") ? "coins" : action === "history" ? "audit" : "mod");
    if (!authorized(interaction, buttonPermission)) return interaction.reply({ content: "You do not have permission for this TWF Mod action.", ephemeral: true });
    const userId = value;
    if (action === "history") return interaction.reply({ embeds: [historyCard(userId)], ephemeral: true });
    if (action === "gifts") return interaction.reply({ embeds: [historyCard(userId, true)], ephemeral: true });
    if (action === "refresh") { await interaction.deferUpdate(); let data = null; try { data = await robloxProfile(userId); } catch {} return interaction.editReply(modCard(userId, data)); }
    if (["gift", "revoke", "ban", "tempban", "coins_add", "coins_remove", "coins_set"].includes(action)) return interaction.showModal(modal(action === "gift" ? "grant" : action === "revoke" ? "revoke" : action, userId));
    if (action === "unban") { moderate("unban", userId, "Unbanned by TWF staff", 0, staff(interaction)); audit(interaction, "unban", userId, "Unbanned from TWF"); return interaction.reply({ content: `Roblox user **${userId}** has been unbanned in TWF.`, ephemeral: true }); }
    return;
  }
  if (interaction.isModalSubmit()) {
    const [, , action, userId] = interaction.customId.split(":");
    const modalPermission = ["grant", "revoke"].includes(action) ? "characters" : action.startsWith("coins_") ? "coins" : "mod";
    if (!authorized(interaction, modalPermission)) return interaction.reply({ content: "You do not have permission for this TWF Mod action.", ephemeral: true });
    if (["grant", "revoke"].includes(action)) { const pending = beginCharacterAction(action, userId, interaction.fields.getTextInputValue("character").trim(), staff(interaction)); return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true }); }
    if (["coins_add", "coins_remove", "coins_set"].includes(action)) {
      const amount = Number(interaction.fields.getTextInputValue("amount").trim()), reason = interaction.fields.getTextInputValue("reason").trim();
      const pending = beginCoinAction(action, userId, amount, reason, staff(interaction));
      return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true });
    }
    const reason = interaction.fields.getTextInputValue("reason").trim(), seconds = action === "tempban" ? parseDuration(interaction.fields.getTextInputValue("duration")) : 0;
    if (action === "tempban" && !seconds) return interaction.reply({ content: "Use a length like `30m`, `1h`, `7d`, or `1w`.", ephemeral: true });
    const result = moderate(action, userId, reason, seconds, staff(interaction)); if (!result.error) audit(interaction, action, userId, reason); return interaction.reply({ content: result.error || `${action === "ban" ? "Banned" : "Temp banned"} Roblox user **${userId}**${seconds ? ` for **${durationText(seconds)}**` : ""}.`, ephemeral: true });
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "fate") return;
  const rawSub = interaction.options.getSubcommand();
  const sub = ({ profile: "mod", unlock: "gift", lock: "revoke", credit: "coins-add", debit: "coins-remove", balance: "coins-set", "voucher-create": "code-create", "voucher-close": "code-disable", roles: "roles-list", "role-allow": "roles-add", "role-remove": "roles-remove", access: "permissions-list", "access-role": "permissions-role", "access-member": "permissions-user", roster: "character-list", activity: "audit", overview: "status", guide: "help", pulse: "ping" })[rawSub] || rawSub;
  if (sub === "ping") return interaction.reply({ content: "TWF Mod is online.", ephemeral: true });
  if (sub === "help") return interaction.reply({ embeds: [helpCard()], ephemeral: true });
  if (sub === "status") return interaction.reply({ embeds: [statusCard(interaction)], ephemeral: true });
  if (["roles-list", "roles-add", "roles-remove", "permissions-list", "permissions-role", "permissions-user"].includes(sub)) {
    if (!botOwner(interaction)) return interaction.reply({ content: "Only the Discord server owner or the BOT_OWNER_ID account can manage TWF Mod roles.", ephemeral: true });
    if (sub === "permissions-list") return interaction.reply({ embeds: [permissionsCard(interaction.guild)], ephemeral: true });
    if (sub === "permissions-role") { const role = interaction.options.getRole("role", true), command = interaction.options.getString("command", true), enabled = interaction.options.getBoolean("enabled", true), permissions = setRoleCommandPermission(role.id, command, enabled, defaultRoleIds); audit(interaction, enabled ? "Granted role permission" : "Removed role permission", role.id, `${role.name} • ${permissionNames[command]}`); return interaction.reply({ content: `${enabled ? "✅ Granted" : "🗑️ Removed"} **${permissionNames[command]}** ${enabled ? "for" : "from"} ${role}.\nCurrent: ${permissions.map((item) => permissionNames[item]).join(" • ") || "No access"}`, embeds: [permissionsCard(interaction.guild)], ephemeral: true }); }
    if (sub === "permissions-user") { const user = interaction.options.getUser("user", true), command = interaction.options.getString("command", true), enabled = interaction.options.getBoolean("enabled", true), permissions = setUserCommandPermission(user.id, command, enabled, defaultRoleIds); audit(interaction, enabled ? "Granted user permission" : "Removed user permission", user.id, `${user.username} • ${permissionNames[command]}`); return interaction.reply({ content: `${enabled ? "✅ Granted" : "🗑️ Removed"} **${permissionNames[command]}** ${enabled ? "for" : "from"} ${user}.\nCurrent: ${permissions.map((item) => permissionNames[item]).join(" • ") || "No access"}`, embeds: [permissionsCard(interaction.guild)], ephemeral: true }); }
    if (sub === "roles-list") return interaction.reply({ embeds: [rolesCard(interaction.guild)], ephemeral: true });
    const role = interaction.options.getRole("role", true);
    const roles = sub === "roles-add" ? addAllowedRole(role.id, defaultRoleIds) : removeAllowedRole(role.id, defaultRoleIds);
    audit(interaction, sub, role.id, `${role.name} • ${roles.length} allowed role(s)`);
    return interaction.reply({ content: sub === "roles-add" ? `✅ ${role} can now use TWF Mod.` : `✅ ${role} can no longer use TWF Mod.`, embeds: [rolesCard(interaction.guild)], ephemeral: true });
  }
  if (sub === "audit") {
    if (!authorized(interaction, "audit")) return interaction.reply({ content: "You do not have permission to view the TWF Mod audit log.", ephemeral: true });
    audit(interaction, "viewed audit log");
    return interaction.reply({ embeds: [auditCard()], ephemeral: true });
  }
  if (!authorized(interaction, permissionForSubcommand(sub))) return interaction.reply({ content: "You do not have permission for this TWF Mod command.", ephemeral: true });
  if (sub === "character-list") return interaction.reply({ embeds: [charactersCard()], ephemeral: true });
  if (["code-create", "code-disable"].includes(sub)) {
    const code = interaction.options.getString("code", true), issuedBy = staff(interaction);
    const pending = sub === "code-create" ? beginCodeAction("code_create", code, interaction.options.getInteger("amount", true), interaction.options.getInteger("max_uses", true), interaction.options.getInteger("expires_minutes", true), issuedBy) : beginCodeAction("code_disable", code, 0, 0, 0, issuedBy);
    return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true });
  }
  const robloxTarget = interaction.options.getString("roblox_user", true).trim();
  const userId = await resolveRobloxUserId(robloxTarget);
  if (!userId) return interaction.reply({ content: "Enter a valid Roblox username or numeric user ID.", ephemeral: true });
  if (sub === "mod") { await interaction.deferReply(); let data = null; try { data = await robloxProfile(userId); } catch {} audit(interaction, "opened mod panel", userId); return interaction.editReply(modCard(userId, data)); }
  if (["coins-add", "coins-remove", "coins-set"].includes(sub)) {
    const action = `coins_${sub.slice(6)}`, amount = interaction.options.getInteger("amount", true), reason = interaction.options.getString("reason")?.trim() || "";
    const pending = beginCoinAction(action, userId, amount, reason, staff(interaction));
    return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true });
  }
  const pending = beginCharacterAction(sub === "gift" ? "grant" : "revoke", userId, interaction.options.getString("character", true).trim(), staff(interaction));
  return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true });
});
app.listen(Number(process.env.PORT || 3000), () => console.log(`TWF bridge HTTP API listening on port ${process.env.PORT || 3000}`));
await client.login(process.env.DISCORD_TOKEN);
