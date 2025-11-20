
import React, { useState, useRef, useEffect } from 'react';
import { generateScript, generateSpeech, addAudioToScript } from './services/geminiService';
import { VideoScript, FPS, TRANSITION_DURATION_IN_FRAMES } from './types';
import { Player, PlayerRef } from '@remotion/player';
import { MyVideoComposition } from './components/RemotionVideo';
import { Loader2, Clapperboard, Play, FileText, AlertCircle, Download, RefreshCw, Music, Table, Image as ImageIcon, Monitor, Smartphone, Square as SquareIcon, Mic, Wand2, FileAudio, Speaker } from 'lucide-react';

type AspectRatio = '16:9' | '1:1' | '9:16';

// --- WAV Export Helpers ---
const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

const exportWav = (audioBuffer: AudioBuffer) => {
  const numChannels = 1; // Export as mono for speech
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const length = audioBuffer.length * numChannels * (bitDepth / 8);
  const buffer = new ArrayBuffer(44 + length);
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
  view.setUint16(32, numChannels * (bitDepth / 8), true);
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write data
  const channelData = audioBuffer.getChannelData(0); 
  let offset = 44;
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
};

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false); // Script loading
  const [audioLoading, setAudioLoading] = useState(false); // Batch Audio loading
  const [audioProgress, setAudioProgress] = useState<{current: number, total: number} | null>(null);
  const [videoData, setVideoData] = useState<VideoScript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isExportingAudio, setIsExportingAudio] = useState(false);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState<'script' | 'reference'>('script');
  const [introBackground, setIntroBackground] = useState('https://myinfograph-b5831.web.app/haikei_v2.png');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
  const [recordingFormat, setRecordingFormat] = useState<{mime: string, ext: string} | null>(null);
  
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    // Check for supported media types on mount
    if (typeof MediaRecorder !== 'undefined') {
      const supportedFormats = [
        { mime: "video/mp4", ext: "mp4" },
        { mime: "video/webm; codecs=vp9", ext: "webm" },
        { mime: "video/webm", ext: "webm" }
      ];
      const selected = supportedFormats.find(f => MediaRecorder.isTypeSupported(f.mime));
      if (selected) {
        setRecordingFormat(selected);
      } else {
        // Fallback default
        setRecordingFormat({ mime: "video/webm", ext: "webm" });
      }
    }
  }, []);

  // Step 1: Generate Script
  const handleGenerate = async () => {
    if (!prompt.trim()) return;

    setLoading(true);
    setError(null);
    setVideoData(null);
    setAudioProgress(null);
    setActiveTab('script');

    try {
      const data = await generateScript(prompt);
      setVideoData(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate video script.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Generate Audio Batch
  const handleBatchGenerateAudio = async () => {
    if (!videoData) return;
    
    setAudioLoading(true);
    setAudioProgress({ current: 0, total: videoData.scenes.length });

    try {
      const updatedData = await addAudioToScript(videoData, (completed, total) => {
        setAudioProgress({ current: completed, total });
      });
      setVideoData(updatedData);
    } catch (err) {
      console.error("Batch Audio Error:", err);
      alert("Some audio files failed to generate.");
    } finally {
      setAudioLoading(false);
      setAudioProgress(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  };

  const handlePhoneticChange = (index: number, value: string) => {
    if (!videoData) return;
    const newScenes = [...videoData.scenes];
    newScenes[index] = { ...newScenes[index], phoneticDialogue: value };
    setVideoData({ ...videoData, scenes: newScenes });
  };

  // Individual audio regeneration (for corrections)
  const handleRegenerateAudio = async (index: number) => {
    if (!videoData) return;
    const scene = videoData.scenes[index];
    
    setRegeneratingIds(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });

    try {
      // Fallback to dialogue if phonetic is empty
      let textToSpeak = (scene.phoneticDialogue || scene.dialogue || "").trim();
      
      const speakerRegex = /^(じぇんば|あいば)[:：]/;
      
      if (!speakerRegex.test(textToSpeak)) {
         const originalSpeakerMatch = scene.dialogue.match(speakerRegex);
         const speaker = originalSpeakerMatch ? originalSpeakerMatch[1] : 'じぇんば';
         
         textToSpeak = `${speaker}: ${textToSpeak}`;
         
         // Update the state with the fixed prefix so the UI matches
         const newScenes = [...videoData.scenes];
         newScenes[index] = { ...newScenes[index], phoneticDialogue: textToSpeak };
         setVideoData({ ...videoData, scenes: newScenes });
      }

      const result = await generateSpeech(textToSpeak);
      if (result) {
        setVideoData(prev => {
          if (!prev) return null;
          const newScenes = [...prev.scenes];
          
          const audioDuration = result.duration + 0.6; 
          const finalDuration = Math.max(newScenes[index].durationInSeconds, audioDuration);

          newScenes[index] = {
            ...scene,
            phoneticDialogue: textToSpeak, 
            audioUrl: result.audioUrl,
            durationInSeconds: finalDuration
          };

          const totalDuration = newScenes.reduce((acc, s) => acc + s.durationInSeconds, 0);
          return { ...prev, scenes: newScenes, totalDurationInSeconds: Math.ceil(totalDuration) };
        });
      }
    } catch (error) {
      console.error("Failed to regenerate audio:", error);
      alert("Failed to regenerate audio. Please try again.");
    } finally {
      setRegeneratingIds(prev => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  const getDurationInFrames = () => {
    if (!videoData) return 0;
    const totalSceneFrames = videoData.scenes.reduce(
      (acc, scene) => acc + Math.ceil(scene.durationInSeconds * FPS),
      0
    );
    const overlapFrames = Math.max(0, videoData.scenes.length - 1) * TRANSITION_DURATION_IN_FRAMES;
    return totalSceneFrames - overlapFrames;
  };

  const getDimensions = () => {
    switch (aspectRatio) {
      case '16:9': return { width: 1280, height: 720 };
      case '1:1': return { width: 1080, height: 1080 };
      case '9:16': return { width: 720, height: 1280 };
      default: return { width: 1280, height: 720 };
    }
  };

  const { width: compositionWidth, height: compositionHeight } = getDimensions();
  const hasAudio = videoData?.scenes.every(s => !!s.audioUrl) ?? false;

  // --- Export Single Merged WAV File ---
  const downloadAudioTrack = async () => {
    if (!videoData || !hasAudio) return;
    
    setIsExportingAudio(true);
    try {
      const CtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new CtxClass();
      
      // 1. Fetch all audio data & Decode
      const buffers: { buffer: AudioBuffer, start: number }[] = [];
      let currentFrame = 0;
      
      // We must follow the exact same timing logic as the video player
      for (const scene of videoData.scenes) {
        if (scene.audioUrl) {
          const response = await fetch(scene.audioUrl);
          const arrayBuffer = await response.arrayBuffer();
          const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
          
          const startSeconds = currentFrame / FPS;
          buffers.push({ buffer: audioBuffer, start: startSeconds });
        }
        
        const durationInFrames = Math.ceil(scene.durationInSeconds * FPS);
        const nextFrame = currentFrame + Math.max(0, durationInFrames - TRANSITION_DURATION_IN_FRAMES);
        currentFrame = nextFrame;
      }
      
      const totalDuration = currentFrame / FPS;
      
      // 2. Render offline to mix them
      // 44100Hz is standard for WAV export
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(totalDuration * 44100), 44100);
      
      buffers.forEach(({ buffer, start }) => {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineCtx.destination);
        source.start(start);
      });
      
      const renderedBuffer = await offlineCtx.startRendering();
      
      // 3. Convert to WAV Blob
      const wavBlob = exportWav(renderedBuffer);
      
      // 4. Trigger Download
      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${videoData.topic.replace(/\s+/g, '_')}_full_audio.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
    } catch (e) {
      console.error("Audio export failed", e);
      alert("Failed to export audio track. Please try again.");
    } finally {
      setIsExportingAudio(false);
    }
  };

  const downloadVideo = async () => {
    if (!videoData) return;
    if (!hasAudio) {
      if(!window.confirm("Voiceovers have not been generated yet. The video will be silent. Continue?")) return;
    }

    try {
      const confirmRec = window.confirm(
        "To download the video, we need to record your screen.\n\n" +
        "1. Select the 'Chrome Tab' (or 'This Tab') option.\n" +
        "2. Select this page.\n" +
        "3. Click 'Share'.\n\nThe recording will happen automatically."
      );
      
      if (!confirmRec) return;

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          displaySurface: "browser",
        } as any,
        audio: true,
        preferCurrentTab: true, 
      } as any);

      setIsRecording(true);
      await new Promise(resolve => setTimeout(resolve, 800));

      // Prioritize MP4 if supported, else fallback to WebM
      const mimeType = recordingFormat ? recordingFormat.mime : "video/webm";
      const extension = recordingFormat ? recordingFormat.ext : "webm";
      
      // Note: Chrome might claim to support 'video/mp4' but fail to record properly without specific codecs
      // so we rely on the useEffect check which filters common types.
      
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${videoData.topic.replace(/\s+/g, '_')}_${aspectRatio}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        stream.getTracks().forEach(track => track.stop());
        setIsRecording(false);
      };

      mediaRecorder.start();
      
      if (playerRef.current) {
        playerRef.current.seekTo(0);
        playerRef.current.play();
      }

      const durationInSeconds = getDurationInFrames() / FPS;
      const durationMs = (durationInSeconds * 1000) + 1000;

      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
           mediaRecorder.stop();
           if (playerRef.current) {
             playerRef.current.pause();
           }
        }
      }, durationMs);

    } catch (err) {
      console.error("Recording error:", err);
      setIsRecording(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-950 to-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Header & Input Section */}
        <div className={`lg:col-span-4 flex flex-col gap-6 ${isRecording ? 'hidden' : ''}`}>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-purple-400">
              <Clapperboard className="w-8 h-8" />
              <h1 className="text-2xl font-bold tracking-tight">AI Podcast Director</h1>
            </div>
            <p className="text-slate-400 text-sm">
              Create a video podcast featuring <b>Jenba</b> and <b>Aiba</b>.
            </p>
          </div>

          <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-5 shadow-xl space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
                Topic
              </label>
              <textarea
                className="w-full bg-slate-900/80 border border-slate-700 rounded-lg p-3 text-slate-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all resize-none min-h-[100px]"
                placeholder="例：週末のジャパンカップについて。じぇんばが興奮気味に話し、あいばが過去のデータを冷静に分析する。"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading || audioLoading}
              />
            </div>

            <div>
               <label className="block text-xs font-semibold uppercase text-slate-500 mb-2">
                Aspect Ratio
              </label>
              <div className="grid grid-cols-3 gap-2">
                {['16:9', '1:1', '9:16'].map((ratio) => (
                  <button 
                    key={ratio}
                    onClick={() => setAspectRatio(ratio as AspectRatio)}
                    className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 ${
                      aspectRatio === ratio
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300' 
                      : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    {ratio === '16:9' && <Monitor className="w-5 h-5" />}
                    {ratio === '1:1' && <SquareIcon className="w-5 h-5" />}
                    {ratio === '9:16' && <Smartphone className="w-5 h-5" />}
                    <span className="text-[10px] font-medium">{ratio}</span>
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-500 mb-2 flex items-center gap-2">
                <ImageIcon className="w-3 h-3" />
                Intro Background URL
              </label>
              <input
                type="text"
                className="w-full bg-slate-900/80 border border-slate-700 rounded-lg p-2 text-xs text-slate-300 focus:ring-2 focus:ring-purple-500 outline-none"
                value={introBackground}
                onChange={(e) => setIntroBackground(e.target.value)}
                placeholder="https://example.com/background.png"
              />
            </div>
            
            {/* Primary Action: Generate Script */}
            <button
              onClick={handleGenerate}
              disabled={loading || audioLoading || !prompt.trim()}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-semibold transition-all shadow-lg
                ${loading || audioLoading
                  ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-purple-900/20'
                }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span>Generating Script...</span>
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 fill-current" />
                  <span>1. Generate Script</span>
                </>
              )}
            </button>
            
            {error && (
              <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-lg flex items-start gap-3 text-red-200 text-sm">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}
          </div>

          {videoData && (
             <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl flex flex-col shadow-xl flex-grow overflow-hidden max-h-[600px]">
               
               {/* Secondary Action: Generate Audio (Sticky at top of script) */}
               <div className="p-4 border-b border-slate-700 bg-slate-800/80 backdrop-blur-sm z-10">
                  <button
                    onClick={handleBatchGenerateAudio}
                    disabled={audioLoading || loading}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold transition-all shadow-md border border-transparent
                      ${audioLoading 
                        ? 'bg-slate-700 text-slate-300 cursor-wait' 
                        : hasAudio 
                          ? 'bg-slate-700 text-slate-300 hover:bg-slate-600 border-slate-600' 
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20'
                      }`}
                  >
                    {audioLoading ? (
                      <>
                         <Loader2 className="w-4 h-4 animate-spin" />
                         <span>Generating Voiceovers {audioProgress ? `(${audioProgress.current}/${audioProgress.total})` : '...'}</span>
                      </>
                    ) : hasAudio ? (
                      <>
                         <RefreshCw className="w-4 h-4" />
                         <span>Regenerate All Voiceovers</span>
                      </>
                    ) : (
                      <>
                         <FileAudio className="w-4 h-4" />
                         <span>2. Generate Voiceover</span>
                      </>
                    )}
                  </button>
                  {audioLoading && audioProgress && (
                    <div className="w-full bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                       <div 
                         className="bg-emerald-500 h-full transition-all duration-300 ease-out" 
                         style={{ width: `${(audioProgress.current / audioProgress.total) * 100}%` }}
                       />
                    </div>
                  )}
               </div>

               <div className="flex border-b border-slate-700">
                 <button
                   onClick={() => setActiveTab('script')}
                   className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                     activeTab === 'script' 
                       ? 'bg-slate-700/50 text-white border-b-2 border-purple-500' 
                       : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                   }`}
                 >
                   <FileText className="w-4 h-4" />
                   Script
                 </button>
                 <button
                   onClick={() => setActiveTab('reference')}
                   className={`flex-1 p-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                     activeTab === 'reference' 
                       ? 'bg-slate-700/50 text-white border-b-2 border-purple-500' 
                       : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'
                   }`}
                 >
                   <Table className="w-4 h-4" />
                   Reference
                 </button>
               </div>

               <div className="flex-grow overflow-auto p-5">
                 {activeTab === 'script' ? (
                   <div className="space-y-8">
                     {videoData.scenes.map((scene, idx) => (
                       <div key={idx} className={`relative pl-4 border-l-2 transition-colors group ${scene.audioUrl ? 'border-purple-500/30' : 'border-slate-700'}`}>
                         <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-900 border-2 ${scene.audioUrl ? 'border-purple-500/50 bg-purple-500/20' : 'border-slate-700'}`}></div>
                         <div className="flex justify-between items-start">
                           <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-1">
                             Scene {idx + 1}: {scene.dataOverlay.title}
                           </h3>
                           <div className="flex items-center gap-2 text-xs text-slate-500">
                             <Music className={`w-3 h-3 ${scene.audioUrl ? 'text-emerald-400' : 'text-slate-600'}`} />
                             {scene.durationInSeconds.toFixed(1)}s
                           </div>
                         </div>
                         <p className="text-slate-300 text-sm leading-relaxed mb-3 whitespace-pre-line border-b border-slate-800 pb-2">
                           {scene.dialogue}
                         </p>

                         {/* Audio Adjustment Section */}
                         <div className="bg-slate-900/40 rounded p-2 mb-2 border border-slate-800">
                           <div className="flex items-center justify-between mb-1">
                             <label className="block text-[10px] uppercase text-slate-500 font-semibold flex items-center gap-1">
                               <Mic className="w-3 h-3" /> 
                               Edit Hiragana (Fix Intonation)
                             </label>
                             <span className="text-[9px] text-slate-500 italic">Use spaces/commas for rhythm</span>
                           </div>
                           <textarea 
                             className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-300 min-h-[50px] focus:ring-1 focus:ring-indigo-500 outline-none"
                             value={scene.phoneticDialogue || ''}
                             onChange={(e) => handlePhoneticChange(idx, e.target.value)}
                             placeholder="じぇんば: こんにちは"
                           />
                           <div className="flex items-center justify-between mt-2">
                              <div className="flex items-center gap-2 w-full">
                                 <button 
                                   onClick={() => handleRegenerateAudio(idx)}
                                   disabled={regeneratingIds.has(idx) || audioLoading}
                                   className={`flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded border transition-all font-medium shadow-sm
                                     ${regeneratingIds.has(idx) 
                                       ? 'bg-indigo-900/20 border-indigo-900 text-indigo-400 cursor-wait' 
                                       : scene.audioUrl 
                                         ? 'bg-indigo-900/50 border-indigo-700 text-indigo-200 hover:bg-indigo-900'
                                         : 'bg-emerald-900/50 border-emerald-700 text-emerald-200 hover:bg-emerald-900 flex-grow justify-center' // Prominent for missing audio
                                     }`}
                                 >
                                   <RefreshCw className={`w-3 h-3 ${regeneratingIds.has(idx) ? 'animate-spin' : ''}`} />
                                   {scene.audioUrl ? 'Retry Audio' : 'Generate Audio'}
                                 </button>
                                 
                                 {scene.audioUrl ? (
                                   <audio 
                                    src={scene.audioUrl} 
                                    controls 
                                    controlsList="nodownload noplaybackrate"
                                    className="h-7 w-24 opacity-80 scale-90 origin-right" 
                                   />
                                 ) : !regeneratingIds.has(idx) && (
                                    <span className="text-[10px] text-amber-500 flex items-center gap-1 whitespace-nowrap">
                                      <AlertCircle className="w-3 h-3" />
                                      Missing
                                    </span>
                                 )}
                               </div>
                           </div>
                         </div>

                         <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-900/50 p-2 rounded">
                            <span className="font-medium text-slate-400">Visual:</span>
                            <span className="italic truncate">{scene.visualDescription}</span>
                         </div>
                       </div>
                     ))}
                   </div>
                 ) : (
                   <div className="space-y-4">
                      {videoData.referenceMaterial ? (
                        <>
                           <div className="text-center mb-6">
                              <h3 className="text-lg font-bold text-white">{videoData.referenceMaterial.title}</h3>
                              <p className="text-sm text-purple-300 mt-1">{videoData.referenceMaterial.subhead}</p>
                           </div>
                           <div className="overflow-x-auto rounded-lg border border-slate-700">
                             <table className="w-full text-sm text-left text-slate-300">
                               <thead className="text-xs text-slate-400 uppercase bg-slate-900/80">
                                 <tr>
                                   {videoData.referenceMaterial.headers.map((header, hIdx) => (
                                     <th key={hIdx} className="px-4 py-3 border-b border-slate-700">{header}</th>
                                   ))}
                                 </tr>
                               </thead>
                               <tbody>
                                 {videoData.referenceMaterial.rows.map((row, rIdx) => (
                                   <tr key={rIdx} className="bg-slate-800/30 hover:bg-slate-800/60 border-b border-slate-700/50 last:border-0">
                                     {row.map((cell, cIdx) => (
                                       <td key={cIdx} className="px-4 py-3 border-r border-slate-700/30 last:border-0">{cell}</td>
                                     ))}
                                   </tr>
                                 ))}
                               </tbody>
                             </table>
                           </div>
                        </>
                      ) : (
                        <div className="text-slate-500 text-center py-10 text-sm">
                          No reference material generated.
                        </div>
                      )}
                   </div>
                 )}
               </div>
             </div>
          )}
        </div>

        {/* Player Section */}
        <div className={`${isRecording ? 'col-span-12 h-screen' : 'lg:col-span-8'} flex flex-col h-full min-h-[500px]`}>
          <div className={`
            flex-grow bg-black shadow-2xl overflow-hidden flex items-center justify-center bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]
            ${isRecording ? 'fixed inset-0 z-50 !rounded-none !border-0' : 'rounded-2xl border border-slate-800 relative'}
          `}>
            {videoData ? (
              <div className={`shadow-2xl flex items-center justify-center ${isRecording ? 'w-full h-full' : 'w-full h-full'}`}>
                 <div 
                   style={{
                     aspectRatio: aspectRatio.replace(':', '/'),
                     width: aspectRatio === '16:9' ? '100%' : 'auto',
                     height: aspectRatio === '16:9' ? 'auto' : '100%',
                     maxWidth: '100%',
                     maxHeight: isRecording ? '100vh' : '80vh',
                     display: 'flex'
                   }}
                 >
                   <Player
                    ref={playerRef}
                    component={MyVideoComposition}
                    inputProps={{ 
                      scenes: videoData.scenes,
                      introBgUrl: introBackground
                    }}
                    durationInFrames={getDurationInFrames()}
                    compositionWidth={compositionWidth}
                    compositionHeight={compositionHeight}
                    fps={FPS}
                    style={{
                      width: '100%',
                      height: '100%',
                    }}
                    controls={!isRecording}
                    autoPlay={!isRecording}
                    loop={!isRecording}
                  />
                 </div>
              </div>
            ) : (
              <div className="text-center p-10 opacity-50">
                <div className="w-20 h-20 bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Play className="w-8 h-8 text-slate-500 ml-1" />
                </div>
                <h3 className="text-xl font-semibold text-slate-300">Ready to create</h3>
                <p className="text-slate-500 max-w-md mx-auto mt-2">
                  Enter a prompt to generate a video script featuring Jenba and Aiba.
                </p>
              </div>
            )}
          </div>
          
          {videoData && !isRecording && (
            <div className="mt-4 flex justify-between items-center px-2">
              <div className="text-sm text-slate-400">
                Total Duration: <span className="text-white font-medium">{videoData.totalDurationInSeconds}s</span>
              </div>
              <div className="flex items-center gap-3">
                 <div className="text-sm text-slate-400 mr-2 hidden md:block">
                   Topic: <span className="text-white font-medium">{videoData.topic}</span>
                 </div>
                 
                 {/* Audio Only Download */}
                 <button 
                   onClick={downloadAudioTrack}
                   disabled={!hasAudio || isExportingAudio}
                   title="Download just the audio track (WAV) for local editing"
                   className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors
                     ${hasAudio 
                       ? 'bg-slate-800 hover:bg-slate-700 text-purple-300 border-purple-900/50' 
                       : 'bg-slate-800/50 text-slate-500 border-slate-800 cursor-not-allowed'}`}
                 >
                   {isExportingAudio ? <Loader2 className="w-4 h-4 animate-spin" /> : <Speaker className="w-4 h-4" />}
                   <span className="hidden sm:inline">Audio (WAV)</span>
                 </button>

                 {/* Video Download */}
                 <button 
                   onClick={downloadVideo}
                   disabled={!hasAudio}
                   title={!hasAudio ? "Generate audio first" : `Download as .${recordingFormat?.ext || 'webm'}`}
                   className={`flex items-center gap-2 text-sm px-4 py-2 rounded-lg border transition-colors font-semibold
                     ${hasAudio 
                       ? 'bg-purple-600 hover:bg-purple-500 text-white border-purple-500 shadow-lg shadow-purple-900/30' 
                       : 'bg-slate-800/50 text-slate-500 border-slate-800 cursor-not-allowed'}`}
                 >
                   <Download className="w-4 h-4" />
                   <span>Download Video {recordingFormat ? `(.${recordingFormat.ext})` : ''}</span>
                 </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default App;
