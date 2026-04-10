import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import type { Config, ServiceEntry } from "./config.js";
import {
  getServiceStatus,
  executeServiceAction,
  type ServiceAction,
} from "./systemd.js";

/**
 * Build the slash command definitions based on the configured services.
 * Service aliases are exposed as choices in the "service" option.
 */
export function buildCommands(
  config: Config,
): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const serviceChoices = config.services.map((s) => ({
    name: s.alias,
    value: s.alias,
  }));

  const serviceCommand = new SlashCommandBuilder()
    .setName("service")
    .setDescription("Manage systemd services")
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check the status of a service")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Service to check")
            .setRequired(true)
            .addChoices(...serviceChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("start")
        .setDescription("Start a service")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Service to start")
            .setRequired(true)
            .addChoices(...serviceChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("stop")
        .setDescription("Stop a service")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Service to stop")
            .setRequired(true)
            .addChoices(...serviceChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("restart")
        .setDescription("Restart a service")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Service to restart")
            .setRequired(true)
            .addChoices(...serviceChoices),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all managed services"),
    );

  return [serviceCommand.toJSON()];
}

/** Color codes for embed status indicators */
const STATUS_COLORS = {
  active: 0x57f287, // Green
  inactive: 0x95a5a6, // Gray
  failed: 0xed4245, // Red
  activating: 0xfee75c, // Yellow
  deactivating: 0xfee75c, // Yellow
  unknown: 0x5865f2, // Blurple
} as const;

function getStatusColor(activeState: string): number {
  return (
    STATUS_COLORS[activeState as keyof typeof STATUS_COLORS] ??
    STATUS_COLORS.unknown
  );
}

function getStatusEmoji(activeState: string): string {
  switch (activeState) {
    case "active":
      return "\u{1F7E2}"; // green circle
    case "inactive":
      return "\u26AA"; // white circle
    case "failed":
      return "\u{1F534}"; // red circle
    case "activating":
    case "deactivating":
      return "\u{1F7E1}"; // yellow circle
    default:
      return "\u2753"; // question mark
  }
}

/**
 * Resolve a service alias from the config.
 */
function resolveService(
  config: Config,
  alias: string,
): ServiceEntry | undefined {
  return config.services.find(
    (s) => s.alias.toLowerCase() === alias.toLowerCase(),
  );
}

/**
 * Check if the user is authorized to run service management commands.
 */
function isAuthorized(
  interaction: ChatInputCommandInteraction,
  config: Config,
): boolean {
  // If no restrictions are configured, allow everyone
  if (!config.allowedRoleIds?.length && !config.allowedUserIds?.length) {
    return true;
  }

  // Check user ID allowlist
  if (config.allowedUserIds?.includes(interaction.user.id)) {
    return true;
  }

  // Check role allowlist
  if (config.allowedRoleIds?.length && interaction.member) {
    const memberRoles = interaction.member.roles;
    if (Array.isArray(memberRoles)) {
      // API mode: roles is string[]
      return memberRoles.some((r) => config.allowedRoleIds!.includes(r));
    } else {
      // GuildMemberRoleManager
      return config.allowedRoleIds.some((r) => memberRoles.cache.has(r));
    }
  }

  return false;
}

/**
 * Handle the /service command interaction.
 */
export async function handleServiceCommand(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  // "list" doesn't require authorization
  if (subcommand === "list") {
    await handleList(interaction, config);
    return;
  }

  // Authorization check for action commands
  if (!isAuthorized(interaction, config)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Access Denied")
          .setDescription(
            "You do not have permission to manage services.",
          )
          .setColor(0xed4245),
      ],
      ephemeral: true,
    });
    return;
  }

  const alias = interaction.options.getString("name", true);
  const service = resolveService(config, alias);

  if (!service) {
    await interaction.reply({
      content: `Unknown service: ${alias}`,
      ephemeral: true,
    });
    return;
  }

  switch (subcommand) {
    case "status":
      await handleStatus(interaction, service);
      break;
    case "start":
    case "stop":
    case "restart":
      await handleAction(interaction, service, subcommand as ServiceAction);
      break;
    default:
      await interaction.reply({
        content: `Unknown subcommand: ${subcommand}`,
        ephemeral: true,
      });
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  service: ServiceEntry,
): Promise<void> {
  await interaction.deferReply();

  const status = await getServiceStatus(service);
  const emoji = getStatusEmoji(status.activeState);

  const embed = new EmbedBuilder()
    .setTitle(`${emoji} ${service.alias}`)
    .setColor(getStatusColor(status.activeState))
    .addFields(
      {
        name: "Unit",
        value: `\`${service.unit}\``,
        inline: true,
      },
      {
        name: "State",
        value: `${status.activeState} (${status.subState})`,
        inline: true,
      },
    )
    .setTimestamp();

  if (status.description) {
    embed.setDescription(status.description);
  }

  // Add truncated raw output
  if (status.raw) {
    const truncated =
      status.raw.length > 1000
        ? status.raw.substring(0, 1000) + "\n..."
        : status.raw;
    embed.addFields({
      name: "Details",
      value: `\`\`\`\n${truncated}\n\`\`\``,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleAction(
  interaction: ChatInputCommandInteraction,
  service: ServiceEntry,
  action: ServiceAction,
): Promise<void> {
  await interaction.deferReply();

  const result = await executeServiceAction(service, action);

  if (result.success) {
    // After action, fetch current status
    const status = await getServiceStatus(service);
    const emoji = getStatusEmoji(status.activeState);

    const embed = new EmbedBuilder()
      .setTitle(`${emoji} ${service.alias}`)
      .setDescription(result.message)
      .setColor(getStatusColor(status.activeState))
      .addFields(
        {
          name: "Action",
          value: action,
          inline: true,
        },
        {
          name: "Current State",
          value: `${status.activeState} (${status.subState})`,
          inline: true,
        },
      )
      .setFooter({
        text: `Executed by ${interaction.user.tag}`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } else {
    const embed = new EmbedBuilder()
      .setTitle(`Failed: ${action} ${service.alias}`)
      .setDescription(result.message)
      .setColor(0xed4245)
      .setFooter({
        text: `Executed by ${interaction.user.tag}`,
      })
      .setTimestamp();

    if (result.stderr) {
      const truncated =
        result.stderr.length > 1000
          ? result.stderr.substring(0, 1000) + "\n..."
          : result.stderr;
      embed.addFields({
        name: "Error Output",
        value: `\`\`\`\n${truncated}\n\`\`\``,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  config: Config,
): Promise<void> {
  await interaction.deferReply();

  // Fetch status for all services concurrently.
  // Use allSettled so a single failure does not abort the whole list.
  const results = await Promise.allSettled(
    config.services.map(async (service) => {
      const status = await getServiceStatus(service);
      return { service, status };
    }),
  );

  const lines: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const { service, status } = result.value;
      const emoji = getStatusEmoji(status.activeState);
      const desc = service.description ? ` - ${service.description}` : "";
      lines.push(
        `${emoji} **${service.alias}** (\`${service.unit}\`): ${status.activeState}${desc}`,
      );
    } else {
      const service = config.services[i];
      console.error(
        `Failed to get status for ${service.alias} (${service.unit}):`,
        result.reason,
      );
      lines.push(
        `\u2753 **${service.alias}** (\`${service.unit}\`): error`,
      );
    }
  }

  const embed = new EmbedBuilder()
    .setTitle("Managed Services")
    .setColor(0x5865f2)
    .setTimestamp()
    .setDescription(lines.join("\n"));

  await interaction.editReply({ embeds: [embed] });
}
