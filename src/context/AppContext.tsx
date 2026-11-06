import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { 
  Agent, 
  Task, 
  ApprovalRequest, 
  Conversation, 
  AttachedFile, 
  ActivityLog, 
  RuntimeConfig, 
  SystemStats,
  ComputeWorker,
  ModelDefinition,
  UserAccount,
  Organization,
  PasskeyItem,
  ComputeSession,
  WorkerOwnershipInfo,
  KaggleCredentialsStatus
} from '../types';
import { dbStorage } from '../services/db-storage';
import { runtimeEngine } from '../services/runtime-engine';
import { apiClient } from '../services/api-client';

export type NavTab =
  | 'dashboard'
  | 'code'
  | 'image'
  | 'video'
  | 'storyboard'
  | 'screenwriter'
  | 'web_intelligence'
  | 'chat'
  | 'agents'
  | 'tasks'
  | 'approvals'
  | 'files'
  | 'compute'
  | 'sessions'
  | 'settings';

export type SituationalPreset = 'all' | 'creative' | 'engineering' | 'infrastructure';

export type SettingsModuleId =
  | 'workspace_appearance'
  | 'compute_kaggle'
  | 'inference_models'
  | 'cloudflare_edge'
  | 'identity_security'
  | 'deployment_cicd';

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  title: string;
  sceneHeading: string;
  visualPrompt: string;
  cameraAngle: string;
  lens: string;
  cameraMovement: string;
  dialogue: string;
  durationSec: number;
  aspectRatio: '16:9' | '4:3' | '1:1' | '9:16';
  imageUrl: string;
  status: 'ready' | 'generating_image' | 'queued_video';
}

export interface StudioImageAsset {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  aspectRatio: '16:9' | '4:3' | '1:1' | '9:16';
  resolution: string;
  steps: number;
  cfgScale: number;
  seed: number;
  upscaled4x: boolean;
  bgRemoved: boolean;
  imageUrl: string;
  createdAt: string;
}

export interface StudioVideoClip {
  id: string;
  title: string;
  prompt: string;
  model: string;
  frames: number;
  fps: number;
  cameraMotion: string;
  motionStrength: number;
  keyframeImageUrl: string;
  aspectRatio: '16:9' | '4:3' | '1:1';
  status: 'ready' | 'rendering';
  progressPercent: number;
  createdAt: string;
}

export interface ScreenplayScene {
  id: string;
  sceneNumber: number;
  slugline: string;
  location: string;
  timeOfDay: 'DAY' | 'NIGHT' | 'DAWN' | 'DUSK' | 'CONTINUOUS';
  synopsis: string;
  blocks: Array<{
    id: string;
    type: 'slugline' | 'action' | 'character' | 'parenthetical' | 'dialogue' | 'transition';
    text: string;
  }>;
}

const INITIAL_STORYBOARD_SHOTS: StoryboardShot[] = [
  {
    id: 'shot_01',
    shotNumber: 1,
    title: 'Nordic Fjord Studio Establishing',
    sceneHeading: 'INT. NORDIC ARCHITECTURAL STUDIO - MORNING',
    visualPrompt: 'Architectural photography of a sunlit minimalist concrete and warm oak design studio overlooking a calm Nordic fjord, floor-to-ceiling glass, soft morning daylight casting clean geometric shadows.',
    cameraAngle: 'Eye-Level Wide',
    lens: '24mm Anamorphic',
    cameraMovement: 'Slow Dolly In',
    dialogue: 'ELENA (V.O.): Every autonomous system begins with spatial clarity.',
    durationSec: 4.5,
    aspectRatio: '16:9',
    imageUrl: '/src/assets/images/studio_arch_render_1793995336638.jpg',
    status: 'ready',
  },
  {
    id: 'shot_02',
    shotNumber: 2,
    title: 'Optics & Robotics Bench Calibration',
    sceneHeading: 'INT. PHOTONICS RESEARCH LAB - GOLDEN HOUR',
    visualPrompt: 'Cinematic wide-angle film still of a clean modern robotics and optics research laboratory at golden hour, glass partitions, precision optical bench with subtle warm tungsten and natural window lighting.',
    cameraAngle: 'Medium Two-Shot',
    lens: '35mm Prime',
    cameraMovement: 'Lateral Track Right',
    dialogue: 'DR. VANCE: Lock the tensor lease on node two before the thermal sweep.',
    durationSec: 3.8,
    aspectRatio: '16:9',
    imageUrl: '/src/assets/images/storyboard_scene_lab_1793995338170.jpg',
    status: 'ready',
  },
  {
    id: 'shot_03',
    shotNumber: 3,
    title: 'Modular Synthesizer Telemetry Macro',
    sceneHeading: 'INT. ACOUSTIC HARDWARE LAB - DAY',
    visualPrompt: 'Studio product photography of a precision anodized aluminum modular audio synthesizer on a neutral limestone surface, crisp machined dials, soft diffused side lighting.',
    cameraAngle: 'High-Angle Macro',
    lens: '85mm Macro',
    cameraMovement: 'Static Focus Pull',
    dialogue: 'ELENA: Patch the harmonic clock directly into the edge router.',
    durationSec: 3.0,
    aspectRatio: '4:3',
    imageUrl: '/src/assets/images/studio_product_design_1793995336944.jpg',
    status: 'ready',
  },
  {
    id: 'shot_04',
    shotNumber: 4,
    title: 'Coastal Research Campus Aerial',
    sceneHeading: 'EXT. COASTAL CLIFF CAMPUS - SUNRISE',
    visualPrompt: 'Cinematic aerial wide establishing shot of a modern architectural research campus nestled along rugged coastal cliffs at sunrise, low coastal mist, warm golden sunlight.',
    cameraAngle: 'High Altitude Aerial',
    lens: '18mm Wide',
    cameraMovement: 'Crane & Orbit Ascend',
    dialogue: 'SYSTEM LOG (OVER RADIO): Primary WEUR edge link nominal. Zero packet loss.',
    durationSec: 5.2,
    aspectRatio: '16:9',
    imageUrl: '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg',
    status: 'ready',
  },
];

const INITIAL_STUDIO_IMAGES: StudioImageAsset[] = [
  {
    id: 'img_01',
    title: 'Nordic Fjord Architectural Studio',
    prompt: 'Architectural photography of a sunlit minimalist concrete and warm oak design studio overlooking a calm Nordic fjord, floor-to-ceiling glass, soft morning daylight casting clean geometric shadows, Leica 35mm editorial aesthetic.',
    negativePrompt: 'blurry, low resolution, oversaturated, neon, cluttered',
    model: 'sdxl-lightning',
    aspectRatio: '16:9',
    resolution: '1536 × 864',
    steps: 4,
    cfgScale: 1.8,
    seed: 84920144,
    upscaled4x: true,
    bgRemoved: false,
    imageUrl: '/src/assets/images/studio_arch_render_1793995336638.jpg',
    createdAt: new Date(Date.now() - 3600_000 * 3).toISOString(),
  },
  {
    id: 'img_02',
    title: 'Vertex Modular Synthesizer Hardware',
    prompt: 'Studio product photography of a precision anodized aluminum modular audio synthesizer on a neutral limestone surface, crisp machined dials, soft diffused side lighting, shallow depth of field.',
    negativePrompt: 'plastic, harsh shadows, distorted text',
    model: 'sdxl-lightning',
    aspectRatio: '4:3',
    resolution: '1280 × 960',
    steps: 4,
    cfgScale: 2.0,
    seed: 39104821,
    upscaled4x: true,
    bgRemoved: false,
    imageUrl: '/src/assets/images/studio_product_design_1793995336944.jpg',
    createdAt: new Date(Date.now() - 3600_000 * 2).toISOString(),
  },
  {
    id: 'img_03',
    title: 'Photonics & Robotics Calibration Lab',
    prompt: 'Cinematic wide-angle film still of a clean modern robotics and optics research laboratory at golden hour, glass partitions, precision optical bench with subtle warm tungsten and natural window lighting.',
    negativePrompt: 'sci-fi neon, lens flare, cartoon',
    model: 'sd-1.5-standard',
    aspectRatio: '16:9',
    resolution: '1344 × 768',
    steps: 20,
    cfgScale: 7.0,
    seed: 71940288,
    upscaled4x: false,
    bgRemoved: false,
    imageUrl: '/src/assets/images/storyboard_scene_lab_1793995338170.jpg',
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'img_04',
    title: 'Coastal Research Campus Sunrise',
    prompt: 'Cinematic aerial wide establishing shot of a modern architectural research campus nestled along rugged coastal cliffs at sunrise, low coastal mist, warm golden sunlight, clean geometric rooftops.',
    negativePrompt: 'haze, overexposed, low detail',
    model: 'sdxl-lightning',
    aspectRatio: '16:9',
    resolution: '1536 × 864',
    steps: 4,
    cfgScale: 1.8,
    seed: 55209173,
    upscaled4x: true,
    bgRemoved: false,
    imageUrl: '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg',
    createdAt: new Date(Date.now() - 1800_000).toISOString(),
  },
];

const INITIAL_STUDIO_VIDEOS: StudioVideoClip[] = [
  {
    id: 'vid_01',
    title: 'Coastal Cliff Campus Sunrise Drone Orbit',
    prompt: 'Smooth aerial drone orbit over coastal architectural research campus at sunrise, gentle coastal mist drifting across cliff face, golden hour sunlight reflecting on glass rooftops.',
    model: 'animatediff-motion-v3',
    frames: 32,
    fps: 12,
    cameraMotion: 'Orbit & Crane Up',
    motionStrength: 0.72,
    keyframeImageUrl: '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg',
    aspectRatio: '16:9',
    status: 'ready',
    progressPercent: 100,
    createdAt: new Date(Date.now() - 2400_000).toISOString(),
  },
  {
    id: 'vid_02',
    title: 'Photonics Lab Robotic Arm Calibration',
    prompt: 'Subtle lateral tracking shot inside golden hour optics laboratory, precision robotic arm aligning laser interferometer on optical table.',
    model: 'animatediff-motion-v3',
    frames: 24,
    fps: 12,
    cameraMotion: 'Lateral Dolly Right',
    motionStrength: 0.58,
    keyframeImageUrl: '/src/assets/images/storyboard_scene_lab_1793995338170.jpg',
    aspectRatio: '16:9',
    status: 'ready',
    progressPercent: 100,
    createdAt: new Date(Date.now() - 1200_000).toISOString(),
  },
  {
    id: 'vid_03',
    title: 'Nordic Studio Morning Daylight Sweep',
    prompt: 'Slow forward dolly through minimalist concrete and oak studio toward floor-to-ceiling fjord windows, subtle water ripples in distance.',
    model: 'animatediff-motion-v3',
    frames: 24,
    fps: 12,
    cameraMotion: 'Slow Dolly In',
    motionStrength: 0.45,
    keyframeImageUrl: '/src/assets/images/studio_arch_render_1793995336638.jpg',
    aspectRatio: '16:9',
    status: 'ready',
    progressPercent: 100,
    createdAt: new Date(Date.now() - 600_000).toISOString(),
  },
];

const INITIAL_SCREENPLAY_SCENES: ScreenplayScene[] = [
  {
    id: 'scn_01',
    sceneNumber: 1,
    slugline: 'INT. NORDIC ARCHITECTURAL STUDIO - MORNING',
    location: 'Nordic Architectural Studio',
    timeOfDay: 'DAY',
    synopsis: 'Elena reviews the distributed node topology overlooking the quiet morning fjord before initiating the coastal array.',
    blocks: [
      { id: 'b1', type: 'slugline', text: 'INT. NORDIC ARCHITECTURAL STUDIO - MORNING' },
      { id: 'b2', type: 'action', text: 'Pale northern sunlight cuts across raw board-formed concrete and warm oak worktables. Outside the floor-to-ceiling glass, a deep fjord lies still.' },
      { id: 'b3', type: 'action', text: 'ELENA ROSTOVA (34), lead systems architect, studies a clean schematic projection across two calibrated monitors.' },
      { id: 'b4', type: 'character', text: 'ELENA' },
      { id: 'b5', type: 'parenthetical', text: '(quietly, into comms)' },
      { id: 'b6', type: 'dialogue', text: 'Every autonomous system begins with spatial clarity. If the edge routing table drifts by even four milliseconds, the optical array loses phase lock.' },
      { id: 'b7', type: 'transition', text: 'CUT TO:' },
    ],
  },
  {
    id: 'scn_02',
    sceneNumber: 2,
    slugline: 'INT. PHOTONICS RESEARCH LAB - GOLDEN HOUR',
    location: 'Photonics Research Lab',
    timeOfDay: 'DUSK',
    synopsis: 'Dr. Vance and Lin calibrate the 6-axis optical arm as the dual-T4 telemetry stream locks onto the primary lease.',
    blocks: [
      { id: 'b8', type: 'slugline', text: 'INT. PHOTONICS RESEARCH LAB - GOLDEN HOUR' },
      { id: 'b9', type: 'action', text: 'Warm late-afternoon sun filters through partitioned glass bays. On a vibration-isolated optical table, a matte-black robotic arm positions a fiber collimator.' },
      { id: 'b10', type: 'character', text: 'DR. MARCUS VANCE' },
      { id: 'b11', type: 'dialogue', text: 'Lock the tensor lease on node two before the thermal sweep starts. We only get one clean window at sunrise.' },
      { id: 'b12', type: 'character', text: 'LIN MEI' },
      { id: 'b13', type: 'parenthetical', text: '(adjusting the micrometer stage)' },
      { id: 'b14', type: 'dialogue', text: 'Heartbeat confirmed. Dual Tesla T4 cluster is online at twenty-nine gigabytes VRAM. Zero packet drop across WEUR.' },
      { id: 'b15', type: 'transition', text: 'DISSOLVE TO:' },
    ],
  },
  {
    id: 'scn_03',
    sceneNumber: 3,
    slugline: 'EXT. COASTAL CLIFF CAMPUS - SUNRISE',
    location: 'Coastal Cliff Campus',
    timeOfDay: 'DAWN',
    synopsis: 'Aerial view of the coastal research campus as low marine fog parts and the array completes its first autonomous pass.',
    blocks: [
      { id: 'b16', type: 'slugline', text: 'EXT. COASTAL CLIFF CAMPUS - SUNRISE' },
      { id: 'b17', type: 'action', text: 'HIGH AERIAL WIDE: Low marine mist rolls over jagged basalt cliffs. The timber-and-glass research pavilions glow warmly as the sun breaks the horizon.' },
      { id: 'b18', type: 'character', text: 'ELENA (V.O.)' },
      { id: 'b19', type: 'dialogue', text: 'We didn’t build a bigger monolith. We built a quieter grid.' },
      { id: 'b20', type: 'transition', text: 'FADE OUT.' },
    ],
  },
];

interface AppContextType {
  // Navigation & Situational Mode
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  situationalMode: SituationalPreset;
  setSituationalMode: (mode: SituationalPreset) => void;
  activeSettingsModule: SettingsModuleId;
  setActiveSettingsModule: (mod: SettingsModuleId) => void;

  // Theme (Light Primary)
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  toggleTheme: () => void;

  // Creative & Technical Studio State
  storyboardShots: StoryboardShot[];
  addStoryboardShot: (shot: Omit<StoryboardShot, 'id' | 'shotNumber'>) => StoryboardShot;
  updateStoryboardShot: (shot: StoryboardShot) => void;
  deleteStoryboardShot: (id: string) => void;
  reorderStoryboardShot: (id: string, direction: 'up' | 'down') => void;

  studioImages: StudioImageAsset[];
  addStudioImage: (img: Omit<StudioImageAsset, 'id' | 'createdAt'>) => StudioImageAsset;
  deleteStudioImage: (id: string) => void;

  studioVideos: StudioVideoClip[];
  addStudioVideo: (clip: Omit<StudioVideoClip, 'id' | 'createdAt'>) => StudioVideoClip;

  screenplayScenes: ScreenplayScene[];
  setScreenplayScenes: React.Dispatch<React.SetStateAction<ScreenplayScene[]>>;
  extractSceneToStoryboard: (scene: ScreenplayScene) => StoryboardShot;

  // Authentication & Identity
  user: UserAccount | null;
  workspace: Organization | null;
  workspaces: Organization[];
  isAuthenticated: boolean;
  passkeys: PasskeyItem[];
  hasTotp: boolean;
  isAuthModalOpen: boolean;
  authModalMode: 'login' | 'register';
  setIsAuthModalOpen: (open: boolean) => void;
  setAuthModalMode: (mode: 'login' | 'register') => void;
  refreshUser: () => Promise<void>;
  logout: () => Promise<void>;
  enrollPasskey: (credentialName?: string) => Promise<void>;
  deletePasskey: (id: string) => Promise<void>;
  setupTotp: () => Promise<{ secret: string; otpauth_url: string; account_email: string }>;
  verifyTotpSetup: (code: string) => Promise<void>;

  // Workspaces & Worker Ownership
  workerOwnerships: Record<string, WorkerOwnershipInfo>;
  claimWorkerOwnership: (workerId: string, ownershipType?: 'personal' | 'organization') => Promise<void>;

  // Kaggle & Compute Session Management
  computeSessions: ComputeSession[];
  activeComputeSession: ComputeSession | null;
  kaggleCredentialsStatus: KaggleCredentialsStatus;
  refreshComputeSessions: () => Promise<void>;
  startComputeSession: (notebookSlug?: string) => Promise<ComputeSession>;
  stopComputeSession: (sessionId: string) => Promise<ComputeSession>;
  restartComputeSession: (sessionId: string) => Promise<ComputeSession>;
  saveKaggleCredentials: (username: string, key: string) => Promise<void>;

  // Domain Entities
  agents: Agent[];
  tasks: Task[];
  approvals: ApprovalRequest[];
  conversations: Conversation[];
  files: AttachedFile[];
  logs: ActivityLog[];
  runtimeConfig: RuntimeConfig;
  stats: SystemStats;
  workers: ComputeWorker[];
  models: ModelDefinition[];

  // Active Selection
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;

  // Actions
  refreshAll: () => Promise<void>;
  createAgent: (agent: Agent) => Promise<void>;
  updateAgent: (agent: Agent) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  submitTask: (params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }) => Promise<Task>;
  cancelTask: (taskId: string, reason?: string) => void;
  togglePauseTask: (taskId: string) => void;
  decideApproval: (approvalId: string, decision: 'approved' | 'rejected', comment?: string) => Promise<void>;
  uploadFile: (file: File, taskId?: string, conversationId?: string) => Promise<AttachedFile>;
  deleteFile: (id: string) => Promise<void>;
  pingRuntime: () => Promise<void>;
  updateRuntimeConfig: (config: RuntimeConfig) => void;
  registerWorker: (payload: {
    name: string;
    provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
    gpu_model: string;
    gpu_count: number;
    vram_mb: number;
    system_ram_mb: number;
    contributor_name?: string;
  }) => Promise<{ worker: ComputeWorker; apiKey: string }>;

  // Notifications
  notification: { message: string; type: 'success' | 'info' | 'error' } | null;
  showNotification: (message: string, type?: 'success' | 'info' | 'error') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [situationalMode, setSituationalMode] = useState<SituationalPreset>('all');
  const [activeSettingsModule, setActiveSettingsModule] = useState<SettingsModuleId>('workspace_appearance');

  // Light Mode Primary
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('aetheros_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // ignore
    }
    return 'light';
  });

  // Studio Workspaces State
  const [storyboardShots, setStoryboardShots] = useState<StoryboardShot[]>(INITIAL_STORYBOARD_SHOTS);
  const [studioImages, setStudioImages] = useState<StudioImageAsset[]>(INITIAL_STUDIO_IMAGES);
  const [studioVideos, setStudioVideos] = useState<StudioVideoClip[]>(INITIAL_STUDIO_VIDEOS);
  const [screenplayScenes, setScreenplayScenes] = useState<ScreenplayScene[]>(INITIAL_SCREENPLAY_SCENES);

  const [agents, setAgents] = useState<Agent[]>(dbStorage.getAgents());
  const [tasks, setTasks] = useState<Task[]>(dbStorage.getTasks());
  const [approvals, setApprovals] = useState<ApprovalRequest[]>(dbStorage.getApprovals());
  const [conversations, setConversations] = useState<Conversation[]>(dbStorage.getConversations());
  const [files, setFiles] = useState<AttachedFile[]>(dbStorage.getFiles());
  const [logs, setLogs] = useState<ActivityLog[]>(dbStorage.getLogs());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>(dbStorage.getRuntimeConfig());
  const [stats, setStats] = useState<SystemStats>(dbStorage.getStats());
  const [workers, setWorkers] = useState<ComputeWorker[]>([]);
  const [models, setModels] = useState<ModelDefinition[]>([]);

  // Auth & Identity State
  const [user, setUser] = useState<UserAccount | null>(null);
  const [workspace, setWorkspace] = useState<Organization | null>(null);
  const [workspaces, setWorkspaces] = useState<Organization[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [hasTotp, setHasTotp] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'register'>('login');

  // Ownership & Compute Sessions
  const [workerOwnerships, setWorkerOwnerships] = useState<Record<string, WorkerOwnershipInfo>>({});
  const [computeSessions, setComputeSessions] = useState<ComputeSession[]>([]);
  const [activeComputeSession, setActiveComputeSession] = useState<ComputeSession | null>(null);
  const [kaggleCredentialsStatus, setKaggleCredentialsStatus] = useState<KaggleCredentialsStatus>({ configured: false });

  const isAuthenticated = Boolean(user && user.is_active);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Sync theme to <html> and localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('aetheros_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  const showNotification = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(prev => (prev?.message === message ? null : prev));
    }, 3800);
  };

  // Studio Workspace Actions
  const addStoryboardShot = (shot: Omit<StoryboardShot, 'id' | 'shotNumber'>): StoryboardShot => {
    const newShot: StoryboardShot = {
      ...shot,
      id: `shot_${Date.now()}`,
      shotNumber: storyboardShots.length + 1,
    };
    setStoryboardShots(prev => [...prev, newShot]);
    return newShot;
  };

  const updateStoryboardShot = (updated: StoryboardShot) => {
    setStoryboardShots(prev => prev.map(s => (s.id === updated.id ? updated : s)));
  };

  const deleteStoryboardShot = (id: string) => {
    setStoryboardShots(prev =>
      prev
        .filter(s => s.id !== id)
        .map((s, idx) => ({ ...s, shotNumber: idx + 1 }))
    );
  };

  const reorderStoryboardShot = (id: string, direction: 'up' | 'down') => {
    setStoryboardShots(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return copy.map((s, i) => ({ ...s, shotNumber: i + 1 }));
    });
  };

  const addStudioImage = (img: Omit<StudioImageAsset, 'id' | 'createdAt'>): StudioImageAsset => {
    const created: StudioImageAsset = {
      ...img,
      id: `img_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setStudioImages(prev => [created, ...prev]);
    return created;
  };

  const deleteStudioImage = (id: string) => {
    setStudioImages(prev => prev.filter(i => i.id !== id));
  };

  const addStudioVideo = (clip: Omit<StudioVideoClip, 'id' | 'createdAt'>): StudioVideoClip => {
    const created: StudioVideoClip = {
      ...clip,
      id: `vid_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    setStudioVideos(prev => [created, ...prev]);
    return created;
  };

  const extractSceneToStoryboard = (scene: ScreenplayScene): StoryboardShot => {
    const firstAction = scene.blocks.find(b => b.type === 'action')?.text || scene.synopsis;
    const firstDialogueBlock = scene.blocks.find(b => b.type === 'dialogue');
    const firstCharacterBlock = scene.blocks.find(b => b.type === 'character');
    const dialogueLine = firstDialogueBlock
      ? `${firstCharacterBlock ? firstCharacterBlock.text + ': ' : ''}${firstDialogueBlock.text}`
      : 'No dialogue (Visual sequence)';

    const fallbackImages = [
      '/src/assets/images/studio_arch_render_1793995336638.jpg',
      '/src/assets/images/storyboard_scene_lab_1793995338170.jpg',
      '/src/assets/images/studio_product_design_1793995336944.jpg',
      '/src/assets/images/storyboard_scene_aerial_1793995339019.jpg',
    ];
    const pickedImage = fallbackImages[storyboardShots.length % fallbackImages.length];

    const shot = addStoryboardShot({
      title: `Scene ${scene.sceneNumber}: ${scene.location}`,
      sceneHeading: scene.slugline,
      visualPrompt: firstAction,
      cameraAngle: 'Medium Wide',
      lens: '35mm Anamorphic',
      cameraMovement: 'Slow Dolly In',
      dialogue: dialogueLine,
      durationSec: 4.0,
      aspectRatio: '16:9',
      imageUrl: pickedImage,
      status: 'ready',
    });
    showNotification(`Extracted "${scene.slugline}" to Storyboard Shot #${shot.shotNumber}`, 'success');
    return shot;
  };

  const refreshUser = useCallback(async () => {
    try {
      if (!apiClient.getSessionToken()) {
        setUser(null);
        setWorkspace(null);
        setWorkspaces([]);
        setPasskeys([]);
        setHasTotp(false);
        return;
      }
      const data = await apiClient.getMe();
      if (data && data.user) {
        setUser(data.user);
        setWorkspace(data.current_organization || (data.organizations && data.organizations[0]) || null);
        setWorkspaces(data.organizations || []);
        setPasskeys(data.passkeys || []);
        setHasTotp(Boolean(data.has_totp));
      } else {
        setUser(null);
      }
    } catch {
      apiClient.setSessionToken(null);
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPasskeys([]);
      setHasTotp(false);
    }
  }, []);

  const refreshComputeSessions = useCallback(async () => {
    try {
      const [sessions, kaggleStatus] = await Promise.allSettled([
        apiClient.getComputeSessions(),
        apiClient.getKaggleCredentialsStatus(),
      ]);
      if (sessions.status === 'fulfilled') {
        setComputeSessions(sessions.value);
        if (sessions.value.length > 0) {
          const active = sessions.value.find(s => ['starting', 'initializing', 'waiting_for_worker', 'ready', 'busy'].includes(s.status)) || sessions.value[0];
          setActiveComputeSession(active);
        } else {
          setActiveComputeSession(null);
        }
      }
      if (kaggleStatus.status === 'fulfilled') {
        setKaggleCredentialsStatus(kaggleStatus.value);
      }
    } catch {
      // ignore
    }
  }, []);

  // Sync live backend with local state
  const refreshAll = useCallback(async () => {
    try {
      const [remoteAgents, remoteTasks, remoteApprovals, remoteFiles, remoteWorkers, remoteModels, remoteLogs, remoteConversations, remoteOwnerships] =
        await Promise.allSettled([
          apiClient.getAgents(),
          apiClient.getTasks(),
          apiClient.getApprovals(),
          apiClient.getFiles(),
          apiClient.getWorkers(),
          apiClient.getModels(),
          apiClient.getLogs(),
          apiClient.getConversations(),
          apiClient.getWorkerOwnership(),
        ]);

      const localDefaultAgents = dbStorage.getAgents();
      const resolvedAgents =
        remoteAgents.status === 'fulfilled' && remoteAgents.value.length > 0
          ? remoteAgents.value
          : localDefaultAgents;

      const resolvedTasks =
        remoteTasks.status === 'fulfilled' ? remoteTasks.value : dbStorage.getTasks();
      const resolvedApprovals =
        remoteApprovals.status === 'fulfilled' ? remoteApprovals.value : dbStorage.getApprovals();
      const resolvedFiles =
        remoteFiles.status === 'fulfilled' ? remoteFiles.value : dbStorage.getFiles();
      const resolvedLogs =
        remoteLogs.status === 'fulfilled' ? remoteLogs.value : dbStorage.getLogs();
      const resolvedConversations =
        remoteConversations.status === 'fulfilled' ? remoteConversations.value : dbStorage.getConversations();

      setAgents(resolvedAgents);
      setTasks(resolvedTasks);
      setApprovals(resolvedApprovals);
      setFiles(resolvedFiles);
      setLogs(resolvedLogs);
      setConversations(resolvedConversations);

      if (remoteWorkers.status === 'fulfilled') {
        setWorkers(remoteWorkers.value);
      }

      if (remoteModels.status === 'fulfilled') {
        setModels(remoteModels.value);
      }

      if (remoteOwnerships.status === 'fulfilled') {
        const map: Record<string, WorkerOwnershipInfo> = {};
        for (const o of remoteOwnerships.value) {
          map[o.worker_id] = o;
        }
        setWorkerOwnerships(map);
      }

      const currentRuntime = dbStorage.getRuntimeConfig();
      setRuntimeConfig(currentRuntime);

      const totalBytes = resolvedFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0);
      setStats({
        total_agents: resolvedAgents.length,
        active_agents: resolvedAgents.filter(a => a.is_enabled).length,
        total_tasks: resolvedTasks.length,
        running_tasks: resolvedTasks.filter(t =>
          ['queued', 'assigned', 'downloading', 'loading_model', 'running', 'uploading'].includes(t.status)
        ).length,
        pending_approvals: resolvedApprovals.filter(a => a.status === 'pending').length,
        total_files: resolvedFiles.length,
        storage_bytes_used: totalBytes,
        runtime_status: currentRuntime.is_online ? 'healthy' : 'offline',
      });
    } catch {
      // Offline fallback
      setAgents(dbStorage.getAgents());
      setTasks(dbStorage.getTasks());
      setApprovals(dbStorage.getApprovals());
      setConversations(dbStorage.getConversations());
      setFiles(dbStorage.getFiles());
      setLogs(dbStorage.getLogs());
      setRuntimeConfig(dbStorage.getRuntimeConfig());
      setStats(dbStorage.getStats());
    }
  }, []);

  useEffect(() => {
    refreshUser();
    refreshComputeSessions();
    refreshAll();
    const interval = setInterval(() => {
      refreshAll();
      refreshComputeSessions();
    }, 3500);
    return () => clearInterval(interval);
  }, [refreshAll, refreshUser, refreshComputeSessions]);

  const createAgent = async (agent: Agent) => {
    try {
      await apiClient.createAgent(agent);
    } catch {
      // Fallback to local
    }
    dbStorage.saveAgent(agent);
    dbStorage.addLog({
      action: 'agent_created',
      category: 'agent',
      agent_id: agent.id,
      agent_name: agent.name,
      details: { model: agent.model },
    });
    await refreshAll();
    showNotification(`Agent "${agent.name}" created and synced`, 'success');
  };

  const updateAgent = async (agent: Agent) => {
    try {
      await apiClient.updateAgent(agent);
    } catch {
      // Fallback
    }
    dbStorage.saveAgent(agent);
    dbStorage.addLog({
      action: 'agent_updated',
      category: 'agent',
      agent_id: agent.id,
      agent_name: agent.name,
    });
    await refreshAll();
    showNotification(`Agent "${agent.name}" updated`, 'success');
  };

  const deleteAgent = async (id: string) => {
    const agent = agents.find(a => a.id === id);
    try {
      await apiClient.deleteAgent(id);
    } catch {
      // Fallback
    }
    dbStorage.deleteAgent(id);
    dbStorage.addLog({
      action: 'agent_deleted',
      category: 'agent',
      agent_id: id,
      agent_name: agent?.name,
    });
    await refreshAll();
    showNotification(`Agent removed`, 'info');
  };

  const submitTask = async (params: {
    agentId: string;
    title: string;
    description: string;
    inputPayload: Record<string, unknown>;
    priority: 'low' | 'medium' | 'high' | 'critical';
  }) => {
    try {
      const newTask = await apiClient.submitTask(params);
      dbStorage.saveTask(newTask);
      await refreshAll();
      setSelectedTaskId(newTask.id);
      showNotification(`Task "${newTask.title}" dispatched to distributed queue`, 'success');
      return newTask;
    } catch (err: any) {
      showNotification(`Failed to dispatch task: ${err?.message || 'Server error'}`, 'error');
      throw err;
    }
  };

  const cancelTask = (taskId: string, reason?: string) => {
    apiClient.cancelTask(taskId, reason).catch(() => {});
    runtimeEngine.cancelTask(taskId, reason);
    refreshAll();
    showNotification(`Task cancelled`, 'info');
  };

  const togglePauseTask = (taskId: string) => {
    apiClient.togglePauseTask(taskId).catch(() => {});
    runtimeEngine.toggleTaskPause(taskId);
    refreshAll();
  };

  const decideApproval = async (approvalId: string, decision: 'approved' | 'rejected', comment?: string) => {
    const approval = approvals.find(a => a.id === approvalId);
    if (!approval) return;

    let syncedRemote = false;
    try {
      await apiClient.decideApproval(approvalId, decision, comment);
      syncedRemote = true;
    } catch {
      // Fallback
    }

    const updatedApproval: ApprovalRequest = {
      ...approval,
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: 'Operator',
      review_comment: comment || (decision === 'approved' ? 'Action authorized by human operator' : 'Action declined'),
    };

    dbStorage.saveApproval(updatedApproval);
    dbStorage.addLog({
      action: `approval_${decision}`,
      category: 'approval',
      task_id: approval.task_id,
      task_title: approval.task_title,
      agent_id: approval.agent_id,
      agent_name: approval.agent_name,
      details: { decision, comment: updatedApproval.review_comment },
    });

    if (decision === 'approved') {
      if (!syncedRemote) {
        runtimeEngine.resumeTaskAfterApproval(approval.task_id);
      }
      showNotification(`Consequential action authorized. Task execution resumed.`, 'success');
    } else {
      if (!syncedRemote) {
        runtimeEngine.cancelTask(approval.task_id, `Rejected in authorization queue: ${comment || 'No reason provided'}`);
      }
      showNotification(`Action rejected. Task halted.`, 'info');
    }

    await refreshAll();
  };

  const uploadFile = async (file: File, taskId?: string, _conversationId?: string): Promise<AttachedFile> => {
    try {
      const uploadedFile = await apiClient.uploadFile(file, taskId);
      dbStorage.saveFile(uploadedFile);
      dbStorage.addLog({
        action: 'file_uploaded',
        category: 'file',
        details: { filename: file.name, size: file.size, key: uploadedFile.r2_key },
      });
      await refreshAll();
      showNotification(`File "${file.name}" uploaded to Cloudflare R2`, 'success');
      return uploadedFile;
    } catch (err: any) {
      showNotification(`File upload failed: ${err?.message || 'R2 upload failed'}`, 'error');
      throw err;
    }
  };

  const deleteFile = async (id: string) => {
    const file = files.find(f => f.id === id);
    if (file?.r2_key) {
      try {
        await apiClient.deleteFile(file.r2_key);
      } catch {
        // Fallback
      }
    }
    dbStorage.deleteFile(id);
    dbStorage.addLog({
      action: 'file_deleted',
      category: 'file',
      details: { filename: file?.filename },
    });
    await refreshAll();
    showNotification(`File removed from storage`, 'info');
  };

  const pingRuntime = async () => {
    const outcome = await runtimeEngine.pingRuntime();
    setRuntimeConfig(dbStorage.getRuntimeConfig());
    if (outcome.success) {
      showNotification(`Connected to ${outcome.nodeId || 'Worker Node'} (${outcome.latencyMs}ms)`, 'success');
    } else {
      showNotification(outcome.error || 'No active compute workers connected', 'error');
    }
  };

  const updateRuntimeConfig = (config: RuntimeConfig) => {
    dbStorage.saveRuntimeConfig(config);
    setRuntimeConfig(config);
  };

  const registerWorker = async (payload: {
    name: string;
    provider: 'kaggle' | 'oracle' | 'runpod' | 'self_hosted' | 'custom';
    gpu_model: string;
    gpu_count: number;
    vram_mb: number;
    system_ram_mb: number;
    contributor_name?: string;
  }) => {
    const res = await apiClient.registerWorker(payload);
    await refreshAll();
    showNotification(`Compute worker "${res.worker.name}" registered`, 'success');
    return res;
  };

  const logout = async () => {
    try {
      await apiClient.logout();
    } catch {
      // ignore
    } finally {
      apiClient.setSessionToken(null);
      setUser(null);
      setWorkspace(null);
      setWorkspaces([]);
      setPasskeys([]);
      setHasTotp(false);
      showNotification('Signed out successfully', 'info');
    }
  };

  const enrollPasskey = async (_credentialName?: string) => {
    showNotification('Passkey enrollment is active during registration and in Security settings', 'info');
  };

  const deletePasskey = async (id: string) => {
    try {
      await apiClient.deletePasskey(id);
      await refreshUser();
      showNotification('Passkey revoked', 'info');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to revoke passkey', 'error');
      throw err;
    }
  };

  const setupTotp = async () => {
    return apiClient.setupTotp();
  };

  const verifyTotpSetup = async (code: string) => {
    await apiClient.verifyTotpSetup(code);
    await refreshUser();
    showNotification('Authenticator app (TOTP) successfully enrolled', 'success');
  };

  const claimWorkerOwnership = async (workerId: string, ownershipType: 'personal' | 'organization' = 'personal') => {
    if (!user) {
      setAuthModalMode('login');
      setIsAuthModalOpen(true);
      showNotification('Please authenticate to claim worker ownership', 'info');
      return;
    }
    try {
      const claim = await apiClient.claimWorker(workerId, ownershipType);
      setWorkerOwnerships(prev => ({ ...prev, [workerId]: claim }));
      await refreshAll();
      showNotification(`Worker '${workerId}' claimed by ${claim.owner_name || user.name}`, 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to claim worker', 'error');
      throw err;
    }
  };

  const startComputeSession = async (notebookSlug?: string) => {
    try {
      const session = await apiClient.startComputeSession({
        provider: 'kaggle',
        notebook_slug: notebookSlug,
        worker_id: 'wrk_kaggle_464cc6bdb46da70260a1e849',
      });
      await refreshComputeSessions();
      showNotification(`Kaggle compute session ${session.id} initiated`, 'success');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to start session', 'error');
      throw err;
    }
  };

  const stopComputeSession = async (sessionId: string) => {
    try {
      const session = await apiClient.stopComputeSession(sessionId);
      await refreshComputeSessions();
      showNotification(`Stopping Kaggle session ${sessionId} gracefully`, 'info');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to stop session', 'error');
      throw err;
    }
  };

  const restartComputeSession = async (sessionId: string) => {
    try {
      const session = await apiClient.restartComputeSession(sessionId);
      await refreshComputeSessions();
      showNotification(`Restarting Kaggle session ${sessionId}`, 'info');
      return session;
    } catch (err: any) {
      showNotification(err?.message || 'Failed to restart session', 'error');
      throw err;
    }
  };

  const saveKaggleCredentials = async (username: string, key: string) => {
    try {
      await apiClient.saveKaggleCredentials({ kaggle_username: username, kaggle_key: key });
      await refreshComputeSessions();
      showNotification('Kaggle API credentials encrypted and saved', 'success');
    } catch (err: any) {
      showNotification(err?.message || 'Failed to save Kaggle credentials', 'error');
      throw err;
    }
  };

  return (
    <AppContext.Provider
      value={{
        activeTab,
        setActiveTab,
        situationalMode,
        setSituationalMode,
        activeSettingsModule,
        setActiveSettingsModule,
        theme,
        setTheme,
        toggleTheme,
        storyboardShots,
        addStoryboardShot,
        updateStoryboardShot,
        deleteStoryboardShot,
        reorderStoryboardShot,
        studioImages,
        addStudioImage,
        deleteStudioImage,
        studioVideos,
        addStudioVideo,
        screenplayScenes,
        setScreenplayScenes,
        extractSceneToStoryboard,
        user,
        workspace,
        workspaces,
        isAuthenticated,
        passkeys,
        hasTotp,
        isAuthModalOpen,
        authModalMode,
        setIsAuthModalOpen,
        setAuthModalMode,
        refreshUser,
        logout,
        enrollPasskey,
        deletePasskey,
        setupTotp,
        verifyTotpSetup,
        workerOwnerships,
        claimWorkerOwnership,
        computeSessions,
        activeComputeSession,
        kaggleCredentialsStatus,
        refreshComputeSessions,
        startComputeSession,
        stopComputeSession,
        restartComputeSession,
        saveKaggleCredentials,
        agents,
        tasks,
        approvals,
        conversations,
        files,
        logs,
        runtimeConfig,
        stats,
        workers,
        models,
        selectedTaskId,
        setSelectedTaskId,
        selectedAgentId,
        setSelectedAgentId,
        selectedConversationId,
        setSelectedConversationId,
        refreshAll,
        createAgent,
        updateAgent,
        deleteAgent,
        submitTask,
        cancelTask,
        togglePauseTask,
        decideApproval,
        uploadFile,
        deleteFile,
        pingRuntime,
        updateRuntimeConfig,
        registerWorker,
        notification,
        showNotification,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
