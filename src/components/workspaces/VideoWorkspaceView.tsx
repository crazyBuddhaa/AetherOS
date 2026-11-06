import React, { useState, useEffect } from 'react';
import { useApp, StudioVideoClip } from '../../context/AppContext';
import {
  Film,
  Play,
  Pause,
  RotateCcw,
  Sliders,
  Sparkles,
  Camera,
  Clapperboard,
  RefreshCw,
  Grid,
  Layers,
} from 'lucide-react';

const CAMERA_MOTIONS = [
  'Orbit & Crane Up',
  'Lateral Dolly Right',
  'Slow Dolly In',
  'Static Focus Pull',
  'Pan Left to Right',
  'Crane Ascend Wide',
];

export const VideoWorkspaceView: React.FC = () => {
  const {
    studioVideos,
    addStudioVideo,
    studioImages,
    addStoryboardShot,
    submitTask,
    showNotification,
  } = useApp();

  const [selectedVideoId, setSelectedVideoId] = useState<string>(studioVideos[0]?.id || '');
  const [motionPrompt, setMotionPrompt] = useState<string>(
    'Smooth aerial camera orbit over coastal architectural research campus at sunrise, low marine mist drifting across cliffs'
  );
  const [cameraMotion, setCameraMotion] = useState<string>('Orbit & Crane Up');
  const [frames, setFrames] = useState<number>(24);
  const [fps, setFps] = useState<number>(12);
  const [motionStrength, setMotionStrength] = useState<number>(0.68);
  const [selectedKeyframeUrl, setSelectedKeyframeUrl] = useState<string>(
    studioImages[0]?.imageUrl || '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg'
  );
  const [isRendering, setIsRendering] = useState<boolean>(false);

  // Interactive Motion Viewport Player state
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [currentFrame, setCurrentFrame] = useState<number>(1);
  const [showRuleOfThirds, setShowRuleOfThirds] = useState<boolean>(false);

  const activeClip: StudioVideoClip =
    studioVideos.find(v => v.id === selectedVideoId) || studioVideos[0];

  useEffect(() => {
    if (!isPlaying || !activeClip) return;
    const intervalMs = Math.max(45, Math.round(1000 / (activeClip.fps || 12)));
    const timer = setInterval(() => {
      setCurrentFrame(prev => (prev >= activeClip.frames ? 1 : prev + 1));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [isPlaying, activeClip]);

  const handleSynthesizeVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!motionPrompt.trim()) return;

    setIsRendering(true);
    try {
      await submitTask({
        agentId: 'agent_motion_studio',
        title: `Video Motion Synthesis (${frames}f @ ${fps}fps): ${motionPrompt.slice(0, 36)}`,
        description: `AnimateDiff v3 temporal synthesis with ${cameraMotion} trajectory`,
        inputPayload: {
          workspace: 'video_generation',
          model: 'animatediff-motion-v3',
          prompt: motionPrompt,
          camera_motion: cameraMotion,
          frames,
          fps,
          motion_strength: motionStrength,
          keyframe_url: selectedKeyframeUrl,
          require_gpu: true,
        },
        priority: 'high',
      }).catch(() => {});

      const created = addStudioVideo({
        title: motionPrompt.split(',')[0].slice(0, 44) || 'Temporal Sequence',
        prompt: motionPrompt.trim(),
        model: 'animatediff-motion-v3',
        frames,
        fps,
        cameraMotion,
        motionStrength,
        keyframeImageUrl: selectedKeyframeUrl,
        aspectRatio: '16:9',
        status: 'ready',
        progressPercent: 100,
      });

      setSelectedVideoId(created.id);
      setCurrentFrame(1);
      setIsPlaying(true);
      showNotification(`Rendered ${frames}-frame motion sequence via AnimateDiff v3`, 'success');
    } finally {
      setIsRendering(false);
    }
  };

  // Compute subtle compositor-only transform based on currentFrame and cameraMotion
  const progressRatio = activeClip ? (currentFrame - 1) / Math.max(1, activeClip.frames - 1) : 0;
  const getMotionTransform = () => {
    if (!activeClip) return 'scale(1)';
    const motion = activeClip.cameraMotion;
    const amp = activeClip.motionStrength || 0.6;
    if (motion.includes('Dolly In')) {
      const s = 1 + progressRatio * 0.14 * amp;
      return `scale(${s.toFixed(3)})`;
    }
    if (motion.includes('Lateral') || motion.includes('Pan')) {
      const tx = (progressRatio - 0.5) * 28 * amp;
      return `scale(1.08) translateX(${tx.toFixed(1)}px)`;
    }
    if (motion.includes('Orbit') || motion.includes('Crane')) {
      const s = 1.04 + progressRatio * 0.08 * amp;
      const ty = (0.5 - progressRatio) * 18 * amp;
      return `scale(${s.toFixed(3)}) translateY(${ty.toFixed(1)}px)`;
    }
    return `scale(${(1 + progressRatio * 0.05).toFixed(3)})`;
  };

  const formatTimecode = (frame: number, clipFps: number) => {
    const secs = Math.floor((frame - 1) / clipFps);
    const remFrames = (frame - 1) % clipFps;
    return `00:00:${String(secs).padStart(2, '0')}:${String(remFrames).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Studio Workspaces</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium">Video Generation</span>
            <span>·</span>
            <span className="font-mono tabular-nums">{studioVideos.length} motion clips</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Video Generation & Temporal Motion Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Keyframe-conditioned temporal synthesis, camera rig trajectories, and frame-accurate animatic playback.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-400 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <Film className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
          <span>Engine: AnimateDiff Motion v3 · 12 GB VRAM</span>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Motion & Camera Trajectory Controls (5 cols) */}
        <form
          onSubmit={handleSynthesizeVideo}
          className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Temporal & Camera Rig Configuration</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500 tabular-nums">
              {(frames / fps).toFixed(1)}s duration
            </span>
          </div>

          {/* Motion Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Temporal Motion Directive
            </label>
            <textarea
              rows={3}
              value={motionPrompt}
              onChange={e => setMotionPrompt(e.target.value)}
              placeholder="Describe subject movement, atmospheric motion, and camera trajectory..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
            />
          </div>

          {/* Camera Trajectory */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Camera Rig Trajectory
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CAMERA_MOTIONS.map(motion => (
                <button
                  key={motion}
                  type="button"
                  onClick={() => setCameraMotion(motion)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors truncate ${
                    cameraMotion === motion
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {motion}
                </button>
              ))}
            </div>
          </div>

          {/* Keyframe Conditioning Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Starting Keyframe Plate
            </label>
            <div className="grid grid-cols-4 gap-2">
              {studioImages.slice(0, 4).map(img => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => setSelectedKeyframeUrl(img.imageUrl)}
                  className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                    selectedKeyframeUrl === img.imageUrl
                      ? 'border-blue-600 ring-2 ring-blue-500/20'
                      : 'border-transparent opacity-75 hover:opacity-100'
                  }`}
                >
                  <img
                    src={img.imageUrl}
                    alt={img.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Frame Count & FPS */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Frame Count
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[16, 24, 32].map(f => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFrames(f)}
                    className={`py-1.5 text-xs font-mono rounded-lg border transition-colors tabular-nums ${
                      frames === f
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {f}f
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Frame Rate
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[8, 12, 24].map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setFps(r)}
                    className={`py-1.5 text-xs font-mono rounded-lg border transition-colors tabular-nums ${
                      fps === r
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {r}fps
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Motion Conditioning Strength */}
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-600 dark:text-slate-400">Motion Conditioning Scale</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">
                {motionStrength.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.2}
              max={1.0}
              step={0.04}
              value={motionStrength}
              onChange={e => setMotionStrength(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          <button
            type="submit"
            disabled={isRendering || !motionPrompt.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
          >
            {isRendering ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Rendering Temporal Sequence...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Render Motion Clip</span>
              </>
            )}
          </button>
        </form>

        {/* Right: Temporal Player & Sequence Library (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {activeClip && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              {/* Motion Preview Viewport */}
              <div className="relative aspect-video bg-slate-950 overflow-hidden">
                <img
                  src={activeClip.keyframeImageUrl}
                  alt={activeClip.title}
                  referrerPolicy="no-referrer"
                  style={{
                    transform: getMotionTransform(),
                    transition: 'transform 120ms linear',
                  }}
                  className="w-full h-full object-cover"
                />

                {/* Rule of Thirds Optical Grid */}
                {showRuleOfThirds && (
                  <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3">
                    <div className="border-r border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-r border-b border-white/25" />
                    <div className="border-b border-white/25" />
                    <div className="border-r border-white/25" />
                    <div className="border-r border-white/25" />
                    <div />
                  </div>
                )}

                {/* Measured Contrast Scrim Bottom */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-4 flex items-center justify-between text-xs text-white font-mono">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setIsPlaying(!isPlaying)}
                      className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentFrame(1)}
                      className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 text-white transition-colors"
                      aria-label="Restart clip"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <span className="tabular-nums">
                      {formatTimecode(currentFrame, activeClip.fps)}
                    </span>
                    <span className="text-white/60">·</span>
                    <span className="tabular-nums">
                      Frame {currentFrame} / {activeClip.frames}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-white/80 hidden sm:inline">
                      {activeClip.cameraMotion}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowRuleOfThirds(!showRuleOfThirds)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        showRuleOfThirds ? 'bg-blue-600 text-white' : 'bg-white/15 text-white/80 hover:bg-white/25'
                      }`}
                      title="Toggle optical framing guides"
                    >
                      <Grid className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Interactive Timeline Scrubber */}
              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">01</span>
                  <input
                    type="range"
                    min={1}
                    max={activeClip.frames}
                    value={currentFrame}
                    onChange={e => {
                      setIsPlaying(false);
                      setCurrentFrame(Number(e.target.value));
                    }}
                    className="flex-1 accent-blue-600"
                  />
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">{activeClip.frames}</span>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {activeClip.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                      <span>{activeClip.model}</span>
                      <span>·</span>
                      <span>{activeClip.frames} frames @ {activeClip.fps} fps</span>
                      <span>·</span>
                      <span>{activeClip.cameraMotion}</span>
                      <span>·</span>
                      <span>Motion {activeClip.motionStrength.toFixed(2)}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      const shot = addStoryboardShot({
                        title: activeClip.title,
                        sceneHeading: 'EXT. MOTION SEQUENCE - DAY',
                        visualPrompt: activeClip.prompt,
                        cameraAngle: 'Dynamic Tracking',
                        lens: '35mm Anamorphic',
                        cameraMovement: activeClip.cameraMotion,
                        dialogue: 'Animated motion plate attached.',
                        durationSec: Number((activeClip.frames / activeClip.fps).toFixed(1)),
                        aspectRatio: activeClip.aspectRatio,
                        imageUrl: activeClip.keyframeImageUrl,
                        status: 'ready',
                      });
                      showNotification(`Added clip to Storyboard Shot #${shot.shotNumber}`, 'success');
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
                  >
                    <Clapperboard className="w-3.5 h-3.5" />
                    <span>Append to Storyboard</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rendered Video Sequences List */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Rendered Motion Sequences ({studioVideos.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {studioVideos.map(clip => {
                const isSelected = activeClip?.id === clip.id;
                return (
                  <div
                    key={clip.id}
                    onClick={() => {
                      setSelectedVideoId(clip.id);
                      setCurrentFrame(1);
                    }}
                    className={`cursor-pointer rounded-xl border overflow-hidden bg-white dark:bg-slate-900 transition-all ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="aspect-video bg-slate-950 relative overflow-hidden">
                      <img
                        src={clip.keyframeImageUrl}
                        alt={clip.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-white font-mono text-[10px] tabular-nums">
                        {clip.frames}f · {clip.fps}fps
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {clip.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {clip.cameraMotion}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
