import { Request, Response } from "express";
import {
    connectToVoiceChannel,
    disconnectFromVoice,
    recordAudio,
} from "@services/voice.service";

export const start = async (req: Request, res: Response) => {
    // TODO: channelId prom req body
    const connection = await connectToVoiceChannel(
        process.env.GUILD_ID ?? "",
        "1362149031618281485"
    );

    recordAudio(connection, process.env.RECORDINGS_PATH ?? "../../recordings");

    res.json({ message: "ok" });
};

export const stop = async (req: Request, res: Response) => {
    await disconnectFromVoice(process.env.GUILD_ID ?? "");

    res.json({ message: "ok" });
};
