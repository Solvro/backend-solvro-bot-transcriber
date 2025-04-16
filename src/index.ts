import express, { Request, Response } from "express";
import { Client, Events, GatewayIntentBits } from "discord.js";

import dotenv from "dotenv";
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req: Request, res: Response) => {
  res.send("Hello, TypeScript Express!");
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});
  
client.login(process.env.TOKEN);