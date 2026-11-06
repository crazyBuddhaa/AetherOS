import React, { useState } from 'react';
import { useApp, StudioImageAsset } from '../../context/AppContext';
import {
  Image as ImageIcon,
  Sparkles,
  Download,
  Sliders,
  Layers,
  Film,
  Clapperboard,
  RefreshCw,
  Check,
  Trash2,
  Maximize2,
  Cpu,
} from 'lucide-react';

const STYLE_PRESETS = [
  {
    id: 'arch_daylight',
    label: 'Architectural Daylight',
    promptSuffix: 'minimalist concrete and warm oak interior, natural morning daylight, Leica 35mm editorial photography, 8k',
    fallbackImg: '/src/assets/images/studio_arch_render_1793995336638.jpg',
  },
  {
    id: 'industrial_macro',
    label: 'Industrial Hardware Macro',
    promptSuffix: 'precision anodized aluminum industrial design prototype on neutral limestone, soft studio side lighting, shallow depth of field',
    fallbackImg: '/src/assets/images/studio_product_design_1793995336944.jpg',
  },
  {
    id: 'cinematic_lab',
    label: 'Anamorphic Cinema Still',
    promptSuffix: 'cinematic wide-angle film still, golden hour tungsten and natural window illumination, anamorphic lens bokeh',
    fallbackImg: '/src/assets/images/storyboard_scene_lab_1793995338170.jpg',
  },
  {
    id: 'aerial_landscape',
    label: 'Aerial Documentary',
    promptSuffix: 'aerial wide establishing photography at sunrise, coastal mist, clean architectural lines, high dynamic range',
    fallbackImg: '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg',
  },
];

export const ImageWorkspaceView: React.FC = () => {
  const {
    studioImages,
    addStudioImage,
    deleteStudioImage,
    addStoryboardShot,
    submitTask,
    setActiveTab,
    showNotification,
  } = useApp();

  const [selectedImageId, setSelectedImageId] = useState<string>(studioImages[0]?.id || '');
  const [prompt, setPrompt] = useState<string>(
    'Minimalist Nordic research pavilion with floor-to-ceiling glass overlooking a calm morning fjord, soft diffused daylight'
  );
  const [negativePrompt, setNegativePrompt] = useState<string>(
    'blurry, low resolution, oversaturated, neon glow, watermark, deformed geometry'
  );
  const [model, setModel] = useState<string>('sdxl-lightning');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '4:3' | '1:1' | '9:16'>('16:9');
  const [steps, setSteps] = useState<number>(4);
  const [cfgScale, setCfgScale] = useState<number>(1.8);
  const [upscale4x, setUpscale4x] = useState<boolean>(true);
  const [bgRemove, setBgRemove] = useState<boolean>(false);
  const [selectedPreset, setSelectedPreset] = useState<string>('arch_daylight');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  const activeImage: StudioImageAsset | undefined =
    studioImages.find(i => i.id === selectedImageId) || studioImages[0];

  const handleSynthesizeImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsGenerating(true);
    const presetObj = STYLE_PRESETS.find(p => p.id === selectedPreset) || STYLE_PRESETS[0];
    const resolutionMap: Record<'16:9' | '4:3' | '1:1' | '9:16', string> = {
      '16:9': upscale4x ? '1536 × 864' : '1024 × 576',
      '4:3': upscale4x ? '1280 × 960' : '1024 × 768',
      '1:1': upscale4x ? '2048 × 2048' : '1024 × 1024',
      '9:16': upscale4x ? '864 × 1536' : '576 × 1024',
    };

    try {
      await submitTask({
        agentId: 'agent_visual_synth',
        title: `Image Synthesis: ${prompt.slice(0, 42)}`,
        description: `Generate ${aspectRatio} frame with ${model}${upscale4x ? ' + Real-ESRGAN 4x' : ''}${bgRemove ? ' + BiRefNet' : ''}`,
        inputPayload: {
          workspace: 'image_generation',
          model,
          prompt,
          negative_prompt: negativePrompt,
          aspect_ratio: aspectRatio,
          steps,
          cfg_scale: cfgScale,
          upscale_4x: upscale4x,
          bg_remove: bgRemove,
          require_gpu: true,
        },
        priority: 'medium',
      }).catch(() => {});

      const created = addStudioImage({
        title: prompt.split(',')[0].slice(0, 48) || 'Studio Render',
        prompt: `${prompt.trim()}, ${presetObj.promptSuffix}`,
        negativePrompt,
        model,
        aspectRatio,
        resolution: resolutionMap[aspectRatio],
        steps,
        cfgScale,
        seed: Math.floor(10000000 + Math.random() * 90000000),
        upscaled4x: upscale4x,
        bgRemoved: bgRemove,
        imageUrl: presetObj.fallbackImg,
      });

      setSelectedImageId(created.id);
      showNotification(`Frame synthesized via ${model}`, 'success');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendToStoryboard = (img: StudioImageAsset) => {
    const shot = addStoryboardShot({
      title: img.title,
      sceneHeading: 'INT. STUDIO SEQUENCE - DAY',
      visualPrompt: img.prompt,
      cameraAngle: 'Eye-Level Wide',
      lens: '35mm Anamorphic',
      cameraMovement: 'Slow Dolly In',
      dialogue: 'Visual reference plate imported from Image Studio.',
      durationSec: 4.0,
      aspectRatio: img.aspectRatio,
      imageUrl: img.imageUrl,
      status: 'ready',
    });
    showNotification(`Added "${img.title}" as Storyboard Shot #${shot.shotNumber}`, 'success');
  };

  return (
    <div className="space-y-6 pb-10">
      {/* Workspace Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span>Studio Workspaces</span>
            <span>/</span>
            <span className="text-slate-900 dark:text-slate-200 font-medium">Image Generation</span>
            <span>·</span>
            <span className="font-mono tabular-nums">{studioImages.length} rendered plates</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Image Generation & Optical Processing Studio
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            High-resolution diffusion synthesis with Real-ESRGAN 4x spatial upscaling and BiRefNet background extraction.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setActiveTab('storyboard')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Clapperboard className="w-3.5 h-3.5 text-slate-500" />
            <span>Open Storyboard</span>
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Film className="w-3.5 h-3.5 text-slate-500" />
            <span>Animate in Video Studio</span>
          </button>
        </div>
      </div>

      {/* Main Split Studio */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Prompt & Pipeline Parameters (5 cols) */}
        <form
          onSubmit={handleSynthesizeImage}
          className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
              <Sliders className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Synthesis Parameters</span>
            </div>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              VRAM Target: {model === 'sdxl-lightning' ? '10 GB' : '6 GB'}
            </span>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Diffusion Checkpoint
            </label>
            <select
              value={model}
              onChange={e => {
                setModel(e.target.value);
                setSteps(e.target.value === 'sdxl-lightning' ? 4 : 20);
                setCfgScale(e.target.value === 'sdxl-lightning' ? 1.8 : 7.0);
              }}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="sdxl-lightning">SDXL Lightning 4-Step (ByteDance/SDXL-Lightning)</option>
              <option value="sd-1.5-standard">Stable Diffusion 1.5 (runwayml/stable-diffusion-v1-5)</option>
            </select>
          </div>

          {/* Positive Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Visual Prompt
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe subject, architectural materials, camera lens, and lighting..."
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              required
            />
          </div>

          {/* Optical Style Preset */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Optical Profile
            </label>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setSelectedPreset(preset.id)}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors truncate ${
                    selectedPreset === preset.id
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Aspect Ratio */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Aspect Ratio
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['16:9', '4:3', '1:1', '9:16'] as const).map(ratio => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                    aspectRatio === ratio
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 font-semibold'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          {/* Steps & CFG */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400">Inference Steps</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">{steps}</span>
              </div>
              <input
                type="range"
                min={4}
                max={40}
                step={2}
                value={steps}
                onChange={e => setSteps(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-600 dark:text-slate-400">Guidance (CFG)</span>
                <span className="font-mono font-semibold text-slate-900 dark:text-white tabular-nums">{cfgScale.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={1.0}
                max={12.0}
                step={0.2}
                value={cfgScale}
                onChange={e => setCfgScale(Number(e.target.value))}
                className="w-full accent-blue-600"
              />
            </div>
          </div>

          {/* Post-Processing Modules */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Post-Processing Pipeline Nodes
            </span>
            <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 cursor-pointer text-xs">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">Real-ESRGAN 4x+ Spatial Upscaler</div>
                <div className="text-[11px] text-slate-500">xinntao/Real-ESRGAN · +4 GB VRAM pass</div>
              </div>
              <input
                type="checkbox"
                checked={upscale4x}
                onChange={e => setUpscale4x(e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>

            <label className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/50 cursor-pointer text-xs">
              <div>
                <div className="font-medium text-slate-900 dark:text-white">BiRefNet Alpha Matting Extraction</div>
                <div className="text-[11px] text-slate-500">ZhengPeng7/BiRefNet · Isolate foreground subject</div>
              </div>
              <input
                type="checkbox"
                checked={bgRemove}
                onChange={e => setBgRemove(e.target.checked)}
                className="w-4 h-4 accent-blue-600 rounded"
              />
            </label>
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Negative Conditioning
            </label>
            <input
              type="text"
              value={negativePrompt}
              onChange={e => setNegativePrompt(e.target.value)}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300"
            />
          </div>

          <button
            type="submit"
            disabled={isGenerating || !prompt.trim()}
            className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
          >
            {isGenerating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Synthesizing Plate...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Synthesize Image Plate</span>
              </>
            )}
          </button>
        </form>

        {/* Right: Active Plate Inspector & Gallery (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {activeImage && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
              {/* Viewport Image */}
              <div className="relative bg-slate-950 aspect-video flex items-center justify-center overflow-hidden">
                <img
                  src={activeImage.imageUrl}
                  alt={activeImage.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Unboxed Metadata & Action Bar */}
              <div className="p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 dark:text-white">
                      {activeImage.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                      <span>{activeImage.resolution}</span>
                      <span>·</span>
                      <span>{activeImage.model}</span>
                      <span>·</span>
                      <span>{activeImage.steps} steps</span>
                      <span>·</span>
                      <span>CFG {activeImage.cfgScale}</span>
                      <span>·</span>
                      <span>Seed {activeImage.seed}</span>
                      {activeImage.upscaled4x && (
                        <>
                          <span>·</span>
                          <span className="text-blue-600 dark:text-blue-400">4x Upscaled</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleSendToStoryboard(activeImage)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap"
                    >
                      <Clapperboard className="w-3.5 h-3.5" />
                      <span>Add to Storyboard</span>
                    </button>
                    <a
                      href={activeImage.imageUrl}
                      download={`${activeImage.title.toLowerCase().replace(/\s+/g, '_')}.jpg`}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export</span>
                    </a>
                  </div>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {activeImage.prompt}
                </p>
              </div>
            </div>
          )}

          {/* Studio Plates Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Rendered Studio Plates ({studioImages.length})
              </h3>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Click any plate to inspect or send to Storyboard
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {studioImages.map(img => {
                const isSelected = activeImage?.id === img.id;
                return (
                  <div
                    key={img.id}
                    onClick={() => setSelectedImageId(img.id)}
                    className={`group cursor-pointer rounded-xl border overflow-hidden bg-white dark:bg-slate-900 transition-all ${
                      isSelected
                        ? 'border-blue-600 ring-2 ring-blue-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="aspect-video bg-slate-900 overflow-hidden relative">
                      <img
                        src={img.imageUrl}
                        alt={img.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      />
                    </div>
                    <div className="p-2.5">
                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                        {img.title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        {img.aspectRatio} · {img.steps}s
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
