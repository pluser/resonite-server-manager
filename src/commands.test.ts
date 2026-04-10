import { describe, it, expect } from "vitest";
import { buildCommands, formatUptime } from "./commands.js";
import type { Config } from "./config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    discordToken: "test-token",
    clientId: "123456789",
    services: [
      { alias: "Resonite Headless", unit: "resonite-headless.service" },
      { alias: "Nginx", unit: "nginx.service", description: "Web server" },
    ],
    ...overrides,
  };
}

describe("buildCommands", () => {
  it("returns an array with one command", () => {
    const commands = buildCommands(makeConfig());
    expect(commands).toHaveLength(1);
  });

  it("builds a command named 'service'", () => {
    const commands = buildCommands(makeConfig());
    expect(commands[0].name).toBe("service");
  });

  it("includes all subcommands", () => {
    const commands = buildCommands(makeConfig());
    const options = commands[0].options;
    expect(options).toBeDefined();

    const subcommandNames = options!.map((opt) => opt.name);
    expect(subcommandNames).toContain("status");
    expect(subcommandNames).toContain("start");
    expect(subcommandNames).toContain("stop");
    expect(subcommandNames).toContain("restart");
    expect(subcommandNames).toContain("list");
  });

  it("includes service aliases as choices in action subcommands", () => {
    const config = makeConfig({
      services: [
        { alias: "Svc A", unit: "a.service" },
        { alias: "Svc B", unit: "b.service" },
      ],
    });
    const commands = buildCommands(config);
    const statusSub = commands[0].options!.find((o) => o.name === "status");
    expect(statusSub).toBeDefined();

    // The "name" option within the subcommand
    const nameOpt = (statusSub as { options?: { name: string; choices?: { name: string; value: string }[] }[] })
      .options?.find((o) => o.name === "name");
    expect(nameOpt).toBeDefined();
    expect(nameOpt!.choices).toEqual([
      { name: "Svc A", value: "Svc A" },
      { name: "Svc B", value: "Svc B" },
    ]);
  });

  it("list subcommand has no options", () => {
    const commands = buildCommands(makeConfig());
    const listSub = commands[0].options!.find((o) => o.name === "list");
    expect(listSub).toBeDefined();

    const listOptions = (listSub as { options?: unknown[] }).options;
    // list has no options (no "name" param)
    expect(listOptions ?? []).toHaveLength(0);
  });
});

describe("formatUptime", () => {
  // Helper: create a usec timestamp that is `ms` milliseconds before `now`
  function tsUsecAgo(ms: number, now: number): number {
    return (now - ms) * 1000;
  }

  const NOW = new Date("2026-04-11T03:10:00+09:00").getTime();

  it("formats seconds only", () => {
    const ts = tsUsecAgo(45_000, NOW); // 45 seconds ago
    expect(formatUptime(ts, NOW)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    const ts = tsUsecAgo(5 * 60_000 + 30_000, NOW); // 5m 30s
    expect(formatUptime(ts, NOW)).toBe("5m 30s");
  });

  it("formats hours, minutes, and seconds (drops seconds when hours present)", () => {
    const ts = tsUsecAgo(2 * 3600_000 + 15 * 60_000 + 10_000, NOW); // 2h 15m 10s
    expect(formatUptime(ts, NOW)).toBe("2h 15m");
  });

  it("formats days, hours, and minutes", () => {
    const ts = tsUsecAgo(3 * 86400_000 + 5 * 3600_000 + 30 * 60_000, NOW);
    expect(formatUptime(ts, NOW)).toBe("3d 5h 30m");
  });

  it("formats exactly 1 day", () => {
    const ts = tsUsecAgo(86400_000, NOW);
    expect(formatUptime(ts, NOW)).toBe("1d");
  });

  it("returns 0s for future timestamp", () => {
    const ts = (NOW + 10_000) * 1000; // 10s in the future
    expect(formatUptime(ts, NOW)).toBe("0s");
  });

  it("returns 0s for zero elapsed time", () => {
    const ts = NOW * 1000;
    expect(formatUptime(ts, NOW)).toBe("0s");
  });
});
