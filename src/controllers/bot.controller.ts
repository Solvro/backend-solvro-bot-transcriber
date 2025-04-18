import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
    recordAudio,
    mergePcmToMp3
} from "@services/voice.service";

export const start = async (req: Request, res: Response) => {
    // TODO: meeting name from req body + separate folder for each meeting

    const channelId = req.body?.channelId;
    // if (!channelId)
    //     return res.status(400).json({ error: "channelId is required" });

    const connection = await connectToVoiceChannel(
        process.env.GUILD_ID ?? "",
        channelId ?? "1362149031618281485"
    );

    recordAudio(connection, process.env.RECORDINGS_PATH ?? "../../recordings");

    res.json({ message: "ok" });
};

export const stop = async (req: Request, res: Response) => {
    await mergePcmToMp3(
        process.env.RECORDINGS_PATH ?? "../../recordings",
        "output.mp3"
    );
    
    await disconnectFromVoice(process.env.GUILD_ID ?? "");

    res.json({ message: "ok" });
};
