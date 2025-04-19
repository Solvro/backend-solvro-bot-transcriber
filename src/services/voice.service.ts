import { EndBehaviorType, getVoiceConnection, joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import DiscordClient from "@services/client.service";
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Decoder } from '@evan/opus';
import ffmpeg from 'fluent-ffmpeg';
import { readdirSync, unlinkSync, statSync, writeFileSync } from 'fs';

const AUDIO_SETTINGS: {
    channels: 1 | 2,
    rate: sample_rate,
    frameSize: number,
    bitrate: string,
} = {
    channels: 1,
    rate: 48000,
    frameSize: 960,
    bitrate: '64k',
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
        mkdirSync(recordingsDir, { recursive: true });
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

export const mergePcmToMp3 = async (recordingsDir: string, outputFile: string) => {
    const pcmFiles = readdirSync(recordingsDir)
        .filter(file => file.endsWith('.pcm'))
        .map(file => {
            const [timestamp, userId] = file.slice(0, -4).split('_');
            const filepath = join(recordingsDir, file);
            const fileStats = statSync(filepath);
            const duration = fileStats.size / (AUDIO_SETTINGS.rate * 2); // in seconds

            return {
                filepath,
                timestamp: parseInt(timestamp),
                userId,
                duration,
            };
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    if (pcmFiles.length === 0)
        throw new Error('No PCM files found to merge.');

    const jsonFilePath = join(recordingsDir, 'meeting_metadata.json');
    writeFileSync(jsonFilePath, JSON.stringify(pcmFiles, null, 2));

    const startTime = pcmFiles[0].timestamp;
    const wavFiles: string[] = [];

    for (const { filepath, timestamp } of pcmFiles) {
        const wavFile = filepath.replace('.pcm', '.wav');
        const delay = timestamp - startTime;

        await new Promise((resolve, reject) => {
            ffmpeg(filepath)
                .inputOptions([
                    '-f s16le',
                    `-ar ${AUDIO_SETTINGS.rate}`,
                    `-ac ${AUDIO_SETTINGS.channels}`
                ])
                .outputOptions([
                    `-ar ${AUDIO_SETTINGS.rate}`,
                    `-ac ${AUDIO_SETTINGS.channels}`,
                    `-af adelay=${delay}|${delay}`,
                ])
                .save(wavFile)
                .on('end', () => {
                    wavFiles.push(wavFile);
                    resolve(null);
                })
                .on('error', reject);
        });
    }

    const outputPath = join(recordingsDir, outputFile);

    await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg();
        wavFiles.forEach(wavFile => ffmpegCommand.input(wavFile));
        ffmpegCommand
            .complexFilter([
                {
                    filter: 'amix',
                    options: { inputs: wavFiles.length, duration: 'longest' },
                },
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
    });

    wavFiles.forEach(wavFile => unlinkSync(wavFile));
};