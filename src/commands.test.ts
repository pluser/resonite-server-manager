import { describe, it, expect } from "vitest";
import { buildCommands } from "./commands.js";
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
