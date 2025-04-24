import { AudioReceiveStream } from "@discordjs/voice";
import { createWriteStream } from "fs";
import { PassThrough } from "stream";

export interface AudioSettings {
  channels: 1 | 2,
  rate: sample_rate,
  frameSize: number,
  bitrate: string,
}

export interface UserStreams {
  audioStream: AudioReceiveStream;
  pcmStream: PassThrough;
  fileStream: ReturnType<typeof createWriteStream>;
}