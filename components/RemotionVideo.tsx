
import React, { useMemo } from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate, spring, useVideoConfig, Img, Easing, Audio } from 'remotion';
import { Scene, FPS, TRANSITION_DURATION_IN_FRAMES } from '../types';

interface Props {
  scenes: Scene[];
  introBgUrl?: string;
}

interface SceneProps {
  scene: Scene;
  index: number;
  introBgUrl?: string;
}

// Helper to split Japanese text into natural chunks for subtitles
const splitDialogueIntoChunks = (text: string): string[] => {
  // Remove speaker prefix if present
  const cleanText = text.replace(/^(じぇんば|あいば)[:：]/, '').trim();
  
  // Split by sentence endings first
  const sentences = cleanText.split(/(?<=[。！？!?])\s*/).filter(s => s.length > 0);
  
  const chunks: string[] = [];
  
  sentences.forEach(sentence => {
    if (sentence.length < 25) {
      chunks.push(sentence);
    } else {
      // If sentence is too long, split by commas
      const subParts = sentence.split(/(?<=[、,])\s*/);
      let currentChunk = "";
      
      subParts.forEach(part => {
        if ((currentChunk + part).length > 30) {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = part;
        } else {
          currentChunk += part;
        }
      });
      if (currentChunk) chunks.push(currentChunk);
    }
  });

  return chunks;
};

const SceneComponent: React.FC<SceneProps> = ({ scene, index, introBgUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Calculate transition progress for slide-in effect
  const slideProgress = interpolate(frame, [0, TRANSITION_DURATION_IN_FRAMES], [0, 1], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });

  const xOffset = index === 0 
    ? 0 
    : interpolate(slideProgress, [0, 1], [100, 0]);
  
  const containerOpacity = index === 0
    ? interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' })
    : 1;

  // Entrance animation for data card
  const cardEntrance = spring({
    frame: Math.max(0, frame - (index === 0 ? 0 : 10)),
    fps,
    config: { damping: 15 },
  });

  const cardScale = interpolate(cardEntrance, [0, 1], [0.9, 1]);
  const cardOpacity = interpolate(cardEntrance, [0, 1], [0, 1]);

  // Background subtle zoom
  const bgScale = interpolate(frame, [0, scene.durationInSeconds * fps], [1, 1.1]);

  // Determine image source: Use introBgUrl for the first scene if available, otherwise dynamic logic
  const imgSrc = (index === 0 && introBgUrl) 
    ? introBgUrl 
    : `https://picsum.photos/seed/${scene.keyword}/1280/720`;


  // --- Subtitle Logic ---
  const chunks = useMemo(() => {
    const textChunks = splitDialogueIntoChunks(scene.dialogue);
    const totalChars = textChunks.join('').length;
    const totalDurationFrames = (scene.durationInSeconds * fps) - 15; // Buffer at end

    let currentStart = 0;
    return textChunks.map(text => {
      // Calculate duration based on character density
      const weight = Math.max(text.length, 5); // Minimum weight for short words
      const duration = (weight / Math.max(totalChars, 1)) * totalDurationFrames;
      
      const chunkObj = {
        text,
        startFrame: currentStart,
        endFrame: currentStart + duration
      };
      currentStart += duration;
      return chunkObj;
    });
  }, [scene.dialogue, scene.durationInSeconds, fps]);

  // Find active subtitle chunk
  const activeChunk = chunks.find(c => frame >= c.startFrame && frame < c.endFrame);
  
  // Animation for specific subtitle chunk
  const subtitleY = activeChunk 
    ? interpolate(frame - activeChunk.startFrame, [0, 10], [20, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) })
    : 0;
  const subtitleOpacity = activeChunk
    ? interpolate(frame - activeChunk.startFrame, [0, 10], [0, 1], { extrapolateRight: 'clamp' })
    : 0;


  return (
    <AbsoluteFill 
      className="bg-slate-950 overflow-hidden"
      style={{
        transform: `translateX(${xOffset}%)`,
        opacity: containerOpacity,
        boxShadow: index > 0 ? '-20px 0 50px rgba(0,0,0,0.8)' : 'none',
      }}
    >
      {/* 1. Background Layer */}
      <AbsoluteFill style={{ zIndex: 0 }}>
        <Img
          src={imgSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${bgScale})`,
            filter: 'blur(4px)' // Slight blur to keep focus on data
          }}
          alt={scene.visualDescription}
        />
        {/* Dark Gradient Overlay for Readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/60 via-slate-900/70 to-slate-950/90" />
        
        {/* Subtle Color Tint (based on AI suggestion) - blend mode overlay to not wash out */}
        <div 
          className="absolute inset-0 mix-blend-overlay opacity-40"
          style={{ backgroundColor: scene.backgroundColor }}
        />
      </AbsoluteFill>

      {/* 2. Content Layer - Using Flex Column to handle responsive layouts (Portrait/Landscape/Square) */}
      <AbsoluteFill className="z-10 flex flex-col justify-between p-8 md:p-12 h-full box-border">
        
        {/* Top: Title Section */}
        <div className="w-full text-center pt-4 shrink-0">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white uppercase tracking-widest drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)]">
            {scene.dataOverlay.title}
          </h1>
          {scene.dataOverlay.subhead && (
            <h3 className="text-purple-200 text-lg md:text-2xl font-bold mt-2 md:mt-3 tracking-wide uppercase drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
              {scene.dataOverlay.subhead}
            </h3>
          )}
        </div>

        {/* Middle: Data Card / Grid (Flex grow to take available space) */}
        <div className="flex items-center justify-center flex-grow py-6 w-full">
          <div 
            className="w-full max-w-6xl bg-slate-900/60 backdrop-blur-xl rounded-3xl border border-white/10 shadow-2xl overflow-hidden"
            style={{
              opacity: cardOpacity,
              transform: `scale(${cardScale})`,
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              maxHeight: '100%' // Prevent overflow
            }}
          >
             <div className="grid w-full divide-x divide-white/10" style={{ gridTemplateColumns: `repeat(${scene.dataOverlay.headers.length}, 1fr)` }}>
               {/* Headers */}
               {scene.dataOverlay.headers.map((header, hIdx) => (
                 <div key={`h-${hIdx}`} className="bg-black/20 p-4 md:p-6 text-center border-b border-white/10">
                    <span className="text-purple-300 font-bold uppercase tracking-widest text-xs md:text-sm lg:text-base drop-shadow-md block break-words">{header}</span>
                 </div>
               ))}
               
               {/* Rows (Values) */}
               {scene.dataOverlay.row.map((cell, cIdx) => (
                  <div key={`c-${cIdx}`} className="p-4 md:p-8 text-center flex items-center justify-center min-h-[100px] md:min-h-[200px]">
                     <span className="text-white font-bold text-2xl md:text-3xl lg:text-4xl leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] block break-words">
                       {cell}
                     </span>
                  </div>
               ))}
             </div>
          </div>
        </div>

        {/* Bottom: Captions / Subtitles (Dynamic Segments) */}
        <div className="w-full flex justify-center pb-8 shrink-0 min-h-[100px]">
          {activeChunk && (
            <div 
              className="bg-black/80 backdrop-blur-md px-8 py-5 rounded-2xl border border-white/10 max-w-4xl w-full text-center shadow-xl transform transition-all"
              style={{ 
                opacity: subtitleOpacity,
                transform: `translateY(${subtitleY}px)` 
              }}
            >
              <p className="text-2xl md:text-3xl lg:text-4xl text-yellow-300 font-bold font-sans tracking-wide leading-normal break-words"
                 style={{ textShadow: '0 2px 4px rgba(0,0,0,1)' }}
              >
                {activeChunk.text}
              </p>
            </div>
          )}
        </div>

      </AbsoluteFill>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 h-1.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-500 z-20" 
           style={{ 
             width: `${interpolate(frame, [0, scene.durationInSeconds * fps], [0, 100], { extrapolateRight: 'clamp' })}%` 
           }} 
      />
    </AbsoluteFill>
  );
};

export const MyVideoComposition: React.FC<Props> = ({ scenes, introBgUrl }) => {
  
  // Pre-calculate timeline to align Audio and Visuals
  const timeline = useMemo(() => {
    let currentFrame = 0;
    return scenes.map((scene) => {
      const durationInFrames = Math.ceil(scene.durationInSeconds * FPS);
      const startFrame = currentFrame;
      const nextFrame = currentFrame + Math.max(0, durationInFrames - TRANSITION_DURATION_IN_FRAMES);
      
      currentFrame = nextFrame;
      
      return { startFrame, durationInFrames };
    });
  }, [scenes]);

  return (
    <AbsoluteFill className="bg-black">
      
      {/* VISUAL TRACK: Layered sequences for smooth transitions */}
      <AbsoluteFill>
        {scenes.map((scene, index) => {
          const { startFrame, durationInFrames } = timeline[index];
          return (
            <Sequence
              key={`visual-${index}`}
              from={startFrame}
              durationInFrames={durationInFrames}
            >
              <SceneComponent scene={scene} index={index} introBgUrl={introBgUrl} />
            </Sequence>
          );
        })}
      </AbsoluteFill>

      {/* AUDIO TRACK: Separate sequence loop to prevent visual re-renders from affecting playback */}
      {scenes.map((scene, index) => {
         const { startFrame, durationInFrames } = timeline[index];
         if (!scene.audioUrl) return null;

         return (
           <Sequence
             key={`audio-${index}`}
             from={startFrame}
             durationInFrames={durationInFrames}
           >
             <Audio src={scene.audioUrl} />
           </Sequence>
         );
      })}
      
      <AbsoluteFill className="pointer-events-none z-50 justify-between flex-col p-6">
        <div className="flex justify-end">
           <div className="bg-black/40 px-4 py-1.5 rounded-full backdrop-blur-md text-[10px] font-bold text-white/70 border border-white/10 tracking-widest uppercase">
             AI Generated Preview
           </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
