import {
  Activity, ArrowLeft, Backpack, Baby, Bell, Bird, Bluetooth, Bone, Bot, Brain, Camera, Check, ChevronRight, CircleAlert, Clock, Cloud, CloudLightning, Compass, Contrast,
  Cpu, Download, Droplets, Eye, FileText, Flame, Footprints, Gamepad2, Globe, Heart, HeartPulse, Hospital, House, Info, Languages, LifeBuoy, Link2, Lock, Map, MapPin,
  Menu, MessageCircle, Mic, Moon, Mountain, Navigation, Newspaper, Package, Pause, Phone, Pill, Play, Plus, QrCode, Radio, RefreshCw, Search, Send, Settings, ShieldCheck,
  Siren, Smartphone, Snowflake, Sparkles, Square, Star, Stethoscope, Sun, Syringe, Tent, Terminal, Thermometer, Trophy, Type, User, Users, Vibrate, Volume2, Waves, Wifi, WifiOff,
  Wind, X, Zap,
} from 'lucide-react-native';
import React from 'react';
import { useTheme } from './ui';

// One place that decides which SVG stands for what, so the app never falls back to emoji.
const ICONS = {
  home: House, map: Map, chat: MessageCircle, news: Newspaper, aid: Stethoscope, more: Menu, learn: Backpack, play: Gamepad2, owl: Bird, me: User, family: Users,
  pin: MapPin, bell: Bell, settings: Settings, phone: Phone, shield: ShieldCheck, heart: Heart, fire: Flame, water: Droplets, wind: Wind, mountain: Mountain, flood: Waves,
  sun: Sun, storm: CloudLightning, cloud: Cloud, heat: Thermometer, pulse: Activity, cold: Snowflake, zap: Zap, bone: Bone, siren: Siren, tent: Tent, hospital: Hospital, pill: Pill,
  camera: Camera, mic: Mic, speaker: Volume2, check: Check, close: X, next: ChevronRight, back: ArrowLeft, plus: Plus, bot: Bot, link: Link2, qr: QrCode, radio: Radio,
  bluetooth: Bluetooth, wifi: Wifi, wifiOff: WifiOff, download: Download, send: Send, sparkle: Sparkles, baby: Baby, syringe: Syringe, lifebuoy: LifeBuoy, compass: Compass,
  steps: Footprints, trophy: Trophy, star: Star, lock: Lock, globe: Globe, cpu: Cpu, terminal: Terminal, playTri: Play, pause: Pause, stop: Square, search: Search, refresh: RefreshCw,
  eye: Eye, moon: Moon, contrast: Contrast, type: Type, language: Languages, vibrate: Vibrate, heartPulse: HeartPulse, doc: FileText, clock: Clock, navigate: Navigation,
  alert: CircleAlert, info: Info, package: Package, phoneMobile: Smartphone, brain: Brain,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, color, strokeWidth = 1.8, fill }: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  const { p } = useTheme();
  const Cmp = ICONS[name];
  return <Cmp size={size} color={color ?? p.text} strokeWidth={strokeWidth} fill={fill ?? 'none'} />;
}

/** Icon for a knowledge-base guide, so guides need no emoji. */
const GUIDE_ICON: Record<string, IconName> = {
  'severe-bleeding': 'heart', burns: 'fire', fracture: 'bone', 'cpr-adult': 'pulse', 'choking-adult': 'alert', 'choking-infant': 'baby', 'recovery-position': 'me',
  drowning: 'flood', 'electric-shock': 'zap', 'snake-bite': 'alert', 'heat-stroke': 'heat', hypothermia: 'cold', dehydration: 'water', 'head-injury': 'brain', nosebleed: 'water',
  'eye-injury': 'eye', fainting: 'me', asthma: 'wind', seizure: 'zap', poisoning: 'alert', 'allergic-reaction': 'alert', 'heart-attack': 'heartPulse', stroke: 'brain',
  'trapped-debris': 'siren', 'minor-wound': 'aid', 'animal-bite': 'alert', 'smoke-fire': 'fire', 'cloth-bandage': 'aid', 'improvised-tourniquet': 'aid', 'newspaper-splint': 'bone',
  'scarf-sling': 'bone', 'homemade-ors': 'water', 'purify-water': 'water', 'plastic-wrap-burn': 'fire', 'cold-compress': 'cold', stretcher: 'family', 'emergency-signal': 'radio',
  'dust-mask': 'wind', 'insulate-warm': 'cold', 'flood-float': 'lifebuoy',
  earthquake: 'mountain', flood: 'flood', cyclone: 'wind', landslide: 'mountain', heatwave: 'sun', lightning: 'storm', tsunami: 'flood',
};
export const guideIcon = (id: string): IconName => GUIDE_ICON[id] ?? 'aid';
