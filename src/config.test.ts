import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config.js";

function writeTempConfig(data: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "rsm-test-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(data));
  return path;
}

const VALID_CONFIG = {
  discordToken: "test-token",
  clientId: "123456789",
  services: [
    { alias: "Test Service", unit: "test.service" },
  ],
};

describe("loadConfig", () => {
  const tempFiles: string[] = [];

  afterEach(() => {
    for (const f of tempFiles) {
      try {
        unlinkSync(f);
      } catch {
        // ignore
      }
    }
    tempFiles.length = 0;
  });

  it("loads a valid minimal config", () => {
    const path = writeTempConfig(VALID_CONFIG);
    tempFiles.push(path);
    const config = loadConfig(path);

    expect(config.discordToken).toBe("test-token");
    expect(config.clientId).toBe("123456789");
    expect(config.services).toHaveLength(1);
    expect(config.services[0].alias).toBe("Test Service");
    expect(config.services[0].unit).toBe("test.service");
  });

  it("loads a config with all optional fields", () => {
    const data = {
      ...VALID_CONFIG,
      guildIds: ["guild1", "guild2"],
      allowedRoleIds: ["role1"],
      allowedUserIds: ["user1"],
      services: [
        { alias: "Svc A", unit: "a.service", description: "Service A" },
        { alias: "Svc B", unit: "b.service" },
      ],
    };
    const path = writeTempConfig(data);
    tempFiles.push(path);
    const config = loadConfig(path);

    expect(config.guildIds).toEqual(["guild1", "guild2"]);
    expect(config.allowedRoleIds).toEqual(["role1"]);
    expect(config.allowedUserIds).toEqual(["user1"]);
    expect(config.services).toHaveLength(2);
    expect(config.services[0].description).toBe("Service A");
    expect(config.services[1].description).toBeUndefined();
  });

  it("throws on missing file", () => {
    expect(() => loadConfig("/nonexistent/config.json")).toThrow(
      "Failed to read config file",
    );
  });

  it("throws on invalid JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "rsm-test-"));
    const path = join(dir, "config.json");
    writeFileSync(path, "not json{{{");
    tempFiles.push(path);

    expect(() => loadConfig(path)).toThrow("not valid JSON");
  });

  it("throws on missing required fields", () => {
    const path = writeTempConfig({ discordToken: "t" });
    tempFiles.push(path);

    expect(() => loadConfig(path)).toThrow("Invalid configuration");
  });

  it("throws on empty services array", () => {
    const path = writeTempConfig({
      ...VALID_CONFIG,
      services: [],
    });
    tempFiles.push(path);

    expect(() => loadConfig(path)).toThrow("Invalid configuration");
  });

  it("throws on duplicate aliases (case-insensitive)", () => {
    const path = writeTempConfig({
      ...VALID_CONFIG,
      services: [
        { alias: "My Service", unit: "a.service" },
        { alias: "my service", unit: "b.service" },
      ],
    });
    tempFiles.push(path);

    expect(() => loadConfig(path)).toThrow("Duplicate service aliases");
  });

  it("allows aliases that differ by case only to not be duplicates when truly different", () => {
    const path = writeTempConfig({
      ...VALID_CONFIG,
      services: [
        { alias: "Service A", unit: "a.service" },
        { alias: "Service B", unit: "b.service" },
      ],
    });
    tempFiles.push(path);

    const config = loadConfig(path);
    expect(config.services).toHaveLength(2);
  });
});
