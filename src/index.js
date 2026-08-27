import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, Events, GatewayIntentBits, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TWF_CHARACTERS } from "./characters.js";
import { activeCommands, addAllowedRole, addAudit, addHistory, enqueue, getAllowedRoles, getAudit, getHistory, moderationStatus, removeAllowedRole, setModeration } from "./store.js";

for (const name of ["DISCORD_TOKEN", "BRIDGE_SECRET"]) if (!process.env[name]) throw new Error(`Missing ${name} in .env.`);
const defaultRoleIds = (process.env.ALLOWED_ROLE_IDS || "").split(",").map((id) => id.trim()).filter(Boolean);
const pendingActions = new Map();
const app = express();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const validUserId = (value) => /^\d{1,20}$/.test(String(value));
const staff = (interaction) => `${interaction.user.username} (${interaction.user.id})`;
const trim = (text, length = 700) => text ? text.slice(0, length) : "No public description.";
function roleIds(interaction) { const roles = interaction.member?.roles; return roles?.cache ? roles.cache.map((role) => role.id) : Array.isArray(roles) ? roles : []; }
function authorized(interaction) { const allowed = new Set(getAllowedRoles(defaultRoleIds)); return roleIds(interaction).some((id) => allowed.has(id)); }
function botOwner(interaction) { return interaction.user.id === process.env.BOT_OWNER_ID || interaction.user.id === interaction.guild?.ownerId; }
function audit(interaction, action, target = "", details = "") { addAudit({ action, target: String(target), details: String(details), issuedBy: staff(interaction), issuedById: interaction.user.id }); }
function durationText(seconds) { if (!seconds) return "Permanent"; if (seconds % 86400 === 0) return `${seconds / 86400} day(s)`; if (seconds % 3600 === 0) return `${seconds / 3600} hour(s)`; return `${Math.ceil(seconds / 60)} minute(s)`; }
function parseDuration(text) { const match = String(text).trim().match(/^(\d{1,3})\s*([mhdw])$/i); return match ? Number(match[1]) * ({ m: 60, h: 3600, d: 86400, w: 604800 })[match[2].toLowerCase()] : null; }
async function robloxProfile(userId) { const response = await fetch(`https://users.roblox.com/v1/users/${userId}`); if (!response.ok) return null; const profile = await response.json(); const thumbnail = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png&isCircular=false`); const avatar = thumbnail.ok ? (await thumbnail.json()).data?.[0]?.imageUrl : null; return { profile, avatar }; }

function modCard(userId, data) {
  const profile = data?.profile, name = profile?.name || "Unknown Roblox User", display = profile?.displayName || name, created = profile?.created ? new Date(profile.created) : null, age = created ? Math.floor((Date.now() - created.getTime()) / 86400000) : null, ban = moderationStatus(userId), history = getHistory(userId), latest = history[0];
  const status = ban ? (ban.expiresAt ? `Temp banned until <t:${Math.floor(ban.expiresAt / 1000)}:R> 🔴` : "Permanently banned 🔴") : "Not banned 🟢";
  const embed = new EmbedBuilder().setColor(ban ? 0xed4245 : 0x71d7ce).setAuthor({ name: "TWF Mod • The Witches Fate" }).setTitle(display).setDescription(`**@${name}** • Roblox ID: \`${userId}\`\n${trim(profile?.description)}`).addFields({ name: "TWF Status", value: status, inline: true }, { name: "Roblox", value: `[Profile](https://www.roblox.com/users/${userId}/profile) • [Inventory](https://www.roblox.com/users/${userId}/inventory)`, inline: true }, { name: "Account", value: created ? `Created <t:${Math.floor(created.getTime() / 1000)}:D>\n${age.toLocaleString()} days old` : "Unavailable", inline: true }, { name: "Moderation reason", value: ban?.reason || "None", inline: false }, { name: "Staff history", value: latest ? `${history.length} action(s) • Latest: ${latest.action} by ${latest.issuedBy}` : "No staff actions recorded.", inline: false }).setFooter({ text: "TWF Mod • Game actions apply within a few seconds" }).setTimestamp();
  if (data?.avatar) embed.setThumbnail(data.avatar);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:ban:${userId}`).setLabel("Ban").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`twf:tempban:${userId}`).setLabel("Temp Ban").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`twf:unban:${userId}`).setLabel("Unban").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:history:${userId}`).setLabel("History").setStyle(ButtonStyle.Secondary)), new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`twf:gift:${userId}`).setLabel("Gift Character").setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`twf:revoke:${userId}`).setLabel("Revoke Character").setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId(`twf:gifts:${userId}`).setLabel("Character History").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`twf:refresh:${userId}`).setLabel("Refresh").setStyle(ButtonStyle.Secondary), new ButtonBuilder().setLabel("Roblox Profile").setStyle(ButtonStyle.Link).setURL(`https://www.roblox.com/users/${userId}/profile`))] };
}

function modal(action, userId) {
  const titles = { grant: "Gift TWF Character", revoke: "Revoke TWF Character", ban: "Permanently Ban Roblox User", tempban: "Temp Ban Roblox User" }, form = new ModalBuilder().setCustomId(`twf:submit:${action}:${userId}`).setTitle(titles[action]);
  if (["grant", "revoke"].includes(action)) form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("character").setLabel("TWF character name").setPlaceholder("Example: Sabrina Morningstar").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80)));
  else { form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reason").setLabel("Reason").setPlaceholder("Explain why this action is needed").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500))); if (action === "tempban") form.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("duration").setLabel("Length — use 30m, 1h, 7d, or 1w").setPlaceholder("Example: 1d").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5))); }
  return form;
}
function gift(action, userId, character, issuedBy) { if (!validUserId(userId) || !character || character.length > 80) return { error: "Use a numeric Roblox ID and a valid character name." }; const command = enqueue({ action, userId, character, issuedBy }); addHistory(userId, { action: action === "grant" ? `Gifted ${character}` : `Revoked ${character}`, issuedBy }); return { command }; }
function moderate(action, userId, reason, durationSeconds, issuedBy) { if (!validUserId(userId) || !reason) return { error: "Use a numeric Roblox ID and give a reason." }; const expiresAt = durationSeconds ? Date.now() + durationSeconds * 1000 : 0; enqueue({ action, userId, reason, durationSeconds, issuedBy }); if (action === "unban") setModeration(userId, null); else setModeration(userId, { reason, issuedBy, createdAt: Date.now(), expiresAt }); addHistory(userId, { action: action === "ban" ? "Permanent ban" : action === "tempban" ? `Temp ban (${durationText(durationSeconds)})` : "Unbanned", reason, issuedBy }); return {}; }
function historyCard(userId, characterOnly = false) { const entries = getHistory(userId).filter((entry) => !characterOnly || /^(Gifted|Revoked) /.test(entry.action)); const text = entries.length ? entries.map((entry) => `• <t:${Math.floor(entry.at / 1000)}:R> — **${entry.action}**\n  ${entry.reason ? `${entry.reason} • ` : ""}${entry.issuedBy}`).join("\n") : characterOnly ? "No character gifts or revokes recorded." : "No staff history recorded."; return new EmbedBuilder().setColor(0x5865f2).setTitle(`TWF ${characterOnly ? "Character" : "Mod"} History • ${userId}`).setDescription(text).setFooter({ text: "TWF Mod" }); }
function rolesCard(guild) { const roles = getAllowedRoles(defaultRoleIds).map((id) => guild?.roles.cache.get(id) ? `<@&${id}>` : `Unknown role (\`${id}\`)`); return new EmbedBuilder().setColor(0x5865f2).setTitle("TWF Mod Staff Roles").setDescription(roles.length ? roles.map((role, index) => `${index + 1}. ${role}`).join("\n") : "No staff roles can currently use TWF Mod.").setFooter({ text: "Only the Discord server owner or BOT_OWNER_ID can change these roles." }); }
function auditCard() { const entries = getAudit(25); const text = entries.length ? entries.map((entry) => `• <t:${Math.floor(entry.at / 1000)}:R> — **${entry.action}**\n  By ${entry.issuedBy}${entry.target ? ` • Target: ${entry.target}` : ""}${entry.details ? `\n  ${entry.details}` : ""}`).join("\n") : "No bot actions have been recorded yet."; return new EmbedBuilder().setColor(0xf1c40f).setTitle("TWF Mod Audit Log").setDescription(text).setFooter({ text: "Shows the latest 25 bot actions" }).setTimestamp(); }

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
client.once(Events.ClientReady, (ready) => console.log(`TWF Mod ready as ${ready.user.tag}`));
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) { if (interaction.commandName !== "twf" || !authorized(interaction)) return interaction.respond([]); const focused = interaction.options.getFocused().toLowerCase(); return interaction.respond(TWF_CHARACTERS.filter((character) => character.toLowerCase().includes(focused)).slice(0, 25).map((character) => ({ name: character, value: character }))); }
  if (interaction.isButton()) {
    if (!authorized(interaction)) return interaction.reply({ content: "You do not have permission to use TWF Mod.", ephemeral: true });
    const [, action, value] = interaction.customId.split(":");
    if (["confirm", "cancel"].includes(action)) { const record = pendingActions.get(value); if (!record || record.expiresAt <= Date.now()) return interaction.update({ content: "This staff action expired. Please start it again.", embeds: [], components: [] }); if (record.issuedBy !== staff(interaction)) return interaction.reply({ content: "Only the staff member who started this action can confirm it.", ephemeral: true }); pendingActions.delete(value); if (action === "cancel") { audit(interaction, "Cancelled pending action", record.userId || record.code, record.action); return interaction.update({ content: "Staff action cancelled.", embeds: [], components: [] }); } audit(interaction, record.action, record.userId || record.code, record.character || record.code || (record.amount ? `${record.amount} coins` : "")); return interaction.update(completedAction(record)); }
    const userId = value;
    if (action === "history") return interaction.reply({ embeds: [historyCard(userId)], ephemeral: true });
    if (action === "gifts") return interaction.reply({ embeds: [historyCard(userId, true)], ephemeral: true });
    if (action === "refresh") { await interaction.deferUpdate(); let data = null; try { data = await robloxProfile(userId); } catch {} return interaction.editReply(modCard(userId, data)); }
    if (["gift", "revoke", "ban", "tempban"].includes(action)) return interaction.showModal(modal(action === "gift" ? "grant" : action === "revoke" ? "revoke" : action, userId));
    if (action === "unban") { moderate("unban", userId, "Unbanned by TWF staff", 0, staff(interaction)); audit(interaction, "unban", userId, "Unbanned from TWF"); return interaction.reply({ content: `Roblox user **${userId}** has been unbanned in TWF.`, ephemeral: true }); }
    return;
  }
  if (interaction.isModalSubmit()) {
    if (!authorized(interaction)) return interaction.reply({ content: "You do not have permission to use TWF Mod.", ephemeral: true });
    const [, , action, userId] = interaction.customId.split(":");
    if (["grant", "revoke"].includes(action)) { const pending = beginCharacterAction(action, userId, interaction.fields.getTextInputValue("character").trim(), staff(interaction)); return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true }); }
    const reason = interaction.fields.getTextInputValue("reason").trim(), seconds = action === "tempban" ? parseDuration(interaction.fields.getTextInputValue("duration")) : 0;
    if (action === "tempban" && !seconds) return interaction.reply({ content: "Use a length like `30m`, `1h`, `7d`, or `1w`.", ephemeral: true });
    const result = moderate(action, userId, reason, seconds, staff(interaction)); if (!result.error) audit(interaction, action, userId, reason); return interaction.reply({ content: result.error || `${action === "ban" ? "Banned" : "Temp banned"} Roblox user **${userId}**${seconds ? ` for **${durationText(seconds)}**` : ""}.`, ephemeral: true });
  }
  if (!interaction.isChatInputCommand() || interaction.commandName !== "twf") return;
  const sub = interaction.options.getSubcommand();
  if (sub === "ping") return interaction.reply({ content: "TWF Mod is online.", ephemeral: true });
  if (["roles-list", "roles-add", "roles-remove"].includes(sub)) {
    if (!botOwner(interaction)) return interaction.reply({ content: "Only the Discord server owner or the BOT_OWNER_ID account can manage TWF Mod roles.", ephemeral: true });
    if (sub === "roles-list") return interaction.reply({ embeds: [rolesCard(interaction.guild)], ephemeral: true });
    const role = interaction.options.getRole("role", true);
    const roles = sub === "roles-add" ? addAllowedRole(role.id, defaultRoleIds) : removeAllowedRole(role.id, defaultRoleIds);
    audit(interaction, sub, role.id, `${role.name} • ${roles.length} allowed role(s)`);
    return interaction.reply({ content: sub === "roles-add" ? `✅ ${role} can now use TWF Mod.` : `✅ ${role} can no longer use TWF Mod.`, embeds: [rolesCard(interaction.guild)], ephemeral: true });
  }
  if (sub === "audit") {
    if (!authorized(interaction) && !botOwner(interaction)) return interaction.reply({ content: "You do not have permission to view the TWF Mod audit log.", ephemeral: true });
    audit(interaction, "viewed audit log");
    return interaction.reply({ embeds: [auditCard()], ephemeral: true });
  }
  if (!authorized(interaction)) return interaction.reply({ content: "You do not have permission to use TWF Mod.", ephemeral: true });
  if (["code-create", "code-disable"].includes(sub)) {
    const code = interaction.options.getString("code", true), issuedBy = staff(interaction);
    const pending = sub === "code-create" ? beginCodeAction("code_create", code, interaction.options.getInteger("amount", true), interaction.options.getInteger("max_uses", true), interaction.options.getInteger("expires_minutes", true), issuedBy) : beginCodeAction("code_disable", code, 0, 0, 0, issuedBy);
    return interaction.reply({ ...(pending.error ? { content: pending.error } : pending), ephemeral: true });
  }
  const userId = interaction.options.getString("roblox_user_id", true).trim();
  if (!validUserId(userId)) return interaction.reply({ content: "Use a numeric Roblox user ID.", ephemeral: true });
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
