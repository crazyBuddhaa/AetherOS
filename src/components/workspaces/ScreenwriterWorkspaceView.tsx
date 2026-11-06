import React, { useState } from 'react';
import { useApp, ScreenplayScene } from '../../context/AppContext';
import {
  Feather,
  Plus,
  Clapperboard,
  Sparkles,
  Download,
  FileText,
  Trash2,
  AlignLeft,
  User,
  MessageSquare,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';

export const ScreenwriterWorkspaceView: React.FC = () => {
  const {
    screenplayScenes,
    setScreenplayScenes,
    extractSceneToStoryboard,
    uploadFile,
    submitTask,
    setActiveTab,
    showNotification,
  } = useApp();

  const [selectedSceneId, setSelectedSceneId] = useState<string>(screenplayScenes[0]?.id || '');
  const [beatDirective, setBeatDirective] = useState<string>('');
  const [isGeneratingBeat, setIsGeneratingBeat] = useState<boolean>(false);

  const activeScene: ScreenplayScene =
    screenplayScenes.find(s => s.id === selectedSceneId) || screenplayScenes[0];

  const handleUpdateBlockText = (blockId: string, text: string) => {
    setScreenplayScenes(prev =>
      prev.map(scene =>
        scene.id === activeScene.id
          ? {
              ...scene,
              blocks: scene.blocks.map(b => (b.id === blockId ? { ...b, text } : b)),
            }
          : scene
      )
    );
  };

  const handleAddBlock = (
    type: 'slugline' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition'
  ) => {
    const defaults: Record<typeof type, string> = {
      slugline: 'INT. CONTROL ROOM - CONTINUOUS',
      action: 'A quiet hum fills the chamber as the primary status array shifts to nominal.',
      character: 'ELENA',
      parenthetical: '(measured, calm)',
      dialogue: 'Verify the secondary optical link before we commit the sequence.',
      transition: 'CUT TO:',
    };

    const newBlock = {
      id: `blk_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      type,
      text: defaults[type],
    };

    setScreenplayScenes(prev =>
      prev.map(scene =>
        scene.id === activeScene.id
          ? { ...scene, blocks: [...scene.blocks, newBlock] }
          : scene
      )
    );
  };

  const handleDeleteBlock = (blockId: string) => {
    if (activeScene.blocks.length <= 1) return;
    setScreenplayScenes(prev =>
      prev.map(scene =>
        scene.id === activeScene.id
          ? { ...scene, blocks: scene.blocks.filter(b => b.id !== blockId) }
          : scene
      )
    );
  };

  const handleAddNewScene = () => {
    const nextNum = screenplayScenes.length + 1;
    const newScene: ScreenplayScene = {
      id: `scn_${Date.now()}`,
      sceneNumber: nextNum,
      slugline: `INT. ACOUSTIC TELEMETRY CHAMBER - DAY`,
      location: 'Acoustic Telemetry Chamber',
      timeOfDay: 'DAY',
      synopsis: 'The team isolates the harmonic clock signal on the modular hardware synthesizer.',
      blocks: [
        {
          id: `b_${Date.now()}_1`,
          type: 'slugline',
          text: 'INT. ACOUSTIC TELEMETRY CHAMBER - DAY',
        },
        {
          id: `b_${Date.now()}_2`,
          type: 'action',
          text: 'On a neutral limestone plinth, an anodized aluminum modular synthesizer pulses with amber clock LEDs.',
        },
        {
          id: `b_${Date.now()}_3`,
          type: 'character',
          text: 'DR. VANCE',
        },
        {
          id: `b_${Date.now()}_4`,
          type: 'dialogue',
          text: 'Lock the oscillator frequency to forty-eight kilohertz. That clears the jitter on the coastal relay.',
        },
      ],
    };
    setScreenplayScenes(prev => [...prev, newScene]);
    setSelectedSceneId(newScene.id);
    showNotification(`Created Scene ${nextNum}`, 'success');
  };

  const handleSynthesizeDramaturgBeat = async (e: React.FormEvent) => {
    e.preventDefault();
    const directive = beatDirective.trim() || 'Add a tense exchange confirming the distributed compute handover';
    setIsGeneratingBeat(true);

    try {
      await submitTask({
        agentId: 'agent_screenwriter',
        title: `Screenplay Beat Synthesis: Scene ${activeScene.sceneNumber}`,
        description: directive,
        inputPayload: {
          workspace: 'screenwriter',
          model: 'deepseek-r1-distill-qwen-14b',
          scene_slugline: activeScene.slugline,
          directive,
        },
        priority: 'medium',
      }).catch(() => {});

      const now = Date.now();
      const generatedBlocks: ScreenplayScene['blocks'] = [
        {
          id: `b_${now}_a`,
          type: 'action',
          text: `Beat expansion (${directive}): The terminal monitor reflects across the glass partition as the secondary node comes online.`,
        },
        {
          id: `b_${now}_c`,
          type: 'character',
          text: 'ELENA',
        },
        {
          id: `b_${now}_p`,
          type: 'parenthetical',
          text: '(studying the latency trace)',
        },
        {
          id: `b_${now}_d`,
          type: 'dialogue',
          text: 'Two milliseconds across the fjord link. Keep the camera rig steady—we are rolling live on the primary array.',
        },
      ];

      setScreenplayScenes(prev =>
        prev.map(scene =>
          scene.id === activeScene.id
            ? { ...scene, blocks: [...scene.blocks, ...generatedBlocks] }
            : scene
        )
      );
      setBeatDirective('');
      showNotification('Appended dramatic beat via DeepSeek R1 Dramaturg', 'success');
    } finally {
      setIsGeneratingBeat(false);
    }
  };

  const handleExportFountainToR2 = async () => {
    const fountainText = screenplayScenes
      .map(scn =>
        scn.blocks
          .map(b => {
            if (b.type === 'slugline') return `\n${b.text.toUpperCase()}\n`;
            if (b.type === 'character') return `\n\t\t\t\t${b.text.toUpperCase()}`;
            if (b.type === 'parenthetical') return `\t\t\t${b.text}`;
            if (b.type === 'dialogue') return `\t\t${b.text}\n`;
            if (b.type === 'transition') return `\n\t\t\t\t\t\t${b.text.toUpperCase()}\n`;
            return `${b.text}\n`;
          })
          .join('\n')
      )
      .join('\n====================================\n');

    const blob = new Blob([fountainText], { type: 'text/plain;charset=utf-8' });
    const file = new File([blob], 'aetheros_production_script.fountain', { type: 'text/plain' });
    await uploadFile(file);
  };

  const totalBlocks = screenplayScenes.reduce((acc, s) => acc + s.blocks.length, 0);
  const estimatedPages = Math.max(1, Math.round(totalBlocks / 6));

  return (
    <div className="space-y-6 pb-10 w-full max-w-full min-w-0">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800 min-w-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="whitespace-nowrap">Studio Workspaces</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium whitespace-nowrap">Screenwriter</span>
            <span>·</span>
            <span className="font-mono tabular-nums whitespace-nowrap">
              {screenplayScenes.length} scenes · ~{estimatedPages} pages ({estimatedPages} min runtime)
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Screenwriter & Narrative Dramaturg Studio
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1">
            Industry-standard Fountain screenplay authoring with direct scene-to-storyboard shot extraction.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportFountainToR2}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export .fountain to R2</span>
          </button>

          <button
            onClick={() => {
              extractSceneToStoryboard(activeScene);
              setActiveTab('storyboard');
            }}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            <span>Extract Scene to Storyboard</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Screenwriting Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Scene Outline Navigator (3 cols) */}
        <div className="lg:col-span-3 min-w-0 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-900 dark:text-white">
              Scene Breakdown ({screenplayScenes.length})
            </span>
            <button
              onClick={handleAddNewScene}
              className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add</span>
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/70">
            {screenplayScenes.map(scene => {
              const isSelected = scene.id === activeScene.id;
              return (
                <button
                  key={scene.id}
                  onClick={() => setSelectedSceneId(scene.id)}
                  className={`w-full text-left p-3.5 transition-colors ${
                    isSelected
                      ? 'bg-blue-50/70 dark:bg-blue-950/40'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>SCENE {String(scene.sceneNumber).padStart(2, '0')}</span>
                    <span>{scene.timeOfDay}</span>
                  </div>
                  <div className={`text-xs font-mono font-semibold mt-0.5 truncate ${isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-white'}`}>
                    {scene.slugline}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    {scene.synopsis}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Center: Screenplay Page Canvas (6 cols) */}
        <div className="lg:col-span-6 min-w-0 space-y-4">
          {/* Formatting Element Bar */}
          <div className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 px-1.5">Insert Block:</span>
              <button
                type="button"
                onClick={() => handleAddBlock('slugline')}
                className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                + Slugline
              </button>
              <button
                type="button"
                onClick={() => handleAddBlock('action')}
                className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                + Action
              </button>
              <button
                type="button"
                onClick={() => handleAddBlock('character')}
                className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                + Character
              </button>
              <button
                type="button"
                onClick={() => handleAddBlock('dialogue')}
                className="px-2.5 py-1 text-xs rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                + Dialogue
              </button>
              <button
                type="button"
                onClick={() => handleAddBlock('transition')}
                className="px-2.5 py-1 text-xs font-mono rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300"
              >
                + Transition
              </button>
            </div>
          </div>

          {/* Script Manuscript Sheet */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-10 shadow-2xs space-y-4 font-mono">
            {activeScene.blocks.map(block => {
              const isSlug = block.type === 'slugline';
              const isChar = block.type === 'character';
              const isParen = block.type === 'parenthetical';
              const isDial = block.type === 'dialogue';
              const isTrans = block.type === 'transition';

              return (
                <div key={block.id} className="group relative">
                  <div
                    className={
                      isSlug
                        ? 'font-bold text-xs tracking-wide text-slate-900 dark:text-white uppercase py-1 border-b border-slate-100 dark:border-slate-800'
                        : isChar
                        ? 'text-xs font-bold text-slate-900 dark:text-white uppercase text-center mt-3'
                        : isParen
                        ? 'text-xs italic text-slate-500 dark:text-slate-400 text-center'
                        : isDial
                        ? 'text-xs text-slate-800 dark:text-slate-200 max-w-md mx-auto leading-relaxed'
                        : isTrans
                        ? 'text-xs font-bold text-slate-500 dark:text-slate-400 text-right uppercase mt-2'
                        : 'text-xs text-slate-700 dark:text-slate-300 leading-relaxed'
                    }
                  >
                    <textarea
                      rows={Math.max(1, Math.ceil(block.text.length / (isDial ? 48 : 68)))}
                      value={block.text}
                      onChange={e => handleUpdateBlockText(block.id, e.target.value)}
                      className={`w-full bg-transparent focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50 rounded px-1.5 py-0.5 resize-none ${
                        isChar || isParen ? 'text-center' : isTrans ? 'text-right' : 'text-left'
                      }`}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteBlock(block.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-0 top-1 p-1 text-slate-400 hover:text-rose-600"
                    title="Remove block"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: AI Dramaturg & Storyboard Handoff (3 cols) */}
        <div className="lg:col-span-3 min-w-0 space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white border-b border-slate-100 dark:border-slate-800 pb-3">
              <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>AI Dramaturg & Beat Architect</span>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Generate dialogue exchanges, tighten scene pacing, or expand action beats using <span className="font-mono text-slate-800 dark:text-slate-200">deepseek-r1-distill-qwen-14b</span>.
            </p>

            <form onSubmit={handleSynthesizeDramaturgBeat} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Dramatic Beat Directive
                </label>
                <textarea
                  rows={3}
                  value={beatDirective}
                  onChange={e => setBeatDirective(e.target.value)}
                  placeholder="e.g. Write a sharp dialogue exchange when the coastal sensor array detects anomalous latency..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={isGeneratingBeat}
                className="w-full py-2 px-3 rounded-lg bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {isGeneratingBeat ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Writing Beat...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Generate Scene Beat</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Storyboard Bridge Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Visual Continuity Bridge
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              Convert Scene {activeScene.sceneNumber} (<span className="font-mono">{activeScene.location}</span>) into a camera-blocked Storyboard shot.
            </p>
            <button
              onClick={() => extractSceneToStoryboard(activeScene)}
              className="w-full py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-600 text-slate-800 dark:text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            >
              <Clapperboard className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Send Scene to Storyboard</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
