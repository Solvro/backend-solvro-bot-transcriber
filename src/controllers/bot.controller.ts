import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
    recordAudio,
    mergePcmToMp3
} from "@services/voice.service";
import { join } from "path";
import { storage } from "@utils/storage";

export const start = async (req: Request, res: Response) => {
    const channelId = req.body?.channelId;
    // if (!channelId)
    //     return res.status(400).json({ error: "channelId is required" });

    const meetingName: string = req.body?.meetingName;
    // if (!meetingName)
    //     return res.status(400).json({ error: "meetingName is required" });
    storage.save("current_meeting", meetingName);

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
        storage.get("current_meeting")
    );

    storage.remove("current_meeting");

    // execute this async (for now)
    mergePcmToMp3(
        recordingPath,
        "output.mp3"
    );

    res.json({ message: "ok" });
};
