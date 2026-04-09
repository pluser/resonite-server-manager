import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ServiceEntry } from "./config.js";

const execFileAsync = promisify(execFile);

/** Allowed systemctl actions */
export type ServiceAction = "status" | "start" | "stop" | "restart";

const ALLOWED_ACTIONS: ReadonlySet<string> = new Set([
  "status",
  "start",
  "stop",
  "restart",
]);

export interface ServiceStatus {
  /** The systemd ActiveState (e.g. "active", "inactive", "failed") */
  activeState: string;
  /** The systemd SubState (e.g. "running", "dead", "exited") */
  subState: string;
  /** Human-readable status description */
  description: string;
  /** Full `systemctl status` output (truncated for embed) */
  raw: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  /** stderr output if any */
  stderr?: string;
}

/**
 * Whether to skip `sudo` when invoking systemctl.
 * In Docker environments where the host D-Bus socket is mounted,
 * the container runs as root and can call systemctl directly.
 * Set the environment variable SYSTEMCTL_NO_SUDO=1 to enable this.
 */
const NO_SUDO = process.env["SYSTEMCTL_NO_SUDO"] === "1";

/**
 * Execute a systemctl command.
 *
 * - Default (host): runs `sudo systemctl <action> <unit>`.
 *   Requires a sudoers entry for the bot user.
 * - Docker (SYSTEMCTL_NO_SUDO=1): runs `systemctl <action> <unit>` directly.
 *   Requires the host D-Bus socket to be mounted into the container.
 */
async function runSystemctl(
  action: string,
  unit: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  if (NO_SUDO) {
    return execFileAsync("systemctl", [action, unit, ...extraArgs], {
      timeout: 30_000,
      env: { ...process.env, DBUS_SYSTEM_BUS_ADDRESS: process.env["DBUS_SYSTEM_BUS_ADDRESS"] ?? "unix:path=/run/dbus/system_bus_socket" },
    });
  }
  return execFileAsync("sudo", ["systemctl", action, unit, ...extraArgs], {
    timeout: 30_000,
  });
}

/**
 * Get the current status of a systemd service.
 */
export async function getServiceStatus(
  service: ServiceEntry,
): Promise<ServiceStatus> {
  // Use `show` to get machine-readable properties
  let activeState = "unknown";
  let subState = "unknown";
  let description = "";

  try {
    const { stdout } = await runSystemctl("show", service.unit, [
      "--property=ActiveState,SubState,Description",
      "--no-pager",
    ]);

    for (const line of stdout.split("\n")) {
      const [key, ...rest] = line.split("=");
      const value = rest.join("=");
      switch (key) {
        case "ActiveState":
          activeState = value;
          break;
        case "SubState":
          subState = value;
          break;
        case "Description":
          description = value;
          break;
      }
    }
  } catch (err) {
    activeState = "error";
    subState = "error";
    description =
      err instanceof Error ? err.message : "Failed to query service";
  }

  // Also get the human-readable status output
  let raw = "";
  try {
    const { stdout } = await runSystemctl("status", service.unit, [
      "--no-pager",
      "--lines=15",
    ]);
    raw = stdout;
  } catch (err: unknown) {
    // systemctl status returns exit code 3 for inactive services,
    // but still provides useful output on stderr/stdout
    if (
      err &&
      typeof err === "object" &&
      "stdout" in err &&
      typeof (err as { stdout: unknown }).stdout === "string"
    ) {
      raw = (err as { stdout: string }).stdout;
    } else {
      raw =
        err instanceof Error ? err.message : "Failed to get status output";
    }
  }

  return { activeState, subState, description, raw };
}

/**
 * Execute a service action (start/stop/restart).
 */
export async function executeServiceAction(
  service: ServiceEntry,
  action: ServiceAction,
): Promise<ActionResult> {
  if (!ALLOWED_ACTIONS.has(action)) {
    return { success: false, message: `Invalid action: ${action}` };
  }

  if (action === "status") {
    return { success: false, message: "Use getServiceStatus() for status" };
  }

  try {
    const { stderr } = await runSystemctl(action, service.unit);
    return {
      success: true,
      message: `Successfully executed '${action}' on ${service.alias} (${service.unit})`,
      stderr: stderr || undefined,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : `Failed to ${action} service`;
    let stderr: string | undefined;
    if (
      err &&
      typeof err === "object" &&
      "stderr" in err &&
      typeof (err as { stderr: unknown }).stderr === "string"
    ) {
      stderr = (err as { stderr: string }).stderr;
    }
    return { success: false, message, stderr };
  }
}
