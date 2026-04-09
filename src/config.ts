import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Schema for a single whitelisted service entry.
 * Each entry maps a human-friendly alias to an actual systemd service name.
 */
const serviceEntrySchema = z.object({
  /** Human-friendly alias displayed in Discord (e.g. "Resonite Headless") */
  alias: z.string().min(1).max(100),
  /** Actual systemd unit name (e.g. "resonite-headless.service") */
  unit: z.string().min(1),
  /** Optional description shown in Discord command choices */
  description: z.string().optional(),
});

/**
 * Top-level configuration schema.
 */
const configSchema = z.object({
  /** Discord bot token */
  discordToken: z.string().min(1),
  /** Discord application (client) ID for registering slash commands */
  clientId: z.string().min(1),
  /**
   * Optional: restrict command usage to specific guild(s).
   * If omitted, commands are registered globally.
   */
  guildIds: z.array(z.string()).optional(),
  /**
   * Optional: restrict who can run service management commands.
   * If omitted, anyone who can see the commands can use them.
   * Specify Discord role IDs that are authorized.
   */
  allowedRoleIds: z.array(z.string()).optional(),
  /**
   * Optional: restrict commands to specific Discord user IDs.
   */
  allowedUserIds: z.array(z.string()).optional(),
  /**
   * Whitelisted services. Only these services can be managed via Discord.
   */
  services: z.array(serviceEntrySchema).min(1),
});

export type ServiceEntry = z.infer<typeof serviceEntrySchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * Load and validate configuration from a JSON file.
 * Looks for config.json in the project root by default.
 */
export function loadConfig(
  path: string = resolve(process.cwd(), "config.json"),
): Config {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read config file at ${path}: ${err instanceof Error ? err.message : err}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Config file at ${path} is not valid JSON`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  // Validate that aliases are unique
  const aliases = result.data.services.map((s) => s.alias.toLowerCase());
  const duplicates = aliases.filter((a, i) => aliases.indexOf(a) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate service aliases found: ${[...new Set(duplicates)].join(", ")}`,
    );
  }

  return result.data;
}
