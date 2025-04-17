import { Client, GatewayIntentBits, Events } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

const DiscordClient = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

DiscordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

DiscordClient.login(process.env.TOKEN);

export default DiscordClient;
