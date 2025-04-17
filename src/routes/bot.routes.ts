import express, { Request, Response } from "express";
import { start, stop } from "../controllers/bot.controller";

const botRoutes = express.Router();

botRoutes.post("/start", start);
botRoutes.post("/stop", stop);

export default botRoutes;
