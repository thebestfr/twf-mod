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
export function activeCommands() { const commands = read("commands.json", []).filter((entry) => entry.expiresAt > Date.now()); write("commands.json", commands); return commands; }
export function moderationStatus(userId) { const all = read("moderation.json", {}); const record = all[String(userId)]; if (record?.expiresAt && record.expiresAt <= Date.now()) { delete all[String(userId)]; write("moderation.json", all); return null; } return record || null; }
export function setModeration(userId, record) { const all = read("moderation.json", {}); if (record) all[String(userId)] = record; else delete all[String(userId)]; write("moderation.json", all); }
export function addHistory(userId, entry) { const all = read("history.json", {}); const key = String(userId); const records = Array.isArray(all[key]) ? all[key] : []; records.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry }); all[key] = records.slice(0, 25); write("history.json", all); }
export function getHistory(userId) { const all = read("history.json", {}); return Array.isArray(all[String(userId)]) ? all[String(userId)] : []; }
export function getAllowedRoles(defaultRoleIds = []) { const config = read("role-permissions.json", null); if (config && Array.isArray(config.roles)) return config.roles.map(String); const roles = [...new Set(defaultRoleIds.map(String).filter(Boolean))]; write("role-permissions.json", { roles }); return roles; }
export function addAllowedRole(roleId, defaultRoleIds = []) { const roles = new Set(getAllowedRoles(defaultRoleIds)); roles.add(String(roleId)); write("role-permissions.json", { roles: [...roles] }); return [...roles]; }
export function removeAllowedRole(roleId, defaultRoleIds = []) { const roles = new Set(getAllowedRoles(defaultRoleIds)); roles.delete(String(roleId)); write("role-permissions.json", { roles: [...roles] }); return [...roles]; }
export function addAudit(entry) { const records = read("audit.json", []); records.unshift({ id: crypto.randomUUID(), at: Date.now(), ...entry }); write("audit.json", records.slice(0, 300)); }
export function getAudit(limit = 25) { return read("audit.json", []).slice(0, Math.max(1, Math.min(100, Number(limit) || 25))); }
