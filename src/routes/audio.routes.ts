import {
    getMergedMp3,
    getTranscription,
    processRecordings,
    getSummary
} from "@controllers/audio.controller";
import express from "express";

const audioRoutes = express.Router();

audioRoutes.post("/process-recordings", processRecordings);
audioRoutes.get("/merged/:meetingId", getMergedMp3);
audioRoutes.get("/transcription/:meetingId", getTranscription);
audioRoutes.get("/summary/:meetingId", getSummary);

export default audioRoutes;
