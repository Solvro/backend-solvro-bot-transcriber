import OpenAI from "openai";
import { logger } from "@utils/logger";
import { createReadStream, existsSync } from "fs";
import IntervalTree from "@flatten-js/interval-tree";
import { UserChunk } from "types/voice";
import {
  TranscriptionVerbose,
  SegWithUserId
} from "types/transcriber";

class Transcriber {
  private authorized: boolean = true;
  private client?: OpenAI;

  constructor() {
    if (
      !process.env.OPENAI_KEY ||
      !process.env.OPENAI_ORG ||
      !process.env.OPENAI_PROJ
    ) {
      this.authorized = false;
      logger.warn("Missing OpenAI credentials.");
      return;
    } else {
      logger.info("OpenAI credentials found.");
    }

    this.client = new OpenAI({
      apiKey: process.env.OPENAI_KEY,
      organization: process.env.OPENAI_ORG,
      project: process.env.OPENAI_PROJ,
    });
  }

  async toSegments(audioFile: string) {
    if (!this.authorized) {
      logger.warn("Missing OpenAI credentials. Transcription will be skipped.");
      return undefined;
    }

    if (!existsSync(audioFile)) {
      logger.warn(`Audio file ${audioFile} does not exist. Transcription will be skipped.`);
      return undefined;
    }

    const res = await this.client?.audio.transcriptions.create({
      file: createReadStream(audioFile),
      model: "whisper-1",
      language: "pl",
      response_format: "verbose_json",
      timestamp_granularities: ["segment"]

      //? maybe list of open projects will be available in some db
      // prompt: "ToPWR, Solvro Bot, Planer, ..."
    });

    return res;
  }

  assignUsersToSegments(
    segments: TranscriptionVerbose,
    userChunks: UserChunk[]
  ): TranscriptionVerbose & { segments: SegWithUserId[] } {
    if (!this.authorized) {
      logger.warn("Missing OpenAI credentials. Assigning users to segments will be skipped.");
      return segments;
    }

    const tree = new IntervalTree<{ userId: string; start: number; end: number }>();
    
    const startTime = Math.min(...userChunks.map(c => c.globalTimestamp));
  
    userChunks.forEach(chunk => {
      const start = chunk.globalTimestamp - startTime;
      const end = start + chunk.duration;
      tree.insert([start, end], { 
        userId: chunk.userId,
        start,
        end
      });
    });
  
    const augmentedSegments = segments.segments.map(segment => {
      const segStartMs = segment.start * 1000;
      const segEndMs = segment.end * 1000;
  
      let maxOverlap = 0;
      let bestUserId: string | undefined;
  
      tree.search([segStartMs, segEndMs]).forEach(interval => {
        const overlapStart = Math.max(segStartMs, interval.start);
        const overlapEnd = Math.min(segEndMs, interval.end);
        const overlapDuration = overlapEnd - overlapStart;
  
        if (overlapDuration > maxOverlap) {
          maxOverlap = overlapDuration;
          bestUserId = interval.userId;
        }
      });
  
      return { ...segment, userId: bestUserId };
    });
  
    return {
      ...segments,
      segments: augmentedSegments
    };
  }

  // TODO: implement after cutting the audio file to smaller parts
  mergeMultipleTranscriptions(transcriptions: TranscriptionVerbose[]) {
    throw new Error("Not implemented");
  }
}

export const transcriber = new Transcriber();