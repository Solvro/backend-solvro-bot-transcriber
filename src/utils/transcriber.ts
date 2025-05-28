import OpenAI from "openai";
import { logger } from "@utils/logger";
import { createReadStream, existsSync, readFileSync } from "fs";
import IntervalTree from "@flatten-js/interval-tree";
import { UserChunk } from "types/voice";
import { TranscriptionVerbose, SegWithUserId } from "types/transcriber";

const MODEL = "gpt-4o";
const USER_CONTENT = "Podsumuj tę transkrypcję:\n"
const SYSTEM_CONTENT = [
    "Jesteś profesjonalnym asystentem, który dokładnie podsumowuje transkrypcję cotygodniowego spotkania Solvro Weekly koła naukowego Solvro. ",
    "Twoim celem jest stworzenie szczegółowego, ale czytelnego podsumowania, które zawiera wszystkie kluczowe informacje. ",
    "Podsumowanie powinno zawierać:\n",
    "- 📌 **Główne tematy spotkania** – co zostało omówione?\n",
    "- ✅ **Podjęte decyzje** – jakie wnioski i decyzje zapadły?\n",
    "- 📝 **Zadania do wykonania** – kto jest odpowiedzialny za konkretne działania?\n",
    "- ⏭️ **Plany na przyszłość** – co zaplanowano na kolejne spotkania lub działania?\n",
    "- 🔹 **Dodatkowe istotne informacje** – np. problemy, wyzwania, sugestie.\n\n",
    "Podsumowanie powinno być dobrze zorganizowane, logicznie uporządkowane i zawierać wszystkie istotne szczegóły. ",
    "Podsumowanie powinno byc w formacie .md (Markdown) dostosowanym do możliwości Discord. ",
    "Nie zamykaj podsumowania w formacie .md (Markdown) w Discordowy blok kodu, tylko wyślij czysty Markdown który można wkleić w wiadomość Discord. ",
    "Nie pomijaj ważnych informacji, ale staraj się unikać nadmiernych szczegółów i powtórzeń. ",
    "Zachowaj profesjonalny i przejrzysty styl. ",
    "Nie halucynuj, nie przeklinaj, nie używaj wulgaryzmów. ",
    "Na spotkaniach omawiane będa osiągnięcia z poprzedniego tygodnia zespołów: ",
    "Aplikacja ToPWR, Planer, Cube3D/Led Cube, Aplikacja i strona Juwenalia, Strona katedry W4, Eventownik, Promochator. "
]

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
            logger.warn(
                "Missing OpenAI credentials. Transcription will be skipped."
            );
            return undefined;
        }

        if (!existsSync(audioFile)) {
            logger.warn(
                `Audio file ${audioFile} does not exist. Transcription will be skipped.`
            );
            return undefined;
        }

        const res = await this.client?.audio.transcriptions.create({
            file: createReadStream(audioFile),
            model: "whisper-1",
            language: "pl",
            response_format: "verbose_json",
            timestamp_granularities: ["segment"],

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
            logger.warn(
                "Missing OpenAI credentials. Assigning users to segments will be skipped."
            );
            return segments;
        }

        const tree = new IntervalTree<{
            userId: string;
            start: number;
            end: number;
        }>();

        const startTime = Math.min(...userChunks.map((c) => c.globalTimestamp));

        userChunks.forEach((chunk) => {
            const start = chunk.globalTimestamp - startTime;
            const end = start + chunk.duration;
            tree.insert([start, end], {
                userId: chunk.userId,
                start,
                end,
            });
        });

        let lastKnownUserId: string | undefined;

        const augmentedSegments = segments.segments.map((segment, index) => {
            const segStartMs = segment.start * 1000;
            const segEndMs = segment.end * 1000;

            let maxOverlap = 0;
            let bestUserId: string | undefined;

            const matches = tree.search([segStartMs, segEndMs]);

            matches.forEach((interval) => {
                const overlapStart = Math.max(segStartMs, interval.start);
                const overlapEnd = Math.min(segEndMs, interval.end);
                const overlapDuration = overlapEnd - overlapStart;

                if (overlapDuration > maxOverlap) {
                    maxOverlap = overlapDuration;
                    bestUserId = interval.userId;
                }
            });

            // Fallbacks if no overlap found
            if (!bestUserId) {
                if (lastKnownUserId) {
                    bestUserId = lastKnownUserId; // Use previous speaker
                } else {
                    // Assign to closest chunk in time (first segment only or no history)
                    const closest = userChunks.reduce((closestChunk, chunk) => {
                        const chunkStart = chunk.globalTimestamp - startTime;
                        const distance = Math.abs(chunkStart - segStartMs);
                        return distance <
                            Math.abs(
                                closestChunk.globalTimestamp -
                                    startTime -
                                    segStartMs
                            )
                            ? chunk
                            : closestChunk;
                    }, userChunks[0]);
                    bestUserId = closest.userId;
                }
            }

            lastKnownUserId = bestUserId;

            return {
                ...segment,
                userId: bestUserId
            };
        });

        return {
            ...segments,
            segments: augmentedSegments,
        };
    }

    // TODO: implement after cutting the audio file to smaller parts
    mergeMultipleTranscriptions(transcriptions: TranscriptionVerbose[]) {
        throw new Error("Not implemented");
    }

    async summarize(transcriptionPath: string) {
        if (!this.authorized) {
            logger.warn(
                "Missing OpenAI credentials. Summarization will be skipped."
            );
            return null;
        }

        if (!existsSync(transcriptionPath)) {
            logger.warn(
                `Transcription file ${transcriptionPath} does not exist. Summarization will be skipped.`
            );
            return null;
        }
        
        try {
            const transcriptionData: TranscriptionVerbose = JSON.parse(
                readFileSync(transcriptionPath, 'utf-8')
            );

            const transcription = transcriptionData.text;

            if (!transcription || transcription.length === 0) {
                logger.warn(
                    `Transcription file ${transcriptionPath} is empty. Summarization will be skipped.`
                );
                return null;
            }

            const messages: OpenAI.ChatCompletionMessageParam[] = [
                { role: 'system', content: SYSTEM_CONTENT.join('') },
                { role: 'user', content: `${USER_CONTENT}${transcription}` },
            ];

            const response = await this.client?.chat.completions.create({
                model: MODEL,
                messages: messages,
            });

            return response ? response.choices[0].message.content : null;
        } catch(e) {
            logger.error(`Error during summarization: ${e}`);
            return null;
        }
    }
}

export const transcriber = new Transcriber();
