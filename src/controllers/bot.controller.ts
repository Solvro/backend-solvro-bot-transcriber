import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
} from "../services/voice.service";

export const start = async (req: Request, res: Response) => {
    // TODO: channelId prom req body
    const connection = await connectToVoiceChannel(
        process.env.GUILD_ID ?? "",
        "1362149031618281485"
    );

    res.json({ message: "connected" });
};

export const stop = async (req: Request, res: Response) => {
    await disconnectFromVoice(process.env.GUILD_ID ?? "");

    res.json({ message: "disconnected" });
};
