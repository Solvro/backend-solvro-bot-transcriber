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
    closeSync,
    openSync,
} from "fs";
import { join } from "path";
import { PassThrough } from "stream";
import { Decoder } from "@evan/opus";
import ffmpeg from "fluent-ffmpeg";
import { readdirSync, statSync, writeFileSync } from "fs";
import { storage } from "@utils/storage";
import { logger } from "@utils/logger";
import { AudioSettings, UserChunk, UserStreams } from "types/voice";
import { transcriber } from "@utils/transcriber";
import { TranscriptionVerbose } from "types/transcriber";
import { uploadFile } from "./minio.service";

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

export const processRecording = async (meetingDir: string) => {
    try {
        const chunks = await mergePcmToMp3(meetingDir);

        // Empty recording, skip transcription and notify core
        if (chunks.length == 0) {
            const response = await fetch(
                `${process.env.CORE_URL}/recordings/${storage.get(
                    "current_meeting_id"
                )}`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        text: "No segments found. Transcription skipped.",
                    }),
                    headers: { "Content-Type": "application/json" },
                }
            );

            if (response.ok)
                logger.info(
                    `Recording updated successfully: ${response.statusText}`
                );
            else
                logger.warn(
                    `Failed to update recording: ${response.statusText}`
                );
            return;
        }

        // Upload file to MinIO storage
        // TODO: set bucket name to meeting id?
        // await uploadFile(join(meetingDir, "merged.mp3"), "meetings", "merged.mp3");

        // TODO: split audio file to smaller parts
        const segments = (await transcriber.toSegments(
            join(meetingDir, "merged.mp3")
        )) as TranscriptionVerbose;

        let body;
        if (segments) {
            body = transcriber.assignUsersToSegments(segments, chunks);

            const transcriptionFilePath = join(
                meetingDir,
                "transcription.json"
            );
            writeFileSync(transcriptionFilePath, JSON.stringify(body, null, 2));
        }

        const response = await fetch(
            `${process.env.CORE_URL}/recordings/${storage.get(
                "current_meeting_id"
            )}`,
            {
                method: "PATCH",
                body: JSON.stringify(
                    segments
                        ? body
                        : {
                              text: "No segments found. Transcription skipped.",
                          }
                ),
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        if (response.ok)
            logger.info(
                `Recording updated successfully: ${response.statusText}`
            );
        else logger.warn(`Failed to update recording: ${response.statusText}`);
    } catch (error) {
        logger.error(`${error}`);
    }

    storage.remove("current_meeting_id");
};

const mergePcmToMp3 = async (meetingDir: string) => {
    logger.info("Loading PCM files for merging");

    const chunks: UserChunk[] = readdirSync(meetingDir)
        .filter((file) => file.endsWith(".pcm"))
        .map((file) => {
            const [timestamp, userId] = file.slice(0, -4).split("_");
            const filepath = join(meetingDir, file);
            const fileStats = statSync(filepath);
            const duration = Math.round(
                (1000 * fileStats.size) / (AUDIO_SETTINGS.rate * 2)
            );

            return {
                filepath,
                userId,
                globalTimestamp: parseInt(timestamp),
                duration,
            };
        })
        .filter((file) => file.duration > 800)
        .sort((a, b) => a.globalTimestamp - b.globalTimestamp);

    const outputPath = join(meetingDir, "merged.mp3");

    if (chunks.length === 0) {
        logger.info("No PCM files found to merge.");

        closeSync(openSync(outputPath, "w"));
        return [];
        // throw new Error("No PCM files found to merge.");
    }

    const startTime = chunks[0].globalTimestamp;

    logger.info("Merging PCM files to MP3");

    await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg();

        chunks.forEach((pcm, _) => {
            ffmpegCommand
                .input(pcm.filepath)
                .inputOptions([
                    "-f s16le",
                    `-ar ${AUDIO_SETTINGS.rate}`,
                    `-ac ${AUDIO_SETTINGS.channels}`,
                ]);
        });

        const delays = chunks.map((pcm) => {
            return Math.max(0, pcm.globalTimestamp - startTime);
        });

        const delayFilters = chunks.map(
            (_, index) =>
                `[${index}:a]adelay=${delays[index]}|${delays[index]}[a${index}]`
        );

        const amixFilter =
            `${chunks.map((_, i) => `[a${i}]`).join("")}` +
            `amix=inputs=${chunks.length}:duration=longest[out]`;

        ffmpegCommand
            .complexFilter([...delayFilters, amixFilter])
            .outputOptions([
                "-map [out]",
                "-c:a libmp3lame",
                `-b:a ${AUDIO_SETTINGS.bitrate}`,
            ])
            .output(outputPath)
            .on("end", resolve)
            .on("error", (err) => {
                logger.error(`FFmpeg error: ${err}`);
                reject(err);
            })
            .run();
    });

    logger.info("PCM files merged successfully");

    return chunks;
};
