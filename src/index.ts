import express, { Request, Response } from "express";

import dotenv from "dotenv";
import botRoutes from "@routes/bot.routes";
import DiscordClient from "@services/client.service";
import { logger } from "@utils/logger";
import audioRoutes from "@routes/audio.routes";
dotenv.config();

const app = express();

app.use(express.json());

app.get("/", (req: Request, res: Response) => {
    res.status(200).send({ message: "ok" });
});

app.use("/", botRoutes);
app.use("/", audioRoutes);

// init discord client;
DiscordClient;

const port = process.env.PORT || 3000;
app.listen(port, () => {
    logger.info(`Server running at http://localhost:${port}`);
});
