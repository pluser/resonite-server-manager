import { Client, GatewayIntentBits, MessageFlags, REST, Routes } from "discord.js";
import { loadConfig } from "./config.js";
import { buildCommands, handleServiceCommand } from "./commands.js";

async function main(): Promise<void> {
  // Load configuration
  const configPath = process.argv[2] || undefined;
  const config = loadConfig(configPath);
  console.log(
    `Loaded configuration with ${config.services.length} service(s)`,
  );

  // Register slash commands
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const commands = buildCommands(config);

  if (config.guildIds?.length) {
    // Register guild-specific commands (instant update)
    for (const guildId of config.guildIds) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
        body: commands,
      });
      console.log(`Registered slash commands for guild ${guildId}`);
    }
  } else {
    // Register global commands (may take up to 1 hour to propagate)
    await rest.put(Routes.applicationCommands(config.clientId), {
      body: commands,
    });
    console.log("Registered global slash commands");
  }

  // Create Discord client
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("clientReady", (c) => {
    console.log(`Logged in as ${c.user.tag}`);
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "service") {
      try {
        await handleServiceCommand(interaction, config);
      } catch (err) {
        console.error("Error handling service command:", err);
        const errorMessage =
          "An unexpected error occurred while processing the command.";
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: errorMessage }).catch(() => {});
        } else {
          await interaction
            .reply({ content: errorMessage, flags: MessageFlags.Ephemeral })
            .catch(() => {});
        }
      }
    }
  });

  // Login
  await client.login(config.discordToken);

  // Graceful shutdown on SIGINT (Ctrl+C) / SIGTERM
  const shutdown = () => {
    console.log("Shutting down...");
    client.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
