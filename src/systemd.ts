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
 * Whether to use busctl instead of systemctl.
 *
 * In Docker environments the host D-Bus socket is mounted into the
 * container, but `systemctl` refuses to run because PID 1 is not
 * systemd.  `busctl` has no such restriction and talks to D-Bus
 * directly.
 *
 * Set the environment variable SYSTEMCTL_NO_SUDO=1 to enable this.
 */
const USE_DBUS = process.env["SYSTEMCTL_NO_SUDO"] === "1";

/** D-Bus socket path used by busctl in Docker mode */
const DBUS_SOCKET =
  process.env["DBUS_SYSTEM_BUS_ADDRESS"] ??
  "unix:path=/run/dbus/system_bus_socket";

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/**
 * Run `sudo systemctl <action> <unit>` on the host.
 */
async function runSystemctl(
  action: string,
  unit: string,
  extraArgs: string[] = [],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("sudo", ["systemctl", action, unit, ...extraArgs], {
    timeout: 30_000,
  });
}

/**
 * Run `busctl` with the mounted D-Bus socket.
 */
async function runBusctl(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(
    "busctl",
    args,
    {
      timeout: 30_000,
      env: { ...process.env, DBUS_SYSTEM_BUS_ADDRESS: DBUS_SOCKET },
    },
  );
}

/**
 * Read a single string property from a systemd unit object via D-Bus.
 *
 *   busctl get-property org.freedesktop.systemd1 <objectPath> \
 *     org.freedesktop.systemd1.Unit <property>
 *
 * Returns the unquoted string value.
 */
async function getUnitProperty(
  objectPath: string,
  property: string,
): Promise<string> {
  const { stdout } = await runBusctl([
    "get-property",
    "org.freedesktop.systemd1",
    objectPath,
    "org.freedesktop.systemd1.Unit",
    property,
  ]);
  // busctl output looks like: s "active"
  const match = stdout.match(/^s\s+"(.*)"\s*$/);
  return match ? match[1] : stdout.trim();
}

/**
 * Convert a systemd unit name to its D-Bus object path.
 *
 * systemd escapes unit names for D-Bus: every byte that is not [A-Za-z0-9]
 * is replaced with `_XX` where XX is the hex value.
 */
function unitToObjectPath(unit: string): string {
  const escaped = Array.from(unit)
    .map((ch) =>
      /[A-Za-z0-9]/.test(ch)
        ? ch
        : `_${ch.charCodeAt(0).toString(16).padStart(2, "0")}`,
    )
    .join("");
  return `/org/freedesktop/systemd1/unit/${escaped}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the current status of a systemd service.
 */
export async function getServiceStatus(
  service: ServiceEntry,
): Promise<ServiceStatus> {
  if (USE_DBUS) {
    return getServiceStatusViaDbus(service);
  }
  return getServiceStatusViaSystemctl(service);
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

  if (USE_DBUS) {
    return executeServiceActionViaDbus(service, action);
  }
  return executeServiceActionViaSystemctl(service, action);
}

// ---------------------------------------------------------------------------
// Host (systemctl + sudo)
// ---------------------------------------------------------------------------

async function getServiceStatusViaSystemctl(
  service: ServiceEntry,
): Promise<ServiceStatus> {
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
    console.error(`systemctl show failed for ${service.unit}:`, err);
    activeState = "error";
    subState = "error";
    description =
      err instanceof Error ? err.message : "Failed to query service";
  }

  let raw = "";
  try {
    const { stdout } = await runSystemctl("status", service.unit, [
      "--no-pager",
      "--lines=15",
    ]);
    raw = stdout;
  } catch (err: unknown) {
    // systemctl status returns exit code 3 for inactive services,
    // but still provides useful output on stdout
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

async function executeServiceActionViaSystemctl(
  service: ServiceEntry,
  action: ServiceAction,
): Promise<ActionResult> {
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

// ---------------------------------------------------------------------------
// Docker (busctl over mounted D-Bus socket)
// ---------------------------------------------------------------------------

/** Map CLI action names to systemd D-Bus method names */
const DBUS_METHODS: Record<string, string> = {
  start: "StartUnit",
  stop: "StopUnit",
  restart: "RestartUnit",
};

async function getServiceStatusViaDbus(
  service: ServiceEntry,
): Promise<ServiceStatus> {
  const objectPath = unitToObjectPath(service.unit);
  let activeState = "unknown";
  let subState = "unknown";
  let description = "";

  try {
    [activeState, subState, description] = await Promise.all([
      getUnitProperty(objectPath, "ActiveState"),
      getUnitProperty(objectPath, "SubState"),
      getUnitProperty(objectPath, "Description"),
    ]);
  } catch (err) {
    console.error(`busctl get-property failed for ${service.unit}:`, err);
    activeState = "error";
    subState = "error";
    description =
      err instanceof Error ? err.message : "Failed to query service";
  }

  // Build a pseudo status summary (busctl has no equivalent of
  // `systemctl status` with journal lines)
  const raw = `${service.unit} - ${description}\n  Active: ${activeState} (${subState})`;

  return { activeState, subState, description, raw };
}

async function executeServiceActionViaDbus(
  service: ServiceEntry,
  action: ServiceAction,
): Promise<ActionResult> {
  const method = DBUS_METHODS[action];
  if (!method) {
    return { success: false, message: `Invalid action: ${action}` };
  }

  try {
    // busctl call org.freedesktop.systemd1 /org/freedesktop/systemd1 \
    //   org.freedesktop.systemd1.Manager <Method> ss "<unit>" "replace"
    await runBusctl([
      "call",
      "org.freedesktop.systemd1",
      "/org/freedesktop/systemd1",
      "org.freedesktop.systemd1.Manager",
      method,
      "ss",
      service.unit,
      "replace",
    ]);
    return {
      success: true,
      message: `Successfully executed '${action}' on ${service.alias} (${service.unit})`,
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
