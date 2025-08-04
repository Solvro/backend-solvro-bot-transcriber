import OpenAI from "openai";
import { logger } from "@utils/logger";
import { createReadStream, existsSync, readFileSync } from "fs";
import IntervalTree from "@flatten-js/interval-tree";
import { UserChunk } from "types/voice";
import { TranscriptionVerbose, SegWithUserId } from "types/transcriber";

const MODEL = "gpt-4o";
const USER_CONTENT = "Podsumuj tę transkrypcję:\n"
const SYSTEM_CONTENT = [
  "Jesteś profesjonalnym asystentem, który tworzy zwięzłe, czytelne i logicznie uporządkowane podsumowanie transkrypcji spotkania członków koła naukowego **Solvro** na Politechnice Wrocławskiej.",
  "Twoim celem jest przedstawienie kluczowych informacji w sposób naturalny, przejrzysty i bez zbędnych szczegółów. Unikaj zmyślania lub halucynowania danych – trzymaj się treści transkrypcji.",

  "Koło działa w sekcjach: frontend, backend, devops, ai/ml, promocja, mobile, ui/ux, hardware, management.",
  "Realizowane projekty to m.in.: ToPWR, Planer, Aplikacja i strona Juwenalia, Strona katedry W4, Eventownik, Promochator, SolvroBot, Strona PWr Racing Team, Testownik, Psycho, Zdrowie gra pierwsze skrzypce. W projektach mogą pojawiać się zniekształcone lub błędnie zapisane nazwy – postaraj się je rozpoznać na podstawie kontekstu.",

  "Zidentyfikuj, czy spotkanie miało charakter statusowy (np. cotygodniowy update), czy edukacyjny, organizacyjny lub inny (np. warsztat, kurs, prezentacja). Dopasuj styl i strukturę podsumowania do typu spotkania.",

  "Jeśli pojawiają się konkretne projekty, zorganizuj podsumowanie **według tych projektów**. Nie twórz sekcji dla projektów, które nie zostały wspomniane.",
  "Dla każdego projektu lub tematu przygotuj krótką, rzeczową notatkę – może to być kilka zdań opisujących, co zostało omówione, ustalone lub zaplanowane. Nie musisz stosować sztywnego formatu (np. 'tematy', 'decyzje', 'zadania'), ale zwracaj uwagę na te elementy jeśli się pojawiają.",
  "Pomiń projekt lub temat, jeśli nie pojawił się w transkrypcji – nie twórz sztucznych wpisów.",

  "Używaj **czystego Markdowna**, bez zamykania w bloku kodu. Format powinien być dostosowany do Discorda: czytelne nagłówki, wypunktowania lub krótkie akapity.",
  "Styl powinien być profesjonalny i naturalny. Unikaj powtórzeń, wulgaryzmów i nadmiaru ozdobników. Dąż do tego, aby podsumowanie było **zwięzłe, konkretne i wartościowe** – lepiej krótsze, ale trafne.",
  "Dla przejrzystości możesz używać emoji aby treść była lepsza dla oka"
];


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
