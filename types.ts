
export interface DataOverlay {
  title: string;
  subhead?: string;
  headers: string[];
  row: string[];
}

export interface Scene {
  dialogue: string; // Used for Audio/TTS (The "Notes")
  visualDescription: string;
  keyword: string; // For image generation/fetching
  durationInSeconds: number;
  backgroundColor: string;
  audioUrl?: string;
  phoneticDialogue?: string; // For better TTS pronunciation (Hiragana)
  dataOverlay: DataOverlay; // The text to be displayed on screen
}

export interface ReferenceMaterial {
  title: string;
  subhead: string;
  headers: string[];
  rows: string[][];
}

export interface VideoScript {
  topic: string;
  scenes: Scene[];
  totalDurationInSeconds: number;
  referenceMaterial: ReferenceMaterial;
}

export const FPS = 30;
export const TRANSITION_DURATION_IN_FRAMES = 15; // 0.5 seconds overlap
