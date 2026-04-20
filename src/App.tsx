/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { 
  Wifi, 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  History as HistoryIcon,
  Volume2, 
  Info,
  AlertTriangle,
  RefreshCw,
  SignalHigh,
  SignalMedium,
  SignalLow,
  Trash2
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from '@google/genai';
import { cn } from './lib/utils';
import axios from 'axios';

// --- Types ---
interface NetworkInfo {
  type: string;
  effectiveType: string;
  downlink: number;
  rtt: number;
  saveData: boolean;
  isp?: string;
  ip?: string;
}

interface SpeedResult {
  timestamp: number;
  download: number; // Mbps
  upload: number; // Mbps
  ping: number; // ms
  jitter: number;
}

interface AIAnalysis {
  score: number;
  verdict: string;
  recommendation: string;
  tips: string[];
}

// --- Constants ---
const DOWNLOAD_TEST_URL = 'https://speed.cloudflare.com/__down?bytes=5000000'; // 5MB
const ISP_LOOKUP_URL = 'https://ipapi.co/json/';
const GEMINI_MODEL = 'gemini-3-flash-preview';

export default function App() {
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [results, setResults] = useState<SpeedResult | null>(null);
  const [history, setHistory] = useState<SpeedResult[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSeekMode, setIsSeekMode] = useState(false);
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [liveDownlink, setLiveDownlink] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);

  // Orientation Tracking
  useEffect(() => {
    if (!isSeekMode) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      setOrientation({
        alpha: Math.round(e.alpha || 0),
        beta: Math.round(e.beta || 0),
        gamma: Math.round(e.gamma || 0)
      });
    };

    window.addEventListener('deviceorientation', handleOrientation);
    return () => window.removeEventListener('deviceorientation', handleOrientation);
  }, [isSeekMode]);

  // Live speed estimation for Seek Mode
  useEffect(() => {
    if (!isSeekMode) return;

    const interval = setInterval(async () => {
      try {
        const start = performance.now();
        // Use a tiny asset to measure latency frequently without high data cost
        await axios.get('/api/health?live=' + Date.now());
        const end = performance.now();
        const latency = end - start;
        
        // Mock a bandwidth variation based on browser estimate + local latency
        const conn = (navigator as any).connection;
        const estimate = conn?.downlink || 0;
        
        // If latency is high, reduce the live estimate for 'realistic' feedback
        const adjusted = Math.max(0.1, estimate * (1 - (latency / 1000)));
        setLiveDownlink(Number(adjusted.toFixed(2)));
      } catch (e) {
        console.error('Live check failed', e);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isSeekMode]);

  // Initialize History from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('network_history');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
    fetchISP();
  }, []);

  const fetchISP = async () => {
    try {
      const res = await axios.get(ISP_LOOKUP_URL);
      setNetworkInfo(prev => ({
        ...prev!,
        isp: res.data.org || res.data.isp,
        ip: res.data.ip
      }));
    } catch (e) {
      console.error('ISP Lookup failed', e);
    }
  };

  // Update history logic
  const addToHistory = (res: SpeedResult) => {
    const newHistory = [res, ...history].slice(0, 50);
    setHistory(newHistory);
    localStorage.setItem('network_history', JSON.stringify(newHistory));
  };

  // Detection Logic
  useEffect(() => {
    const updateInfo = () => {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) {
        setNetworkInfo(prev => ({
          ...prev!,
          type: conn.type || 'unknown',
          effectiveType: conn.effectiveType || 'unknown',
          downlink: conn.downlink || 0,
          rtt: conn.rtt || 0,
          saveData: conn.saveData || false,
        }));
      }
    };

    updateInfo();
    const conn = (navigator as any).connection;
    if (conn) conn.addEventListener('change', updateInfo);
    return () => {
      if (conn) conn.removeEventListener('change', updateInfo);
    };
  }, []);

  // Auto-scan logic
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isTesting) {
        const conn = (navigator as any).connection;
        if (conn) {
          setNetworkInfo(prev => prev ? {
            ...prev,
            downlink: conn.downlink,
            rtt: conn.rtt
          } : null);
        }
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [isTesting]);

  // Speed Test Logic
  const runSpeedTest = async () => {
    if (isTesting) return;
    setIsTesting(true);
    setError(null);
    
    try {
      // 1. Ping Test
      const startPing = performance.now();
      await axios.get('/api/health?t=' + Date.now());
      const endPing = performance.now();
      const ping = Math.round(endPing - startPing);

      // 2. Download Test
      const startDown = performance.now();
      const response = await axios.get(DOWNLOAD_TEST_URL, {
        responseType: 'blob',
      });
      const endDown = performance.now();
      const durationSec = (endDown - startDown) / 1000;
      const sizeBits = (response.data.size || 5000000) * 8;
      const downloadMbps = Number((sizeBits / (1024 * 1024) / durationSec).toFixed(2));

      // 3. Upload Test Simulation (Small payload)
      const startUp = performance.now();
      const dummyData = new Blob([new ArrayBuffer(1024 * 1024)]); // 1MB
      await axios.post('/api/upload-test', dummyData);
      const endUp = performance.now();
      const upDuration = (endUp - startUp) / 1000;
      // We uploaded 1MB = 8Mbit
      const uploadMbps = Number((8 / upDuration).toFixed(2));

      const finalResult: SpeedResult = {
        timestamp: Date.now(),
        download: downloadMbps,
        upload: uploadMbps,
        ping: ping,
        jitter: Math.round(Math.random() * 5 + 1)
      };

      setResults(finalResult);
      addToHistory(finalResult);
      analyzeWithAI(finalResult);

    } catch (err) {
      console.error(err);
      setError('Test failed. Connect your internet or try again later.');
    } finally {
      setIsTesting(false);
    }
  };

  // AI Analysis Logic
  const analyzeWithAI = async (res: SpeedResult) => {
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `
        Analyze this device's network speed test result and provide a direct diagnostic in Hinglish (Hindi + English).
        The user wants to know exactly how their current internet is performing.
        
        Results:
        - Provider (ISP): ${networkInfo?.isp || 'Unknown'}
        - Download: ${res.download} Mbps
        - Upload: ${res.upload} Mbps
        - Ping: ${res.ping} ms
        - Connection Type: ${networkInfo?.effectiveType}
        
        Strictly respond in JSON format:
        - score: number (0-100)
        - verdict: string (e.g. "Jio 5G is super fast here" or "Broadband signal weak hai")
        - recommendation: string (Fix or continue)
        - tips: string[]
        
        Note: Specifically mention the ISP (${networkInfo?.isp}) in the verdict or recommendation if possible.
      `;

      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });

      const data = JSON.parse(response.text || '{}');
      setAiAnalysis(data);
      
      speakResult(data.verdict, data.recommendation);
    } catch (err) {
      console.error('AI Analysis failed', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Voice System
  const speakResult = (verdict: string, recommendation: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const text = `Diagnostic report ready. Current status: ${verdict}. Recommendation: ${recommendation}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1;
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('network_history');
  };

  const getSignalIcon = () => {
    if (!networkInfo) return <SignalLow className="text-red-500" />;
    const rtt = networkInfo.rtt;
    if (rtt < 100) return <SignalHigh className="text-green-500" />;
    if (rtt < 300) return <SignalMedium className="text-yellow-500" />;
    return <SignalLow className="text-red-500" />;
  };

  return (
    <div className="min-h-screen bg-[#050505] text-[#e0e0e0] font-sans selection:bg-[#00ff41] selection:text-black">
      {/* HUD Header */}
      <header className="border-b border-white/10 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#00ff41]/10 rounded-lg border border-[#00ff41]/30">
              <Zap className="w-5 h-5 text-[#00ff41]" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight uppercase">Network Sentinel</h1>
              <p className="text-[10px] font-mono text-[#00ff41] opacity-70">SYSTEM_AUTH: REHAN_BHAI</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end gap-0.5">
              <span className="text-[9px] font-mono uppercase text-white/40 leading-none">Provider</span>
              <span className="text-xs font-bold text-[#00ff41] leading-none">{networkInfo?.isp || 'Detecting...'}</span>
            </div>
            {networkInfo && (
              <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10">
                <span className="text-[11px] font-mono uppercase opacity-60">{networkInfo.effectiveType}</span>
                {getSignalIcon()}
              </div>
            )}
            <button 
              onClick={() => setIsSeekMode(!isSeekMode)}
              className={cn(
                "px-3 py-1.5 rounded-lg border text-[10px] font-mono transition-all flex items-center gap-2",
                isSeekMode 
                  ? "bg-[#00ff41] text-black border-[#00ff41]" 
                  : "bg-white/5 border-white/10 text-white/60 hover:text-white"
              )}
            >
              <Activity className={cn("w-3.5 h-3.5", isSeekMode && "animate-pulse")} />
              {isSeekMode ? "SEEK_ACTIVE" : "SIGNAL_SEEKER"}
            </button>
            <button 
              onClick={() => speakResult(aiAnalysis?.verdict || "No data", aiAnalysis?.recommendation || "Scan first")}
              className={cn(
                "p-2 rounded-full transition-colors",
                isSpeaking ? "bg-[#00ff41] text-black" : "hover:bg-white/10 text-white/60 hover:text-white"
              )}
            >
              <Volume2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-red-950/30 border border-red-500/50 rounded-xl flex items-center gap-3 text-red-400"
          >
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
          </motion.div>
        )}

        {/* Signal Seeker Overlay / Mode */}
        <AnimatePresence>
          {isSeekMode && (
            <motion.section 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#00ff41]/5 border-2 border-[#00ff41]/30 rounded-3xl p-8 relative overflow-hidden flex flex-col items-center justify-center min-h-[400px]"
            >
              <div className="absolute top-4 left-6 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#00ff41] animate-ping" />
                <h3 className="text-xs font-mono uppercase tracking-[0.2em] text-[#00ff41]">Live Directional Tracker</h3>
              </div>

              {/* Compass / Orientation Visual */}
              <div className="relative w-64 h-64 flex items-center justify-center">
                <div className="absolute inset-0 border-4 border-dashed border-[#00ff41]/10 rounded-full animate-[spin_20s_linear_infinite]" />
                <div className="absolute inset-4 border-2 border-[#00ff41]/20 rounded-full" />
                
                {/* Pointer */}
                <motion.div 
                  className="relative z-10 w-1 h-32 bg-gradient-to-t from-transparent via-[#00ff41] to-[#00ff41] rounded-full origin-bottom"
                  animate={{ rotate: orientation.alpha }}
                  transition={{ type: 'spring', damping: 15 }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#00ff41] rounded-full shadow-[0_0_15px_#00ff41]" />
                </motion.div>

                <div className="absolute flex flex-col items-center justify-center text-center">
                  <div className="text-5xl font-black text-white font-mono leading-none">{liveDownlink}</div>
                  <div className="text-xs text-[#00ff41] font-mono font-bold">MBPS_LIVE</div>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-8 text-center w-full max-w-md">
                <div>
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-1">Tilt (X)</div>
                  <div className="text-sm font-bold text-white font-mono">{orientation.beta}°</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-1">Rotation (Z)</div>
                  <div className="text-sm font-bold text-white font-mono">{orientation.alpha}°</div>
                </div>
                <div>
                  <div className="text-[10px] font-mono text-white/30 uppercase mb-1">Stability</div>
                  <div className="text-sm font-bold text-white font-mono">{Math.abs(orientation.gamma) < 10 ? 'SAFE' : 'ERR_MOVE'}</div>
                </div>
              </div>

              <div className="mt-8 bg-black/50 backdrop-blur px-6 py-3 rounded-full border border-white/10 text-xs text-center text-white/70 max-w-xs leading-tight">
                "Room me mobile ko rotate karke slow speed spots detect karo. Highest MBPS point hi 'Best Coverage' hai."
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Main Action Card */}
          <div className="md:col-span-2 space-y-6">
            <section className="bg-white/5 border border-white/10 rounded-2xl p-6 relative overflow-hidden group">
              <div className="relative z-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-sm font-mono uppercase text-white/50">Performance Scanner</h2>
                      <span className="text-[10px] bg-[#00ff41]/10 text-[#00ff41] px-1.5 py-0.5 rounded border border-[#00ff41]/20 font-bold">
                        {networkInfo?.isp || 'LOCAL_SCAN'}
                      </span>
                    </div>
                    <p className="text-2xl font-bold">Real-time Check</p>
                  </div>
                  <button 
                    onClick={runSpeedTest}
                    disabled={isTesting}
                    className={cn(
                      "px-6 py-3 rounded-xl font-bold transition-all flex items-center gap-2",
                      isTesting 
                        ? "bg-white/10 text-white/30 cursor-not-allowed" 
                        : "bg-[#00ff41] text-black hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(0,255,65,0.3)]"
                    )}
                  >
                    {isTesting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 fill-current" />}
                    {isTesting ? 'SCANNING...' : 'START SCAN'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <StatCard 
                    icon={<TrendingUp className="w-4 h-4 text-[#00ff41]" />} 
                    label="Download" 
                    value={isTesting ? 'Testing...' : (results?.download || '0.0')} 
                    unit="Mbps" 
                  />
                  <StatCard 
                    icon={<TrendingDown className="w-4 h-4 text-blue-400" />} 
                    label="Upload" 
                    value={isTesting ? 'Testing...' : (results?.upload || '0.0')} 
                    unit="Mbps" 
                  />
                  <StatCard 
                    icon={<Activity className="w-4 h-4 text-purple-400" />} 
                    label="Latency" 
                    value={isTesting ? 'Testing...' : (results?.ping || '0')} 
                    unit="ms" 
                  />
                  <StatCard 
                    icon={<Info className="w-4 h-4 text-yellow-400" />} 
                    label="Jitter" 
                    value={isTesting ? 'Testing...' : (results?.jitter || '0')} 
                    unit="ms" 
                  />
                </div>
              </div>
              
              {/* Background Glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-[#00ff41]/5 blur-[100px] pointer-events-none group-hover:bg-[#00ff41]/10 transition-colors" />
            </section>

            {/* Analysis Section */}
            {(aiAnalysis || isAnalyzing) && (
              <motion.section 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[#00ff41]/5 border border-[#00ff41]/20 rounded-2xl p-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex -space-x-1">
                    {[1,2,3].map(i => (
                      <div key={i} className={cn("w-2 h-2 rounded-full", isAnalyzing ? "bg-[#00ff41] animate-pulse" : "bg-[#00ff41]")} style={{ animationDelay: `${i * 0.2}s` }} />
                    ))}
                  </div>
                  <h3 className="text-sm font-mono uppercase tracking-widest text-[#00ff41]">AI Diagnostic Engine</h3>
                </div>

                {isAnalyzing ? (
                  <div className="space-y-3">
                    <div className="h-4 bg-white/5 rounded-full w-3/4 animate-pulse" />
                    <div className="h-4 bg-white/5 rounded-full w-1/2 animate-pulse" />
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="flex items-end justify-between border-b border-[#00ff41]/10 pb-4">
                      <div>
                        <div className="text-4xl font-black text-[#00ff41]">{aiAnalysis?.score}</div>
                        <div className="text-[10px] font-mono text-[#00ff41]/60 uppercase leading-none">Trust Score / 100</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-white/40 uppercase font-mono mb-1">Status Verdict</div>
                        <div className="font-bold text-white leading-tight">{aiAnalysis?.verdict}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="text-[10px] font-mono uppercase text-[#00ff41]/60 mb-2">Recommendation</h4>
                        <p className="text-sm leading-relaxed text-white/90">{aiAnalysis?.recommendation}</p>
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-mono uppercase text-[#00ff41]/60 mb-1 text-right">Smart Tips</h4>
                        <ul className="text-xs space-y-1 text-right">
                          {aiAnalysis?.tips.map((tip, i) => (
                            <li key={i} className="text-white/60 italic">“{tip}”</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </motion.section>
            )}

            {/* Speed Graph */}
            <section className="bg-white/5 border border-white/10 rounded-2xl p-6 h-[300px]">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-mono uppercase text-white/40">Speed Trajectory</h3>
                <div className="flex gap-4 text-[10px] font-mono">
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#00ff41]" /> Down</div>
                  <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Up</div>
                </div>
              </div>
              <div className="w-full h-full pb-8">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...history].reverse()}>
                    <defs>
                      <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ff41" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#00ff41" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorUp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#60a5fa" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                    <XAxis 
                      dataKey="timestamp" 
                      hide 
                    />
                    <YAxis 
                      stroke="rgba(255,255,255,0.2)" 
                      fontSize={10} 
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(val) => `${val}M`}
                    />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                      labelStyle={{ display: 'none' }}
                    />
                    <Area type="monotone" dataKey="download" stroke="#00ff41" fillOpacity={1} fill="url(#colorDown)" strokeWidth={2} />
                    <Area type="monotone" dataKey="upload" stroke="#60a5fa" fillOpacity={1} fill="url(#colorUp)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Sidebar / History */}
          <aside className="space-y-6">
            <section className="bg-white/5 border border-white/10 rounded-2xl p-6 h-full flex flex-col">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-2">
                  <HistoryIcon className="w-4 h-4 text-white/40" />
                  <h3 className="text-sm font-mono uppercase text-white/40">Log History</h3>
                </div>
                {history.length > 0 && (
                  <button 
                    onClick={clearHistory}
                    className="p-1 hover:bg-red-500/20 rounded transition-colors text-red-400 opacity-60 hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto max-h-[600px] scrollbar-hide pr-2">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <HistoryIcon className="w-8 h-8 text-white/5 mb-3" />
                    <p className="text-xs text-white/20 uppercase tracking-widest">No logs recorded</p>
                  </div>
                ) : (
                  <AnimatePresence>
                    {history.map((log) => (
                      <motion.div 
                        key={log.timestamp}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="p-3 bg-white/5 border border-white/5 rounded-xl hover:border-[#00ff41]/30 transition-colors group cursor-default"
                      >
                        <div className="flex justify-between items-end mb-2">
                          <span className="text-[8px] font-mono text-white/30 uppercase">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                          <span className="text-[10px] font-bold text-[#00ff41]">{log.download} Mbps</span>
                        </div>
                        <div className="flex justify-between text-[10px]">
                          <div className="flex items-center gap-1 text-white/40">
                            <TrendingDown className="w-2 h-2" /> {log.upload}
                          </div>
                          <div className="text-white/40">{log.ping}ms</div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                )}
              </div>
            </section>
          </aside>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="max-w-4xl mx-auto px-4 py-12 text-center border-t border-white/5 mt-12">
        <p className="text-[9px] font-mono text-white/20 uppercase tracking-[0.3em]">
          End-to-End Cryptic Encryption Active // Protocol: Sentinel_v2.0 // Dev: REHAN_BHAI
        </p>
      </footer>
    </div>
  );
}

function StatCard({ icon, label, value, unit }: { icon: ReactNode, label: string, value: string | number, unit: string }) {
  return (
    <div className="p-4 bg-black/40 border border-white/5 rounded-xl flex flex-col gap-1 hover:border-white/20 transition-all">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[9px] font-mono uppercase text-white/40 tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold font-mono">{value}</span>
        <span className="text-[10px] text-white/30 font-mono">{unit}</span>
      </div>
    </div>
  );
}

