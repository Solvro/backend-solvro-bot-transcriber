import express, { Request, Response } from "express";
import { start, stop, getMeeting } from "@controllers/bot.controller";

const botRoutes = express.Router();

botRoutes.post("/start", start);
botRoutes.post("/stop", stop);

botRoutes.get("/get/:meetingName", getMeeting);

export default botRoutes;
