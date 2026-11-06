import React, { useState, useEffect } from 'react';
import { useApp, StoryboardShot } from '../../context/AppContext';
import {
  Clapperboard,
  Plus,
  Play,
  Pause,
  ArrowUp,
  ArrowDown,
  Trash2,
  Film,
  Image as ImageIcon,
  Download,
  Camera,
  Clock,
  Sparkles,
} from 'lucide-react';

const AVAILABLE_PLATES = [
  { label: 'Nordic Fjord Studio', url: '/src/assets/images/studio_arch_render_1793995336638.jpg' },
  { label: 'Photonics Lab Golden Hour', url: '/src/assets/images/storyboard_scene_lab_1793995338170.jpg' },
  { label: 'Modular Synthesizer Macro', url: '/src/assets/images/studio_product_design_1793995336944.jpg' },
  { label: 'Coastal Cliff Campus Sunrise', url: '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg' },
];

export const StoryboardWorkspaceView: React.FC = () => {
  const {
    storyboardShots,
    addStoryboardShot,
    updateStoryboardShot,
    deleteStoryboardShot,
    reorderStoryboardShot,
    addStudioVideo,
    uploadFile,
    setActiveTab,
    showNotification,
  } = useApp();

  const [selectedShotId, setSelectedShotId] = useState<string>(storyboardShots[0]?.id || '');
  const [isAnimaticPlaying, setIsAnimaticPlaying] = useState<boolean>(false);
  const [animaticIndex, setAnimaticIndex] = useState<number>(0);

  const totalDuration = storyboardShots.reduce((acc, s) => acc + s.durationSec, 0);
  const activeShot: StoryboardShot | undefined =
    storyboardShots.find(s => s.id === selectedShotId) || storyboardShots[0];

  // Sequential Animatic Player
  useEffect(() => {
    if (!isAnimaticPlaying || storyboardShots.length === 0) return;
    const current = storyboardShots[animaticIndex] || storyboardShots[0];
    const timer = setTimeout(() => {
      setAnimaticIndex(prev => {
        const next = prev + 1;
        if (next >= storyboardShots.length) {
          setIsAnimaticPlaying(false);
          return 0;
        }
        setSelectedShotId(storyboardShots[next].id);
        return next;
      });
    }, Math.max(1500, current.durationSec * 650));

    return () => clearTimeout(timer);
  }, [isAnimaticPlaying, animaticIndex, storyboardShots]);

  const handleAddShot = () => {
    const nextIdx = storyboardShots.length;
    const plate = AVAILABLE_PLATES[nextIdx % AVAILABLE_PLATES.length];
    const created = addStoryboardShot({
      title: `Sequence Shot ${String(nextIdx + 1).padStart(2, '0')}`,
      sceneHeading: 'INT. RESEARCH PAVILION - DAY',
      visualPrompt: 'Wide architectural frame with balanced natural window illumination and clean depth of field.',
      cameraAngle: 'Eye-Level Medium',
      lens: '35mm Anamorphic',
      cameraMovement: 'Slow Dolly In',
      dialogue: 'OPERATOR: Confirm telemetry synchronization across all edge nodes.',
      durationSec: 4.0,
      aspectRatio: '16:9',
      imageUrl: plate.url,
      status: 'ready',
    });
    setSelectedShotId(created.id);
    showNotification(`Added Shot #${created.shotNumber} to storyboard`, 'success');
  };

  const handleExportStoryboardToR2 = async () => {
    const payload = JSON.stringify(
      {
        project: 'AetherOS Production Storyboard',
        total_shots: storyboardShots.length,
        total_duration_seconds: totalDuration,
        exported_at: new Date().toISOString(),
        shots: storyboardShots,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: 'application/json' });
    const file = new File([blob], `storyboard_sequence_${Date.now().toString().slice(-4)}.json`, {
      type: 'application/json',
    });
    await uploadFile(file);
  };

  const handleCycleShotPlate = (shot: StoryboardShot) => {
    const currentIdx = AVAILABLE_PLATES.findIndex(p => p.url === shot.imageUrl);
    const nextPlate = AVAILABLE_PLATES[(currentIdx + 1) % AVAILABLE_PLATES.length];
    updateStoryboardShot({
      ...shot,
      imageUrl: nextPlate.url,
    });
    showNotification(`Updated Shot #${shot.shotNumber} visual plate`, 'info');
  };

  const handleSendShotToVideo = (shot: StoryboardShot) => {
    addStudioVideo({
      title: `Shot ${String(shot.shotNumber).padStart(2, '0')}: ${shot.title}`,
      prompt: shot.visualPrompt,
      model: 'animatediff-motion-v3',
      frames: 24,
      fps: 12,
      cameraMotion: shot.cameraMovement,
      motionStrength: 0.65,
      keyframeImageUrl: shot.imageUrl,
      aspectRatio: '16:9',
      status: 'ready',
      progressPercent: 100,
    });
    showNotification(`Sent Shot #${shot.shotNumber} to Video Generation Studio`, 'success');
    setActiveTab('video');
  };

  return (
    <div className="space-y-6 pb-10 w-full max-w-full min-w-0">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="whitespace-nowrap">Studio Workspaces</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium whitespace-nowrap">Storyboard Studio</span>
            <span>·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {storyboardShots.length} shots · {totalDuration.toFixed(1)}s total runtime
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Storyboard & Sequential Shot Continuity
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Plan camera blocking, focal lengths, dialogue timing, and animatic sequences across scenes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (!isAnimaticPlaying) {
                setAnimaticIndex(0);
                if (storyboardShots[0]) setSelectedShotId(storyboardShots[0].id);
              }
              setIsAnimaticPlaying(!isAnimaticPlaying);
            }}
            className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              isAnimaticPlaying
                ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
            }`}
          >
            {isAnimaticPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isAnimaticPlaying ? 'Stop Animatic' : 'Play Animatic'}</span>
          </button>

          <button
            onClick={handleExportStoryboardToR2}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export to R2</span>
          </button>

          <button
            onClick={handleAddShot}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Shot</span>
          </button>
        </div>
      </div>

      {/* Animatic Monitor & Active Shot Inspector */}
      {activeShot && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Active Shot Monitor (7 cols) */}
          <div className="lg:col-span-7 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="relative aspect-video bg-slate-950 overflow-hidden">
              <img
                src={activeShot.imageUrl}
                alt={activeShot.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              {/* Measured Scrim with Dialogue & Camera Metadata */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-4 sm:p-5 text-white space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-white/80 tabular-nums">
                  <span>
                    Shot {String(activeShot.shotNumber).padStart(2, '0')} · {activeShot.sceneHeading}
                  </span>
                  <span>
                    {activeShot.lens} · {activeShot.cameraMovement} · {activeShot.durationSec.toFixed(1)}s
                  </span>
                </div>
                <p className="text-xs sm:text-sm font-medium text-white">
                  {activeShot.dialogue}
                </p>
              </div>
            </div>

            <div className="p-4 bg-slate-50/70 dark:bg-slate-950/50 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400 font-mono">
                <span>Framing: {activeShot.cameraAngle}</span>
                <span>·</span>
                <span>Aspect: {activeShot.aspectRatio}</span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleCycleShotPlate(activeShot)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Cycle Plate</span>
                </button>
                <button
                  onClick={() => handleSendShotToVideo(activeShot)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold transition-colors"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Animate Shot in Video Studio</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right: Active Shot Continuity Editor (5 cols) */}
          <div className="lg:col-span-5 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                <Camera className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Shot #{String(activeShot.shotNumber).padStart(2, '0')} Continuity Inspector</span>
              </div>
              <button
                onClick={() => deleteStoryboardShot(activeShot.id)}
                disabled={storyboardShots.length <= 1}
                className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30 transition-colors"
                title="Delete shot"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Shot Title
              </label>
              <input
                type="text"
                value={activeShot.title}
                onChange={e => updateStoryboardShot({ ...activeShot, title: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Scene Slugline
              </label>
              <input
                type="text"
                value={activeShot.sceneHeading}
                onChange={e => updateStoryboardShot({ ...activeShot, sceneHeading: e.target.value })}
                className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Optical Lens
                </label>
                <select
                  value={activeShot.lens}
                  onChange={e => updateStoryboardShot({ ...activeShot, lens: e.target.value })}
                  className="w-full px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                >
                  <option value="18mm Wide">18mm Wide</option>
                  <option value="24mm Anamorphic">24mm Anamorphic</option>
                  <option value="35mm Anamorphic">35mm Anamorphic</option>
                  <option value="35mm Prime">35mm Prime</option>
                  <option value="50mm Prime">50mm Prime</option>
                  <option value="85mm Macro">85mm Macro</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Duration (Seconds)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="1.0"
                  max="15.0"
                  value={activeShot.durationSec}
                  onChange={e =>
                    updateStoryboardShot({ ...activeShot, durationSec: Number(e.target.value) || 3.0 })
                  }
                  className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Visual Composition & Lighting Notes
              </label>
              <textarea
                rows={2}
                value={activeShot.visualPrompt}
                onChange={e => updateStoryboardShot({ ...activeShot, visualPrompt: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Dialogue / Audio Cue
              </label>
              <input
                type="text"
                value={activeShot.dialogue}
                onChange={e => updateStoryboardShot({ ...activeShot, dialogue: e.target.value })}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* Sequential Shot Strip */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Sequential Storyboard Strip
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Select any shot to inspect or reorder continuity
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {storyboardShots.map((shot, idx) => {
            const isSelected = activeShot?.id === shot.id;
            return (
              <div
                key={shot.id}
                onClick={() => setSelectedShotId(shot.id)}
                className={`cursor-pointer rounded-xl border bg-white dark:bg-slate-900 overflow-hidden transition-all flex flex-col ${
                  isSelected
                    ? 'border-blue-600 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="aspect-video bg-slate-950 relative overflow-hidden">
                  <img
                    src={shot.imageUrl}
                    alt={shot.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/75 text-white font-mono text-[11px] font-semibold tabular-nums">
                    Shot {String(shot.shotNumber).padStart(2, '0')}
                  </div>
                  <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/75 text-white font-mono text-[10px] tabular-nums">
                    {shot.durationSec.toFixed(1)}s
                  </div>
                </div>

                <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                  <div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                      {shot.title}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                      {shot.lens} · {shot.cameraMovement}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">
                      {shot.dialogue}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
                    <span className="font-mono truncate">{shot.cameraAngle}</span>
                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => reorderStoryboardShot(shot.id, 'up')}
                        className="p-1 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                        title="Move shot earlier"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === storyboardShots.length - 1}
                        onClick={() => reorderStoryboardShot(shot.id, 'down')}
                        className="p-1 hover:text-slate-900 dark:hover:text-white disabled:opacity-30"
                        title="Move shot later"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
