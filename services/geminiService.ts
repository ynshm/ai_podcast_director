
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { VideoScript, Scene } from "../types";

const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    topic: {
      type: Type.STRING,
      description: "The main topic of the video.",
    },
    referenceMaterial: {
      type: Type.OBJECT,
      description: "Master structured data table for the whole video.",
      properties: {
        title: { type: Type.STRING, description: "Main Title." },
        subhead: { type: Type.STRING, description: "Context/Subtitle." },
        headers: { 
          type: Type.ARRAY, 
          items: { type: Type.STRING },
          description: "Column headers."
        },
        rows: {
          type: Type.ARRAY,
          items: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "Row data."
          },
          description: "All data rows."
        }
      },
      required: ["title", "subhead", "headers", "rows"]
    },
    scenes: {
      type: Type.ARRAY,
      description: "A sequence of slides presenting the data.",
      items: {
        type: Type.OBJECT,
        properties: {
          dataOverlay: {
            type: Type.OBJECT,
            description: "The TEXT to be displayed on the video screen. This must be structured data.",
            properties: {
              title: { type: Type.STRING, description: "Slide Title (e.g., 'Step 1' or 'Category A')." },
              subhead: { type: Type.STRING, description: "Slide Subhead." },
              headers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Relevant headers for this specific slide." },
              row: { type: Type.ARRAY, items: { type: Type.STRING }, description: "The specific data values for this slide." }
            },
            required: ["title", "headers", "row"]
          },
          dialogue: {
            type: Type.STRING,
            description: "The SPEAKER NOTES (Audio Script). Format: 'じぇんば: [text]' or 'あいば: [text]'.",
          },
          phoneticDialogue: {
            type: Type.STRING,
            description: "STRICTLY HIRAGANA ONLY version. Numbers converted to text. Spaces between phrases. Must include speaker prefix.",
          },
          visualDescription: {
            type: Type.STRING,
            description: "Description of the background image mood.",
          },
          keyword: {
            type: Type.STRING,
            description: "English keyword for stock photo.",
          },
          durationInSeconds: {
            type: Type.NUMBER,
            description: "Duration in seconds.",
          },
          backgroundColor: {
            type: Type.STRING,
            description: "Hex color code.",
          },
        },
        required: ["dataOverlay", "dialogue", "phoneticDialogue", "visualDescription", "keyword", "durationInSeconds", "backgroundColor"],
      },
    },
    totalDurationInSeconds: {
      type: Type.NUMBER,
      description: "Total duration.",
    },
  },
  required: ["topic", "scenes", "totalDurationInSeconds", "referenceMaterial"],
};

// Helper to convert Base64 PCM to a WAV Blob URL
const pcmToWav = (base64Pcm: string, sampleRate = 24000): string => {
  const binaryString = atob(base64Pcm);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const dataLength = bytes.length;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  const wavBytes = new Uint8Array(buffer);
  wavBytes.set(bytes, 44);

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

export const generateSpeech = async (text: string): Promise<{ audioUrl: string; duration: number } | null> => {
  try {
    // Ensure the text has the correct context for the model
    const prompt = `
      Generate audio for the following dialogue. 
      Strictly adhere to the speaker definitions:
      - "じぇんば" (Jenba) -> Charon (Energetic, Host)
      - "あいば" (Aiba) -> Kore (Calm, Analyst)
      
      Input text (Hiragana preferred for intonation):
      ${text}
    `;

    const response = await genAI.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: {
        parts: [{ text: prompt }],
      },
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: 'じぇんば',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } }
              },
              {
                speaker: 'あいば',
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
              }
            ]
          }
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    
    if (!base64Audio) return null;

    const byteLength = atob(base64Audio).length;
    const duration = byteLength / (24000 * 2 * 1);
    const audioUrl = pcmToWav(base64Audio, 24000);
    return { audioUrl, duration };

  } catch (e) {
    console.error("TTS Error", e);
    return null;
  }
};

// STEP 1: Generate Script Only
export const generateScript = async (prompt: string): Promise<VideoScript> => {
  try {
    const scriptModel = "gemini-2.5-flash";
    const systemInstruction = `
      You are an expert podcast and video creator. You generate scripts for a duo: "じぇんば" (Jenba) and "あいば" (Aiba).

      *** SPEAKER ROLES ***
      1. "じぇんば" (Jenba):
         - Role: Host / MC.
         - Personality: Energetic, enthusiastic. Talks about the "fun" and "excitement" (e.g., the thrill of horse racing).
         - Tone: Lively.

      2. "あいば" (Aiba):
         - Role: Analyst / Expert.
         - Personality: Calm, logical, intellectual. Focuses on "data", "analysis", and "probabilities".
         - Tone: Composed.

      *** DIALOGUE RULES (CRITICAL) ***
      1. ALTERNATE SPEAKERS: Never have the same person speak two scenes in a row. (Jenba -> Aiba -> Jenba -> Aiba).
      2. NO SIMULTANEOUS SPEECH: Do not create parts where they speak at the same time.
      3. SELF-INTRODUCTIONS: If they introduce themselves, ensure Jenba says "Jenba" and Aiba says "Aiba". Do not mix them up.
      4. NO STAGE DIRECTIONS: Do not include text like (BGM), (Music start), (Laughs) in the dialogue fields. Only spoken words.

      *** VISUAL OUTPUT RULES ***
      - The screen must display STRUCTURED DATA (Title, Subhead, Headers, Row Values) that matches what they are discussing.
      - Do not put the conversation text on the screen dataOverlay. The screen is for facts/data.

      *** PHONETIC DIALOGUE (phoneticDialogue) RULES - STRICT ***
      The 'phoneticDialogue' field is used for Text-to-Speech generation. You MUST follow these formatting rules:
      1. HIRAGANA ONLY: Convert all Kanji and Katakana to Hiragana.
      2. NUMBERS TO HIRAGANA: Convert all numbers to words (e.g., "100%" -> "ひゃく ぱーせんと", "3番" -> "さん ばん").
      3. BUNSETSU SPACING: Insert a half-width space ( ) between every phrase/bunsetsu to ensure natural pauses and rhythm.
         - Bad: "きょうはいいてんきですね"
         - Good: "きょう は いい てんき です ね"
      4. SPEAKER PREFIX: Must start with "じぇんば:" or "あいば:".

      Requirements:
      1. Create 'referenceMaterial' (the full dataset).
      2. Create 'scenes'. 
      3. Fill 'phoneticDialogue' strictly according to the rules above.
    `;

    const result = await genAI.models.generateContent({
      model: scriptModel,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: SCHEMA,
        temperature: 0.7,
      }
    });

    const text = result.text;
    if (!text) {
      throw new Error("No content generated from Gemini.");
    }

    const data = JSON.parse(text) as VideoScript;

    // Clean up phoneticDialogue for initial display
    // This removes Markdown artifacts so the user sees clean text in the editor
    data.scenes = data.scenes.map(scene => {
        let cleanText = scene.phoneticDialogue || scene.dialogue || "";
        cleanText = cleanText.replace(/^[\s\*\-\d\.]+(?=(じぇんば|あいば)[:：])/, '');
        return { ...scene, phoneticDialogue: cleanText };
    });

    return data;

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw new Error("Failed to generate video script. Please try again.");
  }
};

// STEP 2: Generate Audio & Link to Script
export const addAudioToScript = async (
  currentScript: VideoScript, 
  onProgress?: (completed: number, total: number) => void
): Promise<VideoScript> => {
    const scenesWithAudio: Scene[] = [];
    const totalScenes = currentScript.scenes.length;
    
    for (let i = 0; i < totalScenes; i++) {
      const scene = currentScript.scenes[i];
      let textToSpeak = scene.phoneticDialogue || scene.dialogue || "じぇんば: ...";

      // 1. Clean up potential markdown bullets (e.g., "* じぇんば:", "1. じぇんば:")
      // Duplicate check here to be safe if user edited it weirdly
      textToSpeak = textToSpeak.replace(/^[\s\*\-\d\.]+(?=(じぇんば|あいば)[:：])/, '');

      // 2. Normalize speaker prefix
      const speakerRegex = /^(じぇんば|あいば)[:：]/;
      
      if (!speakerRegex.test(textToSpeak)) {
         // Attempt to infer from dialogue or default to Jenba
         const dialogueMatch = scene.dialogue.match(speakerRegex);
         if (dialogueMatch) {
           textToSpeak = `${dialogueMatch[1]}: ${textToSpeak}`;
         } else {
           textToSpeak = `じぇんば: ${textToSpeak}`;
         }
      }

      const audioResult = await generateSpeech(textToSpeak);
      
      if (audioResult) {
        // Add 0.6s buffer: 0.5s covers the visual transition, 0.1s is pure silence buffer
        const audioDuration = audioResult.duration + 0.6;
        const finalDuration = Math.max(scene.durationInSeconds, audioDuration);
        
        scenesWithAudio.push({
          ...scene,
          phoneticDialogue: textToSpeak, // Save the properly prefixed version
          audioUrl: audioResult.audioUrl,
          durationInSeconds: finalDuration
        });
      } else {
        // If audio generation fails, keep original scene without audioUrl
        console.warn("Audio generation failed for scene:", textToSpeak);
        scenesWithAudio.push(scene);
      }

      if (onProgress) onProgress(i + 1, totalScenes);
    }

    const totalDuration = scenesWithAudio.reduce((acc, s) => acc + s.durationInSeconds, 0);

    return {
      ...currentScript,
      scenes: scenesWithAudio,
      totalDurationInSeconds: Math.ceil(totalDuration)
    };
};
