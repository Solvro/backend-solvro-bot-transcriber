import { Request, Response } from "express";
import { processRecording } from "@services/voice.service";
import { join } from "path";
import { existsSync } from "fs";

export const processRecordings = async (req: Request, res: Response) => {
    const meetingId = req.body?.meetingId;
    if (!meetingId || typeof meetingId !== "string") {
        res.status(400).json({ error: "meetingId is required" });
        return;
    }

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingId
    );

    processRecording(recordingPath);

    res.json({ message: "ok" });
};

export const getMergedMp3 = async (req: Request, res: Response) => {
    const meetingId = req.params?.meetingId;

    if (!meetingId || typeof meetingId !== "string") {
        res.status(400).json({ error: "meetingId is required" });
        return;
    }

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingId,
        "merged.mp3"
    );

    if (!existsSync(recordingPath)) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    res.download(recordingPath);
};

export const getTranscription = async (req: Request, res: Response) => {
    const meetingId = req.params?.meetingId;

    if (!meetingId || typeof meetingId !== "string") {
        res.status(400).json({ error: "meetingId is required" });
        return;
    }

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingId,
        "transcription.json"
    );

    if (!existsSync(recordingPath)) {
        res.status(404).json({ error: "Not found" });
        return;
    }

    res.download(recordingPath);
};
