import { describe, it, expect } from "vitest";
import {
  unitToObjectPath,
  parseBusctlString,
  parseSystemctlShow,
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

describe("parseSystemctlShow", () => {
  it("parses typical systemctl show output", () => {
    const stdout = [
      "ActiveState=active",
      "SubState=running",
      "Description=Nginx Web Server",
      "",
    ].join("\n");

    const result = parseSystemctlShow(stdout);
    expect(result).toEqual({
      activeState: "active",
      subState: "running",
      description: "Nginx Web Server",
    });
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
    expect(result).toEqual({
      activeState: "unknown",
      subState: "unknown",
      description: "",
    });
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
});
