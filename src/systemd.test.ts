import { describe, it, expect } from "vitest";
import {
  unitToObjectPath,
  parseBusctlString,
  parseBusctlUint64,
  parseSystemctlShow,
  parseSystemdTimestamp,
} from "./systemd.js";

describe("unitToObjectPath", () => {
  it("escapes a simple service unit name", () => {
    expect(unitToObjectPath("nginx.service")).toBe(
      "/org/freedesktop/systemd1/unit/nginx_2eservice",
    );
  });

  it("escapes hyphens in unit names", () => {
    expect(unitToObjectPath("resonite-headless.service")).toBe(
      "/org/freedesktop/systemd1/unit/resonite_2dheadless_2eservice",
    );
  });

  it("escapes multiple special characters", () => {
    expect(unitToObjectPath("my-app@instance.service")).toBe(
      "/org/freedesktop/systemd1/unit/my_2dapp_40instance_2eservice",
    );
  });

  it("handles a unit name with only alphanumeric characters", () => {
    expect(unitToObjectPath("myapp")).toBe(
      "/org/freedesktop/systemd1/unit/myapp",
    );
  });

  it("escapes underscores", () => {
    expect(unitToObjectPath("my_app.service")).toBe(
      "/org/freedesktop/systemd1/unit/my_5fapp_2eservice",
    );
  });
});

describe("parseBusctlString", () => {
  it("parses a normal string property", () => {
    expect(parseBusctlString('s "active"\n')).toBe("active");
  });

  it("parses a string with spaces", () => {
    expect(parseBusctlString('s "Resonite Headless Server"\n')).toBe(
      "Resonite Headless Server",
    );
  });

  it("returns trimmed output for unexpected format", () => {
    expect(parseBusctlString("unexpected output")).toBe("unexpected output");
  });

  it("parses empty string value", () => {
    expect(parseBusctlString('s ""\n')).toBe("");
  });
});

describe("parseBusctlUint64", () => {
  it("parses a normal uint64 property", () => {
    expect(parseBusctlUint64("t 1712800000000000\n")).toBe(1712800000000000);
  });

  it("returns undefined for zero value", () => {
    expect(parseBusctlUint64("t 0\n")).toBeUndefined();
  });

  it("returns undefined for unexpected format", () => {
    expect(parseBusctlUint64('s "not a number"')).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseBusctlUint64("")).toBeUndefined();
  });
});

describe("parseSystemctlShow", () => {
  it("parses typical systemctl show output", () => {
    const stdout = [
      "ActiveState=active",
      "SubState=running",
      "Description=Nginx Web Server",
      "",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.activeState).toBe("active");
    expect(result.subState).toBe("running");
    expect(result.description).toBe("Nginx Web Server");
  });

  it("handles description containing equals sign", () => {
    const stdout = [
      "ActiveState=active",
      "SubState=running",
      "Description=App key=value config",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.description).toBe("App key=value config");
  });

  it("returns unknown for missing properties", () => {
    const result = parseSystemctlShow("");
    expect(result.activeState).toBe("unknown");
    expect(result.subState).toBe("unknown");
    expect(result.description).toBe("");
    expect(result.activeEnterTimestamp).toBeUndefined();
  });

  it("handles inactive service", () => {
    const stdout = [
      "ActiveState=inactive",
      "SubState=dead",
      "Description=My Service",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.activeState).toBe("inactive");
    expect(result.subState).toBe("dead");
  });

  it("handles failed service", () => {
    const stdout = [
      "ActiveState=failed",
      "SubState=failed",
      "Description=Broken Service",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.activeState).toBe("failed");
    expect(result.subState).toBe("failed");
  });

  it("parses ActiveEnterTimestamp", () => {
    const stdout = [
      "ActiveState=active",
      "SubState=running",
      "Description=Test",
      "ActiveEnterTimestamp=Fri 2026-04-11 00:00:00 JST",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.activeEnterTimestamp).toBeDefined();
    expect(result.activeEnterTimestamp).toBeGreaterThan(0);
  });

  it("returns undefined for empty ActiveEnterTimestamp", () => {
    const stdout = [
      "ActiveState=inactive",
      "SubState=dead",
      "Description=Test",
      "ActiveEnterTimestamp=",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result.activeEnterTimestamp).toBeUndefined();
  });
});

describe("parseSystemdTimestamp", () => {
  it("parses a typical systemd timestamp", () => {
    const ms = parseSystemdTimestamp("Fri 2026-04-11 00:00:00 JST");
    expect(ms).toBeDefined();
    // Verify it's a reasonable date (April 2026)
    const date = new Date(ms!);
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(3); // 0-indexed, April = 3
    expect(date.getDate()).toBe(11);
  });

  it("parses timestamp with UTC timezone", () => {
    const ms = parseSystemdTimestamp("Thu 2025-01-01 12:00:00 UTC");
    expect(ms).toBeDefined();
    const date = new Date(ms!);
    expect(date.getFullYear()).toBe(2025);
  });

  it("returns undefined for empty string", () => {
    expect(parseSystemdTimestamp("")).toBeUndefined();
  });

  it("returns undefined for garbage input", () => {
    expect(parseSystemdTimestamp("not a timestamp")).toBeUndefined();
  });
});
