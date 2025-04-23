import { EndBehaviorType, getVoiceConnection, joinVoiceChannel, VoiceConnection } from "@discordjs/voice";
import DiscordClient from "@services/client.service";
import { mkdirSync, existsSync, createWriteStream } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import { Decoder } from '@evan/opus';
import ffmpeg from 'fluent-ffmpeg';
import { readdirSync, readFileSync, statSync, writeFileSync, createReadStream } from 'fs';
import { storage } from "@utils/storage";
import OpenAI from "openai";
import { logger } from "@utils/logger";

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

    logger.info("Recording started");

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
    logger.info("Loading PCM files for merging");

    const pcmFiles = readdirSync(meetingDir)
        .filter(file => file.endsWith('.pcm'))
        .map(file => {
            const [timestamp, userId] = file.slice(0, -4).split('_');
            const filepath = join(meetingDir, file);
            const fileStats = statSync(filepath);
            const duration = Math.round(
                1000 * fileStats.size / (AUDIO_SETTINGS.rate * 2)
            ); // in ms

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

    let currentEndTime = startTime + pcmFiles[0].duration;
    const adjustedDelays: number[] = [0];
    const SILENCE_GAP = 1000;

    logger.info("Adjusting PCM delays for merging");

    for (let i = 1; i < pcmFiles.length; i++) {
        const track = pcmFiles[i];
        const gapMs = track.globalTimestamp - currentEndTime;

        let adjustedStart = track.globalTimestamp;
        if (gapMs > 0)
            adjustedStart = currentEndTime + SILENCE_GAP;

        adjustedDelays.push(adjustedStart - startTime);
        pcmFiles[i].recordingTimestamp = adjustedStart - startTime;
        currentEndTime = Math.max(currentEndTime, adjustedStart + track.duration);
    }

    const metadataPath = join(meetingDir, "metadata.json");
    writeFileSync(metadataPath, JSON.stringify(pcmFiles, null, 2));

    const outputPath = join(meetingDir, "merged.mp3");

    logger.info("Merging PCM files to MP3");

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
                logger.error(`FFmpeg error: ${err}`);
                reject(err);
            })
            .run();
    });
};

export const transcribeAudio = async (meetingDir: string) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_KEY,
        organization: process.env.OPENAI_ORG,
        project: process.env.OPENAI_PROJ,
    });

    logger.info("Transcription started");

    // TODO: split merged.mp3 into 25MB chunks
    const transcription = await openai.audio.transcriptions.create({
        file: createReadStream(
            join(meetingDir, "merged.mp3")
        ),
        model: "whisper-1",
        language: "pl",
    });

    logger.info("Transcription finished");

    return transcription.text;
}

export const processRecording = async (meetingDir: string) => {
    await mergePcmToMp3(meetingDir);

    let transcription;
    if (process.env.OPENAI_KEY == undefined) {
        transcription = "Missing OpenAI key";
        logger.warn("Missing OpenAI key, skipping transcription");
    } else {
        transcription = await transcribeAudio(meetingDir);
    }

    const transcriptionPath = join(meetingDir, "transcription.txt");
    writeFileSync(transcriptionPath, transcription);

    const metadataPath = join(meetingDir, "metadata.json");
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));

    const response = await fetch(
        `${process.env.CORE_URL}/recordings/${storage.get("current_meeting_id")}`, {
        method: "PATCH",
        body: JSON.stringify({
            transcription,
            metadata,
        }),
        headers: {
            "Content-Type": "application/json",
        },
    });

    storage.remove("current_meeting_id");
}