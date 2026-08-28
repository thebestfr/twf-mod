import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const dataDir = path.resolve("data");
const file = (name) => path.join(dataDir, name);
function read(name, fallback) { fs.mkdirSync(dataDir, { recursive: true }); if (!fs.existsSync(file(name))) return fallback; try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return fallback; } }
function write(name, value) { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file(name), JSON.stringify(value, null, 2)); }

export function enqueue({ action, userId = "0", character = "", reason = "", durationSeconds = 0, amount = 0, code = "", maxUses = 0, expiresMinutes = 0, issuedBy }) {
  const commands = read("commands.json", []);
  const command = { id: crypto.randomUUID(), action, userId: String(userId), character: String(character).trim(), reason: String(reason).trim(), durationSeconds: Number(durationSeconds) || 0, amount: Number(amount) || 0, code: String(code).trim(), maxUses: Number(maxUses) || 0, expiresMinutes: Number(expiresMinutes) || 0, issuedBy: String(issuedBy), createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 };
  commands.push(command); write("commands.json", commands.filter((entry) => entry.expiresAt > Date.now())); return command;
}
function currentCommands() { return read("commands.json", []).filter((entry) => entry.expiresAt > Date.now()); }
export function activeCommands() {
  const commands = currentCommands();
  write("commands.json", commands);
  return commands.filter((entry) => !entry.claimedUntil || entry.claimedUntil <= Date.now());
}
// A command is leased to one Roblox server before it is applied. This prevents
// every active server from applying the same gift, coin change, or ban.
export function claimCommand(id, claimId) {
  const commands = currentCommands(), command = commands.find((entry) => entry.id === String(id));
  if (!command || !claimId || (command.claimedUntil > Date.now() && command.claimedBy !== String(claimId))) { write("commands.json", commands); return null; }
  command.claimedBy = String(claimId);
  command.claimedUntil = Date.now() + 30000;
  write("commands.json", commands);
  return command;
}
// Only the server that claimed a command may remove it once the game confirms
// the DataStore update succeeded.
export function acknowledgeCommand(id, claimId) {
  const commands = currentCommands(), index = commands.findIndex((entry) => entry.id === String(id));
  if (index < 0 || commands[index].claimedBy !== String(claimId)) { write("commands.json", commands); return false; }
  commands.splice(index, 1);
  write("commands.json", commands);
  return true;
}
export function moderationStatus(userId) { const all = read("moderation.json", {}); const record = all[String(userId)]; if (record?.expiresAt && record.expiresAt <= Date.now()) { delete all[String(userId)]; write("moderation.json", all); return null; } return record || null; }
export function setModeration(userId, record) { const all = read("moderation.json", {}); if (record) all[String(userId)] = record; else delete all[String(userId)]; write("moderation.json", all); }
export function addHistory(userId, entry) { const all = read("history.json", {}); const key = String(userId); const records = Array.isArray(all[key]) ? all[key] : []; records.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry }); all[key] = records.slice(0, 25); write("history.json", all); }
export function getHistory(userId) { const all = read("history.json", {}); return Array.isArray(all[String(userId)]) ? all[String(userId)] : []; }
export function getAllowedRoles(defaultRoleIds = []) { const config = read("role-permissions.json", null); if (config && Array.isArray(config.roles)) return config.roles.map(String); const roles = [...new Set(defaultRoleIds.map(String).filter(Boolean))]; write("role-permissions.json", { roles }); return roles; }
export function addAllowedRole(roleId, defaultRoleIds = []) { const roles = new Set(getAllowedRoles(defaultRoleIds)); roles.add(String(roleId)); write("role-permissions.json", { roles: [...roles] }); return [...roles]; }
export function removeAllowedRole(roleId, defaultRoleIds = []) { const roles = new Set(getAllowedRoles(defaultRoleIds)); roles.delete(String(roleId)); write("role-permissions.json", { roles: [...roles] }); const permissions = read("command-permissions.json", { roles: {}, users: {} }); if (permissions.roles) delete permissions.roles[String(roleId)]; write("command-permissions.json", permissions); return [...roles]; }
export const PERMISSION_KEYS = ["mod", "characters", "coins", "codes", "audit", "server", "all"];
function commandPermissions(defaultRoleIds = []) {
  const saved = read("command-permissions.json", { roles: {}, users: {} });
  const roles = saved.roles && typeof saved.roles === "object" ? saved.roles : {};
  const users = saved.users && typeof saved.users === "object" ? saved.users : {};
  // Existing allowed staff roles remain full-access until an owner changes them.
  for (const roleId of getAllowedRoles(defaultRoleIds)) if (!Array.isArray(roles[roleId])) roles[roleId] = ["all"];
  const config = { roles, users };
  write("command-permissions.json", config);
  return config;
}
function normalizedPermissions(values) { return [...new Set((Array.isArray(values) ? values : []).map(String).filter((value) => PERMISSION_KEYS.includes(value)))]; }
export function canUseCommand(userId, roleIds, command, defaultRoleIds = []) {
  const config = commandPermissions(defaultRoleIds), wanted = String(command);
  const allowed = (values) => { const list = normalizedPermissions(values); return list.includes("all") || list.includes(wanted); };
  if (allowed(config.users[String(userId)])) return true;
  return (Array.isArray(roleIds) ? roleIds : []).some((roleId) => allowed(config.roles[String(roleId)]));
}
export function setRoleCommandPermission(roleId, command, enabled, defaultRoleIds = []) {
  const config = commandPermissions(defaultRoleIds), id = String(roleId), values = new Set(normalizedPermissions(config.roles[id]));
  if (enabled) values.add(command); else values.delete(command);
  if (values.size) config.roles[id] = [...values]; else delete config.roles[id];
  write("command-permissions.json", config);
  return normalizedPermissions(config.roles[id]);
}
export function setUserCommandPermission(userId, command, enabled, defaultRoleIds = []) {
  const config = commandPermissions(defaultRoleIds), id = String(userId), values = new Set(normalizedPermissions(config.users[id]));
  if (enabled) values.add(command); else values.delete(command);
  if (values.size) config.users[id] = [...values]; else delete config.users[id];
  write("command-permissions.json", config);
  return normalizedPermissions(config.users[id]);
}
export function getCommandPermissions(defaultRoleIds = []) { return commandPermissions(defaultRoleIds); }
export function addAudit(entry) { const records = read("audit.json", []); records.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry }); write("audit.json", records.slice(0, 300)); }
export function getAudit(limit = 25) { return read("audit.json", []).slice(0, Math.max(1, Math.min(100, Number(limit) || 25))); }
