# resonite-server-manager

Discord bot for managing systemd services via slash commands. Services are controlled through a whitelist with human-friendly aliases.

## Features

- `/service status <name>` - Check service status with rich embed output
- `/service start <name>` - Start a service
- `/service stop <name>` - Stop a service
- `/service restart <name>` - Restart a service
- `/service list` - List all managed services with their current status
- Whitelist-based service access with human-friendly aliases
- Role-based and user-based authorization

## Setup

### 1. Discord Bot

1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and copy the token
3. Copy the Application ID (Client ID)
4. Invite the bot to your server with the `applications.commands` and `bot` scopes

### 2. Configuration

Copy the example configuration and fill in your values:

```bash
cp config.example.json config.json
```

Edit `config.json`:

| Field | Required | Description |
|---|---|---|
| `discordToken` | Yes | Discord bot token |
| `clientId` | Yes | Discord application client ID |
| `guildIds` | No | Guild IDs for guild-specific commands (recommended for testing; instant updates) |
| `allowedRoleIds` | No | Discord role IDs authorized to manage services |
| `allowedUserIds` | No | Discord user IDs authorized to manage services |
| `services` | Yes | Array of whitelisted service entries |

Each service entry:

| Field | Required | Description |
|---|---|---|
| `alias` | Yes | Human-friendly name shown in Discord (e.g. "Resonite Headless") |
| `unit` | Yes | Actual systemd unit name (e.g. "resonite-headless.service") |
| `description` | No | Optional description shown in the service list |

If neither `allowedRoleIds` nor `allowedUserIds` is set, all users who can see the commands can use them.

### 3. Sudoers Configuration

The bot runs `sudo systemctl <action> <unit>` to manage services. Configure sudoers to allow the bot user to run these commands without a password.

Create `/etc/sudoers.d/resonite-server-manager`:

```sudoers
# Allow the bot user to manage specific services without a password.
# Replace "botuser" with the actual user running the bot.
# Add one line per service unit.

botuser ALL=(root) NOPASSWD: /usr/bin/systemctl status resonite-headless.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl start resonite-headless.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl stop resonite-headless.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl restart resonite-headless.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl show resonite-headless.service

botuser ALL=(root) NOPASSWD: /usr/bin/systemctl status nginx.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl start nginx.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl stop nginx.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl restart nginx.service
botuser ALL=(root) NOPASSWD: /usr/bin/systemctl show nginx.service
```

Validate with:

```bash
sudo visudo -c -f /etc/sudoers.d/resonite-server-manager
```

### 4. Install & Run

```bash
npm install
npm run build
npm start
```

For development:

```bash
npm run dev
```

You can also pass a custom config path:

```bash
npm start -- /path/to/config.json
```

## Security Notes

- Only services explicitly listed in `config.json` can be managed
- Service aliases are exposed as Discord slash command choices (no free-text input), preventing injection
- The sudoers configuration should be scoped to only the specific units needed
- Authorization can be restricted by Discord role IDs and/or user IDs
