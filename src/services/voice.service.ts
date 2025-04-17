import { getVoiceConnection, joinVoiceChannel } from "@discordjs/voice";
import DiscordClient from "./client.service";

export const connectToVoiceChannel = async (
    guildId: string,
    channelId: string
) => {
    const guild = DiscordClient.guilds.cache.get(guildId);

    if (guild == undefined) throw Error("Guild not found");

    const connection = joinVoiceChannel({
        guildId: guildId,
        channelId: channelId,
        selfDeaf: false,
        selfMute: true,
        adapterCreator: guild.voiceAdapterCreator,
    });

    return connection;
};

export const disconnectFromVoice = async (guildId: string) => {
    const connection = getVoiceConnection(guildId);

    connection?.destroy();
};
