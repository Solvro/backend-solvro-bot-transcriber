import {
    EndBehaviorType,
    getVoiceConnection,
    joinVoiceChannel,
    VoiceConnection,
} from "@discordjs/voice";
import DiscordClient from "@services/client.service";
import {
    mkdirSync,
    existsSync,
    createWriteStream,
} from "fs";
import { join } from "path";
import { PassThrough } from "stream";
import { Decoder } from "@evan/opus";
import { logger } from "@utils/logger";
import { AudioSettings, UserStreams } from "types/voice";

const AUDIO_SETTINGS: AudioSettings = {
    channels: 1,
    rate: 48000,
    frameSize: 960,
    bitrate: "64k",
};

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

export const recordAudio = async (
    connection: VoiceConnection,
    meetingDir: string
) => {
    const receiver = connection.receiver;

    if (!existsSync(meetingDir)) mkdirSync(meetingDir, { recursive: true });

    const streams = new Map<string, UserStreams>();

    logger.info("Recording started");

    receiver.speaking.on("start", (userId: string) => {
        if (streams.has(userId)) return;

        const timestamp = Date.now();
        const filename = `${timestamp}_${userId}.pcm`;
        const filepath = join(meetingDir, filename);

        const audioStream = receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: 1000,
            },
        });

        const decoder = new Decoder({
            channels: AUDIO_SETTINGS.channels,
            sample_rate: AUDIO_SETTINGS.rate,
        });
        const pcmStream = new PassThrough();
        const fileStream = createWriteStream(filepath);

        audioStream.on("data", (chunk: Buffer) => {
            const decoded = decoder.decode(chunk);
            pcmStream.write(decoded);
        });

        pcmStream.pipe(fileStream);

        audioStream.on("end", () => {
            pcmStream.end();
        });

        streams.set(userId, {
            audioStream,
            pcmStream,
            fileStream,
        });
    });

    receiver.speaking.on("end", (userId: string) => {
        const stream = streams.get(userId);
        if (stream) {
            stream.audioStream.destroy();
            stream.pcmStream.end();
            stream.fileStream.end();
            streams.delete(userId);
        }
    });
};


