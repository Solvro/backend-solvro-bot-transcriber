import { EndBehaviorType, getVoiceConnection, joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import DiscordClient from "@services/client.service";
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Decoder } from '@evan/opus';
import ffmpeg from 'fluent-ffmpeg';
import { readdirSync, unlinkSync, statSync, writeFileSync } from 'fs';
import { storage } from "@utils/storage";

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


export const recordAudio = async (connection: VoiceConnection, meetingDir: string) => {
    const receiver = connection.receiver;

    if (!existsSync(meetingDir))
        mkdirSync(meetingDir, { recursive: true });

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

export const mergePcmToMp3 = async (meetingDir: string) => {
    const pcmFiles = readdirSync(meetingDir)
        .filter(file => file.endsWith('.pcm'))
        .map(file => {
            const [timestamp, userId] = file.slice(0, -4).split('_');
            const filepath = join(meetingDir, file);
            const fileStats = statSync(filepath);
            const duration = fileStats.size / (AUDIO_SETTINGS.rate * 2); // in seconds

            return {
                filepath,
                userId,
                globalTimestamp: parseInt(timestamp),
                recordingTimestamp: 0,
                duration,
            };
        })
        .sort((a, b) => a.globalTimestamp - b.globalTimestamp);

    if (pcmFiles.length === 0)
        throw new Error('No PCM files found to merge.');

    const startTime = pcmFiles[0].globalTimestamp;

    let currentEndTime = startTime + (pcmFiles[0].duration * 1000);
    const adjustedDelays: number[] = [0];
    const SILENCE_GAP = 1000;

    for (let i = 1; i < pcmFiles.length; i++) {
        const track = pcmFiles[i];
        const trackDurationMs = track.duration * 1000;
        const gapMs = track.globalTimestamp - currentEndTime;

        let adjustedStart = track.globalTimestamp;
        if (gapMs > 0) 
            adjustedStart = currentEndTime + SILENCE_GAP;

        adjustedDelays.push(adjustedStart - startTime);
        pcmFiles[i].recordingTimestamp = (adjustedStart - startTime) / 1000;
        currentEndTime = Math.max(currentEndTime, adjustedStart + trackDurationMs);
    }

    const metadataPath = join(meetingDir, "metadata.json");
    writeFileSync(metadataPath, JSON.stringify(pcmFiles, null, 2));

    const outputPath = join(meetingDir, "merged.mp3");

    return await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg();

        pcmFiles.forEach((pcm, index) => {
            ffmpegCommand.input(pcm.filepath)
                .inputOptions([
                    '-f s16le',
                    `-ar ${AUDIO_SETTINGS.rate}`,
                    `-ac ${AUDIO_SETTINGS.channels}`
                ]);
        });

        const delayFilters = pcmFiles.map((_, index) =>
            `[${index}:a]adelay=${adjustedDelays[index]}|${adjustedDelays[index]}[a${index}]`
        );

        const amixFilter = `${pcmFiles.map((_, i) => `[a${i}]`).join('')}` +
            `amix=inputs=${pcmFiles.length}:duration=longest[out]`;

        ffmpegCommand
            .complexFilter([...delayFilters, amixFilter])
            .outputOptions([
                '-map [out]',
                '-c:a libmp3lame',
                '-q:a 2'
            ])
            .output(outputPath)
            .on('end', resolve)
            .on('error', (err) => {
                console.error('FFmpeg error:', err);
                reject(err);
            })
            .run();
    });
};

export const processRecording = async (meetingDir: string) => {
    await mergePcmToMp3(meetingDir);

    // TODO: transcribe using whisper?
    const transcription: string = "transcription"; 

    const response = await fetch(`${process.env.CORE_URL}/???`, {
        method: "POST",
        body: JSON.stringify({
            name: storage.get("current_meeting_name") as string,
            transcription,
            endTimestamp: Date.now()
        }),
        headers: {
            "Content-Type": "application/json",
        },
    });
    
    storage.remove("current_meeting_name");
}