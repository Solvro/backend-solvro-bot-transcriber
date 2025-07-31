import { closeSync, openSync, unlinkSync } from "fs";
import { join } from "path";
import ffmpeg from "fluent-ffmpeg";
import { readdirSync, statSync, writeFileSync } from "fs";
import { storage } from "@utils/storage";
import { logger } from "@utils/logger";
import { AudioSettings, UserChunk } from "types/voice";
import { transcriber } from "@utils/transcriber";
import { TranscriptionVerbose } from "types/transcriber";
import fetch from "node-fetch";

const AUDIO_SETTINGS: AudioSettings = {
    channels: 1,
    rate: 48000,
    frameSize: 960,
    bitrate: "64k",
};

const BATCH_SIZE = 50;

export const processRecording = async (meetingDir: string) => {
    try {
        const chunks = await mergePcmToMp3(meetingDir);

        // Empty recording, skip transcription and notify core
        if (chunks.length == 0) {
            await sendTranscriptionPartsToCore({
                text: "No segments found. Transcription skipped.",
            });
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

        await sendTranscriptionPartsToCore(
            segments
                ? body
                : { text: "No segments found. Transcription skipped." }
        );

        await generateSummaryFromTranscription(meetingDir);
    } catch (error) {
        logger.error(`Error in processRecording: ${error}`);
    }

    storage.remove("current_meeting_id");
};

export const generateSummaryFromTranscription = async (meetingDir: string) => {
    logger.info("Starting the summary generation");

    const transcriptionFilePath = join(meetingDir, "transcription.json");
    const summaryText = await transcriber.summarize(transcriptionFilePath);

    if (summaryText) {
        const summaryPath = join(meetingDir, "summary.md");

        writeFileSync(summaryPath, summaryText);

        logger.info(`Summary generated successfully (${summaryPath})`);
    } else {
        logger.warn("Summary generation failed or returned empty.");
    }
};

const sendTranscriptionPartsToCore = async (content: any) => {
    const requestBody = {
        text: content.text || "Transcription",
        task: "transcription",
        language: content.language || "pl",
        duration: content.duration || 0,
        segments: content.segments || [],
    };

    const response = await fetch(
        `${process.env.CORE_URL}/recordings/${storage.get("current_meeting_id")}`,
        {
            method: "PATCH",
            body: JSON.stringify(requestBody),
            headers: {
                "Content-Type": "application/json",
            },
        }
    );

    if (response.ok) {
        logger.info(`Recording updated successfully`);
    } else {
        const errorText = await response.text();
        logger.warn(
            `Failed to update recording: ${response.statusText}, Details: ${errorText}`
        );
    }
};

export const mergePcmToMp3 = async (meetingDir: string) => {
    logger.info("Loading PCM files for merging");

    logger.debug(
        `meetingDir: ${typeof meetingDir}, constructor: ${
            meetingDir?.constructor?.name
        }`
    );

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
    }

    logger.info(
        `Found ${chunks.length} PCM files, starting batch processing...`
    );

    const intermediateFiles: string[] = [];
    const startTime = chunks[0].globalTimestamp;

    // Step 1: Process in batches
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const batchOutput = join(meetingDir, `batch_${i / BATCH_SIZE}.wav`);
        intermediateFiles.push(batchOutput);

        logger.info(
            `Processing batch ${i / BATCH_SIZE + 1}/${Math.ceil(
                chunks.length / BATCH_SIZE
            )}...`
        );

        await new Promise<void>((resolve, reject) => {
            const command = ffmpeg();

            batch.forEach((pcm) => {
                command
                    .input(pcm.filepath)
                    .inputOptions([
                        "-f s16le",
                        `-ar ${AUDIO_SETTINGS.rate}`,
                        `-ac ${AUDIO_SETTINGS.channels}`,
                    ]);
            });

            const delays = batch.map((pcm) =>
                Math.max(0, pcm.globalTimestamp - startTime)
            );

            const delayFilters = batch.map(
                (_, idx) =>
                    `[${idx}:a]adelay=${delays[idx]}|${delays[idx]}[a${idx}]`
            );

            const amix =
                batch.map((_, i) => `[a${i}]`).join("") +
                `amix=inputs=${batch.length}:duration=longest[out]`;

            command
                .complexFilter([...delayFilters, amix])
                .outputOptions(["-map [out]"])
                .output(batchOutput)
                .on("end", () => {
                    logger.info(`Finished batch ${i / BATCH_SIZE + 1}`);
                    resolve();
                })
                .on("error", (err: any) => {
                    logger.error(
                        `FFmpeg error in batch ${i / BATCH_SIZE}: ${err}`
                    );
                    reject(err);
                })
                .run();
        });
    }

    // Step 2: Merge all batch outputs into final MP3
    logger.info("Merging intermediate files into final output...");

    await new Promise<void>((resolve, reject) => {
        const command = ffmpeg();

        intermediateFiles.forEach((file) => command.input(file));

        const amix =
            intermediateFiles.map((_, i) => `[${i}:a]`).join("") +
            `amix=inputs=${intermediateFiles.length}:duration=longest[out]`;

        command
            .complexFilter([amix])
            .outputOptions([
                "-map [out]",
                "-c:a libmp3lame",
                `-b:a ${AUDIO_SETTINGS.bitrate}`,
            ])
            .output(outputPath)
            .on("end", () => {
                logger.info("Final MP3 merged successfully.");
                resolve();
            })
            .on("error", (err: any) => {
                logger.error(`FFmpeg final merge error: ${err}`);
                reject(err);
            })
            .run();
    });

    // Step 3: Cleanup intermediate files
    removeIntermediateFiles(meetingDir);

    logger.info("PCM files merged successfully.");
    return chunks;
};

export const removeIntermediateFiles = (meetingDir: string) => {
    logger.info("Cleaning up intermediate files...");

    const intermediateFiles = readdirSync(meetingDir).filter((file) =>
        file.endsWith(".wav")
    );

    intermediateFiles.forEach((file) => {
        try {
            unlinkSync(file);
        } catch (err) {
            logger.warn(`Failed to delete ${file}: ${err}`);
        }
    });
};

export const removePCMFiles = (meetingDir: string) => {
    const pcmFiles = readdirSync(meetingDir).filter((file) =>
        file.endsWith(".pcm")
    );

    logger.info(`Cleaning up ${pcmFiles.length} PCM files...`);

    pcmFiles.forEach((file) => {
        try {
            unlinkSync(file);
        } catch (err) {
            logger.warn(`Failed to delete ${file}: ${err}`);
        }
    });
};
