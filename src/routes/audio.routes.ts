import {
    getMergedMp3,
    getTranscription,
    processRecordings,
    getSummary,
    generateSummary
} from "@controllers/audio.controller";
import express from "express";

const audioRoutes = express.Router();

audioRoutes.post("/process-recordings", processRecordings);
audioRoutes.post("/generate-summary/:meetingId", generateSummary);
audioRoutes.get("/merged/:meetingId", getMergedMp3);
audioRoutes.get("/transcription/:meetingId", getTranscription);
audioRoutes.get("/summary/:meetingId", getSummary);

export default audioRoutes;
