interface WhisperSegment {
  id: number;
  seek: number;
  start: number;          // sec
  end: number;            // sec
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export interface TranscriptionVerbose {
  task: string;
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export interface SegWithUserId extends WhisperSegment {
  userId?: string;
};