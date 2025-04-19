import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
    recordAudio,
    processRecording
} from "@services/voice.service";
import { join } from "path";
import { storage } from "@utils/storage";
import { existsSync, readFileSync } from "fs";

export const start = async (req: Request, res: Response) => {
    const channelId = req.body?.channelId;
    // if (!channelId) {
    //     res.status(400).json({ error: "channelId is required" });
    //     return;
    // }

    const meetingName: string = req.body?.meetingName;
    // if (!meetingName)
    //     res.status(400).json({ error: "meetingName is required" });
    //     return;
    // }
    storage.save("current_meeting_name", meetingName);

    const connection = await connectToVoiceChannel(
        process.env.GUILD_ID ?? "",
        channelId ?? "1362149031618281485"
    );

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingName
    );

    recordAudio(connection, recordingPath);

    res.json({ message: "ok" });
};

export const stop = async (req: Request, res: Response) => {
    await disconnectFromVoice(process.env.GUILD_ID ?? "");

    const recordingPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        storage.get("current_meeting_name")
    );

    processRecording(recordingPath);

    res.json({ message: "ok" });
};

export const getMeeting = async (req: Request, res: Response) => {
    const meetingName = req.params.meetingName;

    if (!meetingName) {
        res.status(400).json({ error: "meetingName is required" });
        return;
    }
    
    if (storage.get(`${meetingName}_processing`)) {
        res.status(202).json({ message: "processing" });
        return;
    }

    const resultPath = join(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        meetingName,
        "result.json"
    );

    if (!existsSync(resultPath)) {
        res.status(404).json({ error: "result not found" });
        return;
    }

    const result = JSON.parse(readFileSync(resultPath, "utf-8"));
    res.json(result);
}
