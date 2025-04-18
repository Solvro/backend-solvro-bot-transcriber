import { EndBehaviorType, getVoiceConnection, joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import DiscordClient from "@services/client.service";
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Decoder } from '@evan/opus';

const AUDIO_SETTINGS: {
    channels: 1 | 2,
    rate: sample_rate,
    frameSize: number,
    bitrate: string,
    mixInterval: number,
} = {
    channels: 1,
    rate: 48000,
    frameSize: 960,
    bitrate: '64k',
    mixInterval: 20,
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


export const recordAudio = async (connection: VoiceConnection, recordingsDir: string) => {
    const receiver = connection.receiver;

    if (!existsSync(recordingsDir)) {
        mkdirSync(recordingsDir);
    }

    const streams = new Map<string, {
        audioStream: any;
        pcmStream: PassThrough;
        fileStream: ReturnType<typeof createWriteStream>;
        decoder: Decoder;
    }>();

    receiver.speaking.on('start', (userId: string) => {
        if (streams.has(userId)) return;

        const timestamp = Date.now();
        const filename = `${timestamp}_${userId}.pcm`;
        const filepath = join(recordingsDir, filename);

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

        audioStream.on('data', (chunk: Buffer) => {
            const decoded = decoder.decode(chunk);
            pcmStream.write(decoded);
        });

        pcmStream.pipe(fileStream);

        audioStream.on('end', () => {
            pcmStream.end();
        });

        streams.set(userId, {
            audioStream,
            pcmStream,
            fileStream,
            decoder,
        });
    });

    receiver.speaking.on('end', (userId: string) => {
        const stream = streams.get(userId);
        if (stream) {
            stream.audioStream.destroy();
            stream.pcmStream.end();
            stream.fileStream.end();
            streams.delete(userId);
        }
    });
};
