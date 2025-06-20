import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
    recordAudio,
} from "@services/voice.service";
import { join } from "path";
import { storage } from "@utils/storage";
import { processRecording } from "@services/transcription.service";

export const start = async (req: Request, res: Response) => {
    const channelId = req.body?.channelId;
    if (!channelId) {
        res.status(400).json({ error: "channelId is required" });
        return;
    }

    const meetingId = req.body?.meetingId as string;
    if (!meetingId) {
        res.status(400).json({ error: "meetingId is required" });
        return;
    }
    storage.save("current_meeting_id", meetingId);

    const connection = await connectToVoiceChannel(
        process.env.GUILD_ID ?? "",
        channelId ?? "1362149031618281485"
    );

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingId
    );

    recordAudio(connection, recordingPath);

    res.json({ message: "ok" });
};

export const stop = async (req: Request, res: Response) => {
    await disconnectFromVoice(process.env.GUILD_ID ?? "");

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        storage.get("current_meeting_id") as string
    );

    processRecording(recordingPath);

    res.json({ message: "ok" });
};
