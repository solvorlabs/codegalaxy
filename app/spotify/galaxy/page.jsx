"use client"
import { useSession, signOut } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState, useCallback, useMemo, Suspense } from "react"
import dynamic from "next/dynamic"
import InfoButton from "@/components/InfoButton"
import {
  buildPlaylistPositions,
  buildPlaylistTimeline,
  computePlaylistInsights,
  playlistDominantMood,
} from "@/lib/playlistGraphBuilder"

const GalaxyCanvas = dynamic(() => import("@/components/GalaxyCanvas"), { ssr: false })

const TIME_RANGE_LABELS = {
  short_term:  "Last Month",
  medium_term: "6 Months",
  long_term:   "All Time",
}

const GENRE_COLORS = [
  "#1DB954","#1ed760","#17a349","#52b788","#74c69d",
  "#a7c957","#6a994e","#386641","#95d5b2","#b7e4c7",
]

const PLAYLIST_ARM_COLORS = [
  "#a855f7","#ec4899","#f59e0b","#10b981","#3b82f6",
  "#ef4444","#8b5cf6","#06b6d4","#84cc16","#f97316",
  "#6366f1","#14b8a6",
]

// ── Mood helpers ─────────────────────────────────────────────────────────────

function getMoodLabel(e, v) {
  const dist = Math.sqrt((e - 0.5) ** 2 + (v - 0.5) ** 2)
  if (dist < 0.18) return "⚖️ Balanced"
  if (e > 0.6 && v > 0.6) return dist > 0.5 ? "🔥 Euphoric" : "😄 Upbeat"
  if (e < 0.4 && v > 0.6) return dist > 0.45 ? "🌸 Peaceful" : "😌 Serene"
  if (e < 0.4 && v < 0.4) return dist > 0.45 ? "💀 Dark" : "🌧 Melancholic"
  if (e > 0.6 && v < 0.4) return dist > 0.5 ? "😤 Intense" : "⚡ Tense"
  if (v > 0.65) return "😊 Happy"
  if (v < 0.35) return "😔 Sad"
  if (e > 0.65) return "💪 Energetic"
  return "🎵 Flowing"
}

function kMeans4(pts) {
  if (pts.length < 4) {
    return [{ x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }]
  }
  let c = [{ x: 0.25, y: 0.75 }, { x: 0.75, y: 0.75 }, { x: 0.25, y: 0.25 }, { x: 0.75, y: 0.25 }]
  for (let iter = 0; iter < 20; iter++) {
    const b = [[], [], [], []]
    pts.forEach(p => {
      let best = 0, bd = Infinity
      c.forEach((ci, k) => {
        const d = (p.x - ci.x) ** 2 + (p.y - ci.y) ** 2
        if (d < bd) { bd = d; best = k }
      })
      b[best].push(p)
    })
    c = c.map((ci, k) =>
      b[k].length
        ? { x: b[k].reduce((s, p) => s + p.x, 0) / b[k].length, y: b[k].reduce((s, p) => s + p.y, 0) / b[k].length }
        : ci
    )
  }
  return c
}

// ── Audio display helpers ─────────────────────────────────────────────────────

function audioDesc(key, value) {
  if (key === "energy") {
    if (value < 0.3) return "Deeply mellow"
    if (value < 0.5) return "Laid-back"
    if (value < 0.7) return "Balanced"
    if (value < 0.85) return "High energy"
    return "Intense"
  }
  if (key === "danceability") {
    if (value < 0.4) return "Minimal groove"
    if (value < 0.6) return "Moderate groove"
    return "Very danceable"
  }
  if (key === "valence") {
    if (value < 0.3) return "Dark & introspective"
    if (value < 0.5) return "Melancholic"
    if (value < 0.7) return "Upbeat"
    return "Feel-good"
  }
  if (key === "tempo") {
    if (value < 0.3) return "Slow"
    if (value < 0.5) return "Mid-tempo"
    if (value < 0.7) return "Upbeat"
    return "Fast-paced"
  }
  if (key === "acousticness") {
    if (value < 0.3) return "Electronic"
    if (value < 0.6) return "Mixed"
    return "Acoustic"
  }
  return ""
}

function AudioBar({ label, value, color, barKey }) {
  const desc = audioDesc(barKey, value)
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-gray-500 text-xs">{label}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs" style={{ color, opacity: 0.8 }}>{desc}</span>
          <span className="text-xs tabular-nums" style={{ color }}>{Math.round(value * 100)}%</span>
        </div>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-700"
             style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
    </div>
  )
}

function ScoreBadge({ label, value, color, desc }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="text-base font-bold tabular-nums" style={{ color }}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xs" style={{ color, opacity: 0.65, fontSize: "0.6rem" }}>{desc}</div>
    </div>
  )
}

// ── Mood Journey Panel ────────────────────────────────────────────────────────

function MoodJourneyPanel({ nodes, moodPos, setMoodPos, onClose, galaxyRef }) {
  const padRef = useRef(null)
  const [trail, setTrail] = useState([])
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoNarration, setAutoNarration] = useState(null)
  const autoRunRef = useRef(null)
  const narrationTimerRef = useRef(null)

  const PAD = 180

  const updateFromEvent = useCallback((e) => {
    const rect = padRef.current?.getBoundingClientRect()
    if (!rect) return
    const energy  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const valence = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    setMoodPos({ x: energy, y: valence })
    setTrail(prev => [...prev.slice(-7), { x: energy, y: valence }])
  }, [setMoodPos])

  const handlePointerDown = useCallback((e) => {
    e.preventDefault()
    padRef.current?.setPointerCapture(e.pointerId)
    updateFromEvent(e)
  }, [updateFromEvent])

  const handlePointerMove = useCallback((e) => {
    if (!e.buttons) return
    updateFromEvent(e)
  }, [updateFromEvent])

  useEffect(() => {
    galaxyRef?.current?.setMoodTarget?.(moodPos.x, moodPos.y)
  }, [moodPos.x, moodPos.y, galaxyRef])

  const matchingArtists = useMemo(() => {
    if (!nodes) return []
    return nodes
      .filter(n => n.tier === 1 && n.type === "artist")
      .map(n => ({
        ...n,
        dist: Math.sqrt((n.energy - moodPos.x) ** 2 + ((n.valence ?? 0.5) - moodPos.y) ** 2),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)
  }, [nodes, moodPos.x, moodPos.y])

  const stopAuto = useCallback(() => {
    if (autoRunRef.current) clearInterval(autoRunRef.current)
    if (narrationTimerRef.current) clearTimeout(narrationTimerRef.current)
    setAutoRunning(false)
    setAutoNarration(null)
  }, [])

  const startAuto = useCallback(() => {
    if (autoRunning) { stopAuto(); return }
    const tier1 = (nodes || []).filter(n => n.tier === 1 && n.type === "artist")
    const pts = tier1.map(n => ({ x: n.energy ?? 0.5, y: n.valence ?? 0.5 }))
    const clusters = kMeans4(pts)
    const NARRATIONS = [
      "Exploring your calm, happy soundspace…",
      "Diving into high-energy euphoria…",
      "Drifting through your darker moods…",
      "Riding the intense tension zone…",
    ]
    let step = 0
    setAutoRunning(true)
    const jump = () => {
      const c = clusters[step % clusters.length]
      setMoodPos({ x: c.x, y: c.y })
      setTrail(prev => [...prev.slice(-7), { x: c.x, y: c.y }])
      setAutoNarration(NARRATIONS[step % NARRATIONS.length])
      if (narrationTimerRef.current) clearTimeout(narrationTimerRef.current)
      narrationTimerRef.current = setTimeout(() => setAutoNarration(null), 2800)
      step++
    }
    jump()
    autoRunRef.current = setInterval(jump, 3200)
  }, [autoRunning, nodes, setMoodPos, stopAuto])

  useEffect(() => () => stopAuto(), [stopAuto])

  const PRESETS = [
    { label: "😌 Calm",  e: 0.2, v: 0.7 },
    { label: "🎉 Party", e: 0.85, v: 0.85 },
    { label: "😢 Sad",   e: 0.25, v: 0.15 },
    { label: "🤬 Rage",  e: 0.9, v: 0.2 },
  ]

  const currentLabel = getMoodLabel(moodPos.x, moodPos.y)
  const matchCount = useMemo(() => {
    if (!nodes) return 0
    return nodes.filter(n =>
      n.tier === 1 && n.type === "artist" &&
      Math.sqrt((n.energy - moodPos.x) ** 2 + ((n.valence ?? 0.5) - moodPos.y) ** 2) < 0.3
    ).length
  }, [nodes, moodPos.x, moodPos.y])

  const handleMoodShare = useCallback(async () => {
    if (!galaxyRef?.current) return
    const dataUrl = galaxyRef.current.captureScreenshot?.()
    if (!dataUrl) return
    const a = document.createElement("a")
    a.href = dataUrl
    a.download = `mood-galaxy-${currentLabel.replace(/[^a-z0-9]/gi, "_")}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }, [galaxyRef, currentLabel])

  return (
    <div className="rounded-xl overflow-hidden w-64 pointer-events-auto"
         style={{ background: "rgba(2,8,20,0.96)", border: "1px solid rgba(168,85,247,0.45)", backdropFilter: "blur(14px)" }}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div>
          <div className="text-xs font-bold text-white">🎭 Mood Journey</div>
          <div className="text-xs text-gray-600" style={{ fontSize: "0.6rem" }}>Drag the pad to filter your galaxy</div>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">✕</button>
      </div>
      <div className="px-3 pt-2 pb-1 text-center">
        <div className="text-sm font-bold transition-all duration-500" style={{ color: "#c084fc" }}>{currentLabel}</div>
        <div className="text-xs text-gray-600">{matchCount} artists nearby</div>
      </div>
      <div className="px-3 pb-2">
        <div className="flex justify-between text-xs text-gray-700 mb-1 px-1"><span>← Calm</span><span>Energy →</span></div>
        <div className="relative" ref={padRef}
             style={{ width: PAD, height: PAD, cursor: "crosshair", userSelect: "none", touchAction: "none" }}
             onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}>
          <div className="absolute inset-0 rounded-lg"
               style={{ background: "radial-gradient(ellipse at 80% 20%, rgba(250,204,21,0.12) 0%, transparent 55%), radial-gradient(ellipse at 20% 20%, rgba(96,165,250,0.08) 0%, transparent 55%), radial-gradient(ellipse at 20% 80%, rgba(99,102,241,0.1) 0%, transparent 55%), radial-gradient(ellipse at 80% 80%, rgba(239,68,68,0.08) 0%, transparent 55%), rgba(255,255,255,0.03)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8 }} />
          <div className="absolute inset-0 rounded-lg" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)", backgroundSize: "50% 50%", borderRadius: 8 }} />
          <div className="absolute text-gray-700 pointer-events-none" style={{ top: 4, left: 6, fontSize: "0.55rem" }}>SERENE</div>
          <div className="absolute text-gray-700 pointer-events-none" style={{ top: 4, right: 6, fontSize: "0.55rem" }}>EUPHORIC</div>
          <div className="absolute text-gray-700 pointer-events-none" style={{ bottom: 4, left: 6, fontSize: "0.55rem" }}>DARK</div>
          <div className="absolute text-gray-700 pointer-events-none" style={{ bottom: 4, right: 6, fontSize: "0.55rem" }}>RAGE</div>
          {trail.map((t, i) => (
            <div key={i} className="absolute rounded-full pointer-events-none"
                 style={{ width: 6, height: 6, left: t.x * PAD - 3, top: (1 - t.y) * PAD - 3, background: "#a855f7", opacity: (i + 1) / trail.length * 0.45, transform: "translate(-50%,-50%)" }} />
          ))}
          <div className="absolute pointer-events-none"
               style={{ width: 14, height: 14, left: moodPos.x * PAD, top: (1 - moodPos.y) * PAD, transform: "translate(-50%, -50%)", background: "#ffffff", borderRadius: "50%", boxShadow: "0 0 10px #a855f7, 0 0 20px rgba(168,85,247,0.4)", border: "2px solid rgba(168,85,247,0.8)" }} />
        </div>
        <div className="flex justify-between text-xs text-gray-700 mt-1 px-1"><span>↑ Happy</span><span>Dark ↓</span></div>
      </div>
      <div className="px-3 pb-2 flex flex-col gap-2">
        <div>
          <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">Energy</span><span style={{ color: "#facc15" }}>{Math.round(moodPos.x * 100)}%</span></div>
          <input type="range" min="0" max="100" value={Math.round(moodPos.x * 100)} className="w-full h-1 rounded-full cursor-pointer" style={{ accentColor: "#facc15" }}
                 onChange={e => { const v = e.target.value / 100; setMoodPos(p => ({ ...p, x: v })); setTrail(prev => [...prev.slice(-7), { x: v, y: moodPos.y }]) }} />
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1"><span className="text-gray-600">Valence</span><span style={{ color: "#f472b6" }}>{Math.round(moodPos.y * 100)}%</span></div>
          <input type="range" min="0" max="100" value={Math.round(moodPos.y * 100)} className="w-full h-1 rounded-full cursor-pointer" style={{ accentColor: "#f472b6" }}
                 onChange={e => { const v = e.target.value / 100; setMoodPos(p => ({ ...p, y: v })); setTrail(prev => [...prev.slice(-7), { x: moodPos.x, y: v }]) }} />
        </div>
      </div>
      <div className="px-3 pb-2">
        <div className="text-xs text-gray-700 mb-1.5 uppercase tracking-wider">Presets</div>
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map(p => (
            <button key={p.label} onClick={() => { setMoodPos({ x: p.e, y: p.v }); setTrail(prev => [...prev.slice(-7), { x: p.e, y: p.v }]) }}
              className="text-xs py-1.5 rounded-lg transition-all hover:bg-white/10 truncate"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#9ca3af", fontSize: "0.6rem" }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {matchingArtists.length > 0 && (
        <div className="px-3 pb-2 border-t border-white/[0.05] pt-2">
          <div className="text-xs text-gray-700 mb-1.5 uppercase tracking-wider">Best Matches</div>
          <div className="flex flex-col gap-1">
            {matchingArtists.map((a, i) => (
              <div key={a.id} className="flex items-center gap-2">
                {a.imageUrl ? <img src={a.imageUrl} alt="" className="w-5 h-5 rounded-full object-cover flex-shrink-0" /> : <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: a.color || "#333" }} />}
                <span className="text-xs text-gray-300 truncate flex-1">{a.label}</span>
                <span className="text-xs" style={{ color: i === 0 ? "#c084fc" : "#4b5563", fontSize: "0.6rem" }}>{Math.round((1 - a.dist / 0.7) * 100)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="px-3 pb-3 flex gap-2 border-t border-white/[0.05] pt-2">
        <button onClick={startAuto}
                className="flex-1 text-xs py-1.5 rounded-lg transition-all font-medium"
                style={{ background: autoRunning ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.05)", border: `1px solid rgba(168,85,247,${autoRunning ? "0.6" : "0.3"})`, color: autoRunning ? "#c084fc" : "#a855f7" }}>
          {autoRunning ? "⏹ Stop" : "▶ Auto"}
        </button>
        <button onClick={handleMoodShare} className="flex-1 text-xs py-1.5 rounded-lg transition-all" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", color: "#6b7280" }}>📸 Share</button>
      </div>
      {autoNarration && (
        <div className="px-3 pb-3 text-center">
          <div className="text-xs animate-pulse" style={{ color: "#c084fc" }}>{autoNarration}</div>
        </div>
      )}
    </div>
  )
}

// ── Playlist Time Machine Panel ───────────────────────────────────────────────

function PlaylistTMPanel({ timeline, sessionIdx, setSessionIdx, autoPlay, setAutoPlay, speed, setSpeed, onClose }) {
  const total = timeline.length
  if (!total) return (
    <div className="rounded-xl p-3 w-64 pointer-events-auto"
         style={{ background: "rgba(2,8,20,0.96)", border: "1px solid rgba(29,185,84,0.3)", backdropFilter: "blur(14px)" }}>
      <div className="text-xs text-gray-600 text-center py-2">No timeline data yet.<br />Add tracks to Spotify playlists to build history.</div>
    </div>
  )

  const session = timeline[sessionIdx]
  const totalTracks = timeline.slice(0, sessionIdx + 1).reduce((s, ss) => s + ss.sessionSize, 0)

  // Milestone toasts
  const milestone = totalTracks === 10 ? "🌱 Your galaxy is forming…"
    : totalTracks === 100 ? "🌟 100 tracks! Your taste is taking shape."
    : sessionIdx === total - 1 ? `🌌 Complete! ${totalTracks} tracks across ${[...new Set(timeline.flatMap(s => s.playlistsAffected))].length} playlists`
    : null

  // Density histogram: sample up to 60 bars
  const histBars = useMemo(() => {
    const step = Math.max(1, Math.floor(total / 60))
    const bars = []
    for (let i = 0; i < total; i += step) {
      const count = timeline[i]?.sessionSize || 0
      bars.push({ count, idx: i })
    }
    const maxCount = Math.max(...bars.map(b => b.count), 1)
    return bars.map(b => ({ ...b, pct: b.count / maxCount }))
  }, [timeline, total])

  const SPEED_OPTIONS = [0.5, 1, 2, 4]

  return (
    <div className="rounded-xl overflow-hidden w-64 pointer-events-auto"
         style={{ background: "rgba(2,8,20,0.96)", border: "1px solid rgba(29,185,84,0.4)", backdropFilter: "blur(14px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
        <div>
          <div className="text-xs font-bold text-white">⏳ Playlist History</div>
          <div className="text-xs text-gray-600" style={{ fontSize: "0.6rem" }}>Real track timestamps</div>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">✕</button>
      </div>

      {/* Session card */}
      <div className="px-3 py-2 border-b border-white/[0.06]"
           style={{ background: "rgba(29,185,84,0.04)" }}>
        <div className="text-xs font-semibold" style={{ color: "#1DB954" }}>📅 {session?.date}</div>
        <div className="text-xs text-gray-400 mt-0.5">
          +{session?.sessionSize} {session?.sessionSize === 1 ? "track" : "tracks"}{session?.playlistsAffected?.length ? ` · "${session.playlistsAffected[0]}"` : ""}
        </div>
        {session?.tracks?.[0] && (
          <div className="flex items-center gap-1.5 mt-1.5">
            {session.tracks[0].albumArt && <img src={session.tracks[0].albumArt} alt="" className="w-4 h-4 rounded flex-shrink-0" />}
            <span className="text-xs text-gray-500 truncate">{session.tracks[0].name}</span>
          </div>
        )}
      </div>

      {/* Milestone */}
      {milestone && (
        <div className="px-3 py-1.5 text-center" style={{ background: "rgba(29,185,84,0.08)" }}>
          <div className="text-xs animate-pulse" style={{ color: "#1DB954" }}>{milestone}</div>
        </div>
      )}

      {/* Progress */}
      <div className="px-3 pt-2 pb-1">
        <div className="flex justify-between text-xs text-gray-600 mb-1">
          <span>Session {sessionIdx + 1} / {total}</span>
          <span>{totalTracks} tracks total</span>
        </div>

        {/* Density histogram */}
        <div className="flex items-end gap-px h-8 mb-2">
          {histBars.map((b, bi) => (
            <div key={bi} className="flex-1 rounded-sm cursor-pointer transition-all"
                 onClick={() => setSessionIdx(b.idx)}
                 style={{
                   height: `${Math.max(10, b.pct * 100)}%`,
                   background: b.idx <= sessionIdx ? "#1DB954" : "rgba(255,255,255,0.1)",
                   opacity: b.idx <= sessionIdx ? 1 : 0.5,
                 }} />
          ))}
        </div>

        {/* Scrubber */}
        <input type="range" min="0" max={total - 1} value={sessionIdx}
               className="w-full h-1 rounded-full cursor-pointer" style={{ accentColor: "#1DB954" }}
               onChange={e => setSessionIdx(parseInt(e.target.value))} />
        <div className="flex justify-between text-xs text-gray-700 mt-0.5">
          <span>{timeline[0]?.date?.slice(0, 4)}</span>
          <span>{timeline[total - 1]?.date?.slice(0, 4)}</span>
        </div>
      </div>

      {/* Controls */}
      <div className="px-3 pb-2 flex items-center gap-2">
        <button onClick={() => setSessionIdx(Math.max(0, sessionIdx - 1))}
                className="text-gray-500 hover:text-white text-sm transition-colors">◀</button>
        <button onClick={() => setAutoPlay(v => !v)}
                className="flex-1 text-xs py-1 rounded-lg transition-all"
                style={{ background: autoPlay ? "rgba(29,185,84,0.2)" : "rgba(255,255,255,0.05)", border: `1px solid rgba(29,185,84,${autoPlay ? "0.6" : "0.2"})`, color: autoPlay ? "#1DB954" : "#4b5563" }}>
          {autoPlay ? "⏹ Pause" : "▶ Play"}
        </button>
        <button onClick={() => setSessionIdx(Math.min(total - 1, sessionIdx + 1))}
                className="text-gray-500 hover:text-white text-sm transition-colors">▶</button>
      </div>

      {/* Speed selector */}
      <div className="px-3 pb-3 flex items-center gap-1.5">
        <span className="text-xs text-gray-700">Speed:</span>
        {SPEED_OPTIONS.map(s => (
          <button key={s} onClick={() => setSpeed(s)}
                  className="text-xs px-2 py-0.5 rounded transition-all"
                  style={{ background: speed === s ? "rgba(29,185,84,0.2)" : "rgba(255,255,255,0.04)", border: `1px solid rgba(29,185,84,${speed === s ? "0.5" : "0.1"})`, color: speed === s ? "#1DB954" : "#4b5563" }}>
            {s}x
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Modals ────────────────────────────────────────────────────────────────────

function RecordingModal({ onClose, onStart }) {
  const [duration, setDuration] = useState(8)
  const [quality, setQuality] = useState("720p")
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="rounded-2xl p-6 max-w-sm w-full mx-4"
           style={{ background: "rgba(5,10,25,0.98)", border: "1px solid rgba(40,80,200,0.4)", boxShadow: "0 0 40px rgba(20,60,180,0.3)" }}
           onClick={e => e.stopPropagation()}>
        <div className="text-white font-bold text-lg mb-1">🎬 Export Your Galaxy Video</div>
        <div className="text-gray-500 text-xs mb-5">Perfect for Instagram Reels and TikTok</div>
        <div className="mb-4">
          <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">Duration</div>
          <div className="flex gap-2">
            {[5, 8, 12].map(d => (
              <button key={d} onClick={() => setDuration(d)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{ background: duration === d ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)", border: `1px solid ${duration === d ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.08)"}`, color: duration === d ? "#a5b4fc" : "#6b7280" }}>
                {d}s
              </button>
            ))}
          </div>
        </div>
        <div className="mb-5">
          <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">Quality</div>
          <div className="flex gap-2">
            {["720p", "1080p"].map(q => (
              <button key={q} onClick={() => setQuality(q)}
                      className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                      style={{ background: quality === q ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)", border: `1px solid ${quality === q ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.08)"}`, color: quality === q ? "#a5b4fc" : "#6b7280" }}>
                {q}
              </button>
            ))}
          </div>
        </div>
        <p className="text-gray-600 text-xs mb-5">ℹ️ Video will be a rotating view of your galaxy.</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg text-sm text-gray-500 hover:text-gray-300 transition-colors" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>Cancel</button>
          <button onClick={() => onStart(duration, quality)} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all" style={{ background: "rgba(99,102,241,0.7)", border: "1px solid rgba(99,102,241,0.5)" }}>🎬 Start Recording</button>
        </div>
      </div>
    </div>
  )
}

function ShareModal({ meta, timeRange, onClose, onExportVideo, galaxyRef, playlistData, showPlaylistMode }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/spotify/galaxy/${meta?.userId || ""}` : ""
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }
  const handleScreenshot = useCallback(async () => {
    if (!galaxyRef?.current) return
    const dataUrl = galaxyRef.current.captureScreenshot?.()
    if (!dataUrl) return
    const a = document.createElement("a")
    const fname = showPlaylistMode
      ? `my-playlist-galaxy-${meta?.userName || "galaxy"}.png`
      : `music-galaxy-${meta?.userName || "galaxy"}.png`
    a.href = dataUrl; a.download = fname
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }, [galaxyRef, meta, showPlaylistMode])

  const firstYear = playlistData?.playlists?.length
    ? Math.min(...playlistData.playlists.flatMap(pl => (pl.tracks || []).map(t => t.added_at ? new Date(t.added_at).getFullYear() : 9999)).filter(y => y < 9999))
    : null

  const largestPlaylist = playlistData?.playlists?.length
    ? [...playlistData.playlists].sort((a, b) => b.trackCount - a.trackCount)[0]?.name
    : null

  const totalPlaylistTracks = playlistData?.playlists?.reduce((s, pl) => s + (pl.tracks?.length || 0), 0) || 0

  const twitterText = encodeURIComponent(
    showPlaylistMode && playlistData?.playlists?.length
      ? `${meta?.userName}'s Music Galaxy 🌌\n${playlistData.playlists.length} playlists · ${totalPlaylistTracks} tracks${firstYear ? ` · since ${firstYear}` : ""}${largestPlaylist ? `\nTop playlist: '${largestPlaylist}'` : ""}\n${shareUrl} #MusicGalaxy`
      : `Just generated my Music Galaxy 🌌\nMy top artist is ${meta?.topArtist?.name || "incredible"} and my sound is ${(meta?.avgEnergy || 0) > 0.7 ? "high energy" : "chill"} and ${(meta?.avgValence || 0) > 0.6 ? "upbeat" : "moody"}.\nCheck yours: ${shareUrl} #MusicGalaxy`
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="rounded-2xl p-6 max-w-sm w-full mx-4"
           style={{ background: "rgba(5,10,25,0.98)", border: "1px solid rgba(40,80,200,0.4)", boxShadow: "0 0 40px rgba(20,60,180,0.3)" }}
           onClick={e => e.stopPropagation()}>
        <div className="text-white font-bold text-lg mb-1">🌌 Share Your Music Galaxy</div>
        <div className="text-sm text-gray-300 font-semibold mt-3">{meta?.userName}&apos;s Music Galaxy</div>
        <div className="text-xs text-gray-500 mb-4">
          {showPlaylistMode && playlistData?.playlists?.length
            ? `${playlistData.playlists.length} playlists · ${totalPlaylistTracks} tracks${firstYear ? ` · since ${firstYear}` : ""}`
            : `${meta?.totalArtists} artists · ${meta?.topGenres?.length} genres · ${TIME_RANGE_LABELS[timeRange] || timeRange}`
          }
        </div>
        <div className="mb-4">
          <div className="text-gray-500 text-xs mb-1.5">Share link:</div>
          <div className="flex gap-2 items-center">
            <input readOnly value={shareUrl} className="flex-1 bg-white/[0.04] border border-white/10 text-white text-xs px-3 py-2 rounded-lg outline-none truncate" />
            <button onClick={handleCopy} className="text-xs px-3 py-2 rounded-lg transition-colors"
                    style={{ background: copied ? "rgba(29,185,84,0.3)" : "rgba(40,80,200,0.3)", border: "1px solid rgba(40,80,200,0.4)", color: copied ? "#1DB954" : "#93c5fd" }}>
              {copied ? "✓" : "Copy"}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`https://twitter.com/intent/tweet?text=${twitterText}`} target="_blank" rel="noopener noreferrer"
             className="flex-1 py-2.5 rounded-lg text-xs font-semibold text-center text-white transition-all"
             style={{ background: "rgba(29,161,242,0.3)", border: "1px solid rgba(29,161,242,0.4)" }}>
            🐦 Twitter/X
          </a>
          <button onClick={handleScreenshot} className="flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "#d1d5db" }}>
            📸 PNG
          </button>
          <button onClick={() => { onClose(); onExportVideo() }} className="flex-1 py-2.5 rounded-lg text-xs font-semibold transition-all"
                  style={{ background: "rgba(99,102,241,0.25)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc" }}>
            🎬 Video
          </button>
        </div>
        <button onClick={onClose} className="mt-4 w-full text-center text-xs text-gray-600 hover:text-gray-400 transition-colors">Close</button>
      </div>
    </div>
  )
}

// ── Main Galaxy Page ──────────────────────────────────────────────────────────

function SpotifyGalaxyInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const timeRange = searchParams.get("timeRange") || "medium_term"
  const galaxyRef = useRef(null)

  const [graph, setGraph] = useState(null)
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [loadingStep, setLoadingStep] = useState(0)
  const [loadingLabel, setLoadingLabel] = useState("Starting…")
  const [error, setError] = useState(null)

  // View controls
  const [hoveredFolder, setHoveredFolder] = useState(null)
  const [showMinimap, setShowMinimap] = useState(false)
  const [discoverMode, setDiscoverMode] = useState(false)

  // Mood Journey
  const [showMoodJourney, setShowMoodJourney] = useState(false)
  const [moodPos, setMoodPos] = useState({ x: 0.5, y: 0.5 })

  // Playlist Mode (lazy-loaded)
  const [showPlaylistMode, setShowPlaylistMode] = useState(false)
  const [playlistData, setPlaylistData] = useState(null)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const [playlistError, setPlaylistError] = useState(null)
  const [playlistPositions, setPlaylistPositions] = useState(null)
  const [playlistInsights, setPlaylistInsights] = useState(null)

  // Playlist Time Machine
  const [showPlaylistTM, setShowPlaylistTM] = useState(false)
  const [playlistTimeline, setPlaylistTimeline] = useState([])
  const [tmSessionIdx, setTmSessionIdx] = useState(0)
  const [tmAutoPlay, setTmAutoPlay] = useState(false)
  const [tmSpeed, setTmSpeed] = useState(1)
  const tmAutoRef = useRef(null)

  // Panel state
  const [showPersonScore, setShowPersonScore] = useState(false)

  // Recording
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordProgress, setRecordProgress] = useState(0)
  const [recordDuration, setRecordDuration] = useState(8)
  const [recordDone, setRecordDone] = useState(false)
  const recordTimerRef = useRef(null)

  const [showShareModal, setShowShareModal] = useState(false)
  const [windowWidth, setWindowWidth] = useState(1200)

  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth)
    update(); window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])

  // Auth guard
  useEffect(() => {
    if (status === "loading") return
    if (!session) { router.replace("/"); return }
    if (session.provider !== "spotify") { router.replace("/dashboard"); return }
  }, [session, status, router])

  // Activate / deactivate mood
  useEffect(() => {
    galaxyRef.current?.setMoodActive?.(showMoodJourney)
    if (showMoodJourney) galaxyRef.current?.setMoodTarget?.(moodPos.x, moodPos.y)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMoodJourney])

  // Lazy playlist fetch
  const loadPlaylistData = useCallback(async () => {
    if (playlistData || playlistLoading) return
    setPlaylistLoading(true)
    setPlaylistError(null)
    try {
      const res = await fetch("/api/spotify/playlists", { method: "POST" })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPlaylistData(data)
      if (!data.playlists?.length) {
        setShowPlaylistMode(false)  // nothing to show — revert to genre view
        return
      }
      if (graph && data.playlists?.length) {
        const positions = buildPlaylistPositions(graph.nodes, data.playlists)
        setPlaylistPositions(positions)
        const timeline = buildPlaylistTimeline(data.playlists)
        setPlaylistTimeline(timeline)
        const insights = computePlaylistInsights(data.playlists, graph.nodes)
        setPlaylistInsights(insights)
      }
    } catch (err) {
      setPlaylistError(err.message)
    } finally {
      setPlaylistLoading(false)
    }
  }, [playlistData, playlistLoading, graph])

  // Toggle playlist mode
  const handlePlaylistToggle = useCallback(() => {
    if (!playlistData && !playlistLoading) loadPlaylistData()
    setShowPlaylistMode(v => !v)
  }, [playlistData, playlistLoading, loadPlaylistData])

  // Sync playlist positions to canvas
  useEffect(() => {
    galaxyRef.current?.setPlaylistPositions?.(showPlaylistMode && playlistPositions ? playlistPositions : null)
  }, [showPlaylistMode, playlistPositions])

  // TM autoplay
  useEffect(() => {
    if (!tmAutoPlay || !playlistTimeline.length) return
    const delayMs = Math.round(600 / tmSpeed)
    tmAutoRef.current = setInterval(() => {
      setTmSessionIdx(prev => {
        if (prev >= playlistTimeline.length - 1) { setTmAutoPlay(false); return prev }
        return prev + 1
      })
    }, delayMs)
    return () => clearInterval(tmAutoRef.current)
  }, [tmAutoPlay, tmSpeed, playlistTimeline.length])

  // TM visibility
  useEffect(() => {
    if (!showPlaylistTM || !playlistTimeline.length) {
      galaxyRef.current?.setTmVisibleIds?.(null)
      return
    }
    const visibleIds = new Set()
    playlistTimeline.slice(0, tmSessionIdx + 1).forEach(s => s.tracks.forEach(t => visibleIds.add(t.id)))
    galaxyRef.current?.setTmVisibleIds?.(visibleIds)
  }, [showPlaylistTM, tmSessionIdx, playlistTimeline])

  // Main data fetch via polling
  useEffect(() => {
    if (!session?.spotifyAccessToken) return
    let pollInterval = null
    let cancelled = false
    const run = async () => {
      setLoading(true); setError(null)
      setLoadingProgress(0); setLoadingStep(0); setLoadingLabel("Starting…")
      try {
        const startRes = await fetch("/api/spotify/analyze/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeRange }),
        })
        const startData = await startRes.json()
        if (startData.error) throw new Error(startData.error)
        const { jobId } = startData
        pollInterval = setInterval(async () => {
          if (cancelled) { clearInterval(pollInterval); return }
          try {
            const pollRes = await fetch(`/api/spotify/analyze/poll?jobId=${jobId}`)
            const poll = await pollRes.json()
            if (cancelled) return
            if (poll.error && poll.status !== "error") { clearInterval(pollInterval); setError(poll.error); setLoading(false); return }
            setLoadingProgress(poll.progress || 0)
            setLoadingStep(poll.step || 0)
            setLoadingLabel(poll.stepLabel || "Processing…")
            if (poll.status === "done" && poll.result) {
              clearInterval(pollInterval)
              setGraph({ nodes: poll.result.nodes, edges: poll.result.edges })
              setMeta(poll.result.meta)
              setLoading(false)
            } else if (poll.status === "error") {
              clearInterval(pollInterval); setError(poll.error || "Analysis failed"); setLoading(false)
            }
          } catch (pollErr) { console.error("[poll]", pollErr) }
        }, 1500)
      } catch (err) { if (!cancelled) { setError(err.message); setLoading(false) } }
    }
    run()
    return () => { cancelled = true; if (pollInterval) clearInterval(pollInterval) }
  }, [session?.spotifyAccessToken, timeRange])

  // Recording handler
  const handleStartRecording = useCallback((duration, quality) => {
    setShowRecordModal(false)
    if (!galaxyRef.current?.startRecording) return
    setIsRecording(true); setRecordProgress(0); setRecordDuration(duration); setRecordDone(false)
    galaxyRef.current.startRecording(duration, quality)
    const steps = (duration * 1000) / 100
    let step = 0
    recordTimerRef.current = setInterval(() => {
      step++
      setRecordProgress(step / steps)
      if (step >= steps) { clearInterval(recordTimerRef.current); setIsRecording(false); setRecordDone(true); setTimeout(() => setRecordDone(false), 4000) }
    }, 100)
  }, [])

  // Filtered nodes
  const displayNodes = useMemo(() => {
    if (!graph) return []
    return graph.nodes.filter(n => !(n.isDiscover && !discoverMode))
  }, [graph, discoverMode])

  // Compute playlist arm colors & dominant moods
  const playlistArmInfo = useMemo(() => {
    if (!playlistData?.playlists || !graph) return []
    const nodeById = {}
    graph.nodes.forEach(n => { nodeById[n.id] = n })
    return playlistData.playlists.slice(0, 12).map((pl, i) => {
      const trackNodes = (pl.tracks || []).map(t => nodeById[t.id]).filter(Boolean)
      const avgE = trackNodes.length ? trackNodes.reduce((s, n) => s + (n.energy ?? 0.5), 0) / trackNodes.length : 0.5
      const avgV = trackNodes.length ? trackNodes.reduce((s, n) => s + (n.valence ?? 0.5), 0) / trackNodes.length : 0.5
      return {
        id:        pl.id,
        name:      pl.name,
        imageUrl:  pl.imageUrl,
        trackCount: pl.trackCount,
        tracks:    pl.tracks?.length || 0,
        mood:      playlistDominantMood({ energy: avgE, valence: avgV }),
        color:     PLAYLIST_ARM_COLORS[i % PLAYLIST_ARM_COLORS.length],
      }
    })
  }, [playlistData, graph])

  // Mood stats
  const moodMatchCount = useMemo(() => {
    if (!showMoodJourney || !graph) return null
    return graph.nodes.filter(n => n.tier === 1 && n.type === "artist" && Math.sqrt((n.energy - moodPos.x) ** 2 + ((n.valence ?? 0.5) - moodPos.y) ** 2) < 0.3).length
  }, [showMoodJourney, graph, moodPos.x, moodPos.y])

  const moodTopMatch = useMemo(() => {
    if (!showMoodJourney || !graph) return null
    return graph.nodes.filter(n => n.tier === 1 && n.type === "artist")
      .sort((a, b) => Math.sqrt((a.energy - moodPos.x) ** 2 + ((a.valence ?? 0.5) - moodPos.y) ** 2) - Math.sqrt((b.energy - moodPos.x) ** 2 + ((b.valence ?? 0.5) - moodPos.y) ** 2))[0]?.label || null
  }, [showMoodJourney, graph, moodPos.x, moodPos.y])

  // ── Loading / Error ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6 px-6">
        <div className="w-12 h-12 border-2 rounded-full animate-spin" style={{ borderColor: "#1DB954 transparent transparent transparent" }} />
        <div className="text-center" style={{ fontFamily: "var(--font-space-mono), monospace" }}>
          <div className="text-sm font-semibold mb-1" style={{ color: "#1DB954" }}>{loadingLabel}</div>
          <div className="text-xs text-gray-600">Step {loadingStep}/5 · Discovering your music universe</div>
        </div>
        <div className="w-72 flex flex-col gap-1.5">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%`, background: "linear-gradient(90deg, #1DB954, #52b788)" }} />
          </div>
          <div className="flex justify-between text-xs text-gray-700"><span>{loadingProgress}%</span><span>{loadingProgress < 100 ? "Building…" : "Done"}</span></div>
        </div>
        <div className="flex gap-3 text-xs text-gray-700" style={{ fontFamily: "var(--font-space-mono), monospace" }}>
          {["Core data", "Connections", "Related", "Neighbors", "Graph"].map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: loadingStep > i ? "#1DB954" : loadingStep === i ? "#facc15" : "rgba(255,255,255,0.1)" }} />
              <span style={{ color: loadingStep > i ? "#1DB954" : loadingStep === i ? "#facc15" : "rgb(55 65 81)" }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center font-mono">
          <div className="text-red-400 text-sm mb-4">{error}</div>
          <button onClick={() => router.push("/spotify")} className="text-xs text-gray-500 hover:text-white border border-gray-700 px-4 py-2 rounded-lg transition-colors">← Back to dashboard</button>
        </div>
      </div>
    )
  }

  const topGenres = meta?.superGenres || meta?.topGenres || []
  const pscore = meta?.personalizationScore

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* ── Top bar ───────────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 pointer-events-none"
           style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
        <button onClick={() => router.push("/spotify")} className="pointer-events-auto text-xs text-gray-500 hover:text-white transition-colors" style={{ fontFamily: "var(--font-space-mono), monospace" }}>← spotify</button>
        <div className="flex items-center gap-2 pointer-events-none">
          {meta?.userAvatar && <img src={meta.userAvatar} alt="" className="w-6 h-6 rounded-full object-cover" style={{ border: "1.5px solid #1DB954" }} />}
          <span className="text-white text-sm font-semibold" style={{ fontFamily: "var(--font-space-mono), monospace" }}>{meta?.userName}&apos;s Music Galaxy</span>
        </div>
        <div className="text-xs px-2 py-1 rounded-full pointer-events-none" style={{ background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.3)", color: "#1DB954", fontFamily: "var(--font-space-mono), monospace" }}>
          {TIME_RANGE_LABELS[timeRange] || timeRange}
        </div>
      </div>

      {/* ── Galaxy Canvas ──────────────────────────────────────── */}
      {graph && (
        <GalaxyCanvas
          ref={galaxyRef}
          nodes={displayNodes}
          edges={graph.edges}
          hoveredFolder={hoveredFolder}
          pinnedFolders={[]}
          fileTypeFilter={null}
          showMinimap={showMinimap}
          musicMode={true}
          musicMeta={meta}
          playlistPositions={showPlaylistMode && playlistPositions ? playlistPositions : null}
          crossPlaylistLinks={null}
        />
      )}

      {/* ── Right Panel ────────────────────────────────────────── */}
      {graph && (
        <div className="absolute top-14 right-4 z-10 w-52 flex flex-col gap-3 pointer-events-none" style={{ fontFamily: "var(--font-space-mono), monospace" }}>

          {/* When playlist mode: show PLAYLISTS section (or empty state); else GENRES */}
          {showPlaylistMode && playlistData && !playlistData.playlists?.length ? (
            <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(168,85,247,0.3)", backdropFilter: "blur(12px)" }}>
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>PLAYLISTS</div>
              <div className="text-xs text-gray-500 text-center py-3 leading-relaxed">
                No personal playlists found.<br />
                <span style={{ color: "#9ca3af" }}>Create playlists on Spotify<br />to unlock this feature.</span>
              </div>
            </div>
          ) : showPlaylistMode && playlistData?.playlists?.length ? (
            <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(168,85,247,0.3)", backdropFilter: "blur(12px)" }}>
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>PLAYLISTS</div>
              {playlistArmInfo.map((pl) => (
                <div key={pl.id}
                     className="flex items-center gap-2 py-1 cursor-pointer rounded px-1 transition-colors hover:bg-white/5"
                     onMouseEnter={() => setHoveredFolder(pl.name)}
                     onMouseLeave={() => setHoveredFolder(null)}>
                  {pl.imageUrl
                    ? <img src={pl.imageUrl} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" />
                    : <div className="w-5 h-5 rounded flex-shrink-0" style={{ background: pl.color }} />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 truncate">{pl.name.length > 16 ? pl.name.slice(0, 16) + "…" : pl.name}</div>
                    <div className="text-xs" style={{ color: pl.color, fontSize: "0.6rem" }}>{pl.mood} · {pl.tracks}t</div>
                  </div>
                </div>
              ))}
              {playlistLoading && <div className="text-xs text-gray-600 text-center py-1 animate-pulse">Loading playlists…</div>}
              {playlistError && <div className="text-xs text-red-400 py-1">{playlistError}</div>}
            </div>
          ) : (
            <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.3)", backdropFilter: "blur(12px)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className="text-xs uppercase tracking-widest" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>GENRES</span>
                <InfoButton title="Genre Clusters">{`Each spiral arm represents a genre\nfrom your listening history.\n\nArtists are grouped into 8 super-genre\ncategories for a cleaner galaxy layout.`}</InfoButton>
              </div>
              {topGenres.slice(0, 8).map((genre, i) => (
                <div key={genre}
                     className="flex items-center gap-2 py-0.5 cursor-pointer rounded px-1 transition-colors hover:bg-white/5"
                     onMouseEnter={() => setHoveredFolder(genre)}
                     onMouseLeave={() => setHoveredFolder(null)}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: GENRE_COLORS[i % GENRE_COLORS.length] }} />
                  <span className="text-xs text-gray-400 truncate flex-1">{genre}</span>
                  <span className="text-xs text-gray-600">{meta?.genreArtistCounts?.[genre] || 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* Audio Profile */}
          <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.3)", backdropFilter: "blur(12px)" }}>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs uppercase tracking-widest" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>YOUR SOUND</span>
              <InfoButton title="Audio Profile">{`Derived from your top artists' genre\ncharacteristics and listening patterns.\n\nEnergy — intensity and activity\nDanceability — rhythm & beat strength\nHappiness — musical positivity\nTempo — average BPM range\nAcoustic — unplugged vs electronic`}</InfoButton>
            </div>
            <div className="flex flex-col gap-2.5">
              <AudioBar label="Energy"       value={meta?.avgEnergy || 0}       color="#f59e0b" barKey="energy" />
              <AudioBar label="Danceability" value={meta?.avgDanceability || 0} color="#10b981" barKey="danceability" />
              <AudioBar label="Happiness"    value={meta?.avgValence || 0}      color="#f472b6" barKey="valence" />
              <AudioBar label="Tempo"        value={meta?.avgTempo || 0}        color="#a78bfa" barKey="tempo" />
              <AudioBar label="Acoustic"     value={meta?.avgAcousticness || 0} color="#60a5fa" barKey="acousticness" />
            </div>
          </div>

          {/* Galactic Core */}
          {meta?.topArtist && (
            <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(29,185,84,0.3)", backdropFilter: "blur(12px)" }}>
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(148,163,184,0.7)" }}>GALACTIC CORE</div>
              <div className="flex items-center gap-2 mb-2">
                {meta.topArtist.imageUrl && <img src={meta.topArtist.imageUrl} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" style={{ border: "2px solid #1DB954", boxShadow: "0 0 12px rgba(29,185,84,0.4)" }} />}
                <div className="min-w-0">
                  <div className="text-white text-sm font-semibold truncate">{meta.topArtist.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: "#1DB954" }}>Your #1 artist</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(meta.topArtist.genres || []).slice(0, 3).map(g => (
                  <span key={g} className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(29,185,84,0.15)", color: "#1DB954", border: "1px solid rgba(29,185,84,0.25)" }}>{g}</span>
                ))}
              </div>
            </div>
          )}

          {/* Personalization Score */}
          {pscore && (
            <div className="rounded-xl pointer-events-auto overflow-hidden" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.3)", backdropFilter: "blur(12px)" }}>
              <button onClick={() => setShowPersonScore(v => !v)} className="w-full flex items-center justify-between px-3 py-2 transition-colors hover:bg-white/[0.03]">
                <span className="text-xs uppercase tracking-widest" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>PERSONALITY SCORE</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-white">{pscore.overall}</span>
                  <span className="text-gray-600">{showPersonScore ? "▲" : "▼"}</span>
                </div>
              </button>
              {showPersonScore && (
                <div className="px-3 pb-3">
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <ScoreBadge label="Diversity"   value={pscore.diversity}   color="#1DB954" desc="Genre breadth" />
                    <ScoreBadge label="Depth"       value={pscore.depth}       color="#60a5fa" desc="Niche factor" />
                    <ScoreBadge label="Discovery"   value={pscore.discovery}   color="#facc15" desc="New finds" />
                    <ScoreBadge label="Consistency" value={pscore.consistency} color="#a78bfa" desc="Taste stability" />
                  </div>
                  <div className="mt-3 pt-2 border-t border-white/[0.05] text-center">
                    <div className="text-xs text-gray-500 mb-0.5">Overall Score</div>
                    <div className="text-xl font-bold text-white">{pscore.overall}<span className="text-xs text-gray-600">/100</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Playlist Insights (only in playlist mode) */}
          {showPlaylistMode && playlistInsights && (
            <div className="rounded-xl p-3 pointer-events-auto" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(168,85,247,0.3)", backdropFilter: "blur(12px)" }}>
              <div className="text-xs uppercase tracking-widest mb-2" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>📊 INSIGHTS</div>
              <div className="flex flex-col gap-2 text-xs text-gray-400">
                {playlistInsights.mostEclectic && (
                  <div>
                    <span style={{ color: "#c084fc" }}>Most eclectic:</span>{" "}
                    <span className="text-gray-300">"{playlistInsights.mostEclectic.name.slice(0, 18)}"</span>
                    <div className="text-gray-600">{playlistInsights.mostEclectic.genreCount} genres</div>
                  </div>
                )}
                {playlistInsights.mostFocused && (
                  <div>
                    <span style={{ color: "#c084fc" }}>Most focused:</span>{" "}
                    <span className="text-gray-300">"{playlistInsights.mostFocused.name.slice(0, 18)}"</span>
                    <div className="text-gray-600">{playlistInsights.mostFocused.mood}</div>
                  </div>
                )}
                {playlistInsights.oldestPlaylist && (
                  <div>
                    <span style={{ color: "#c084fc" }}>Since:</span>{" "}
                    <span className="text-gray-300">{playlistInsights.oldestPlaylist.date?.slice(0, 7)}</span>
                    <div className="text-gray-600">"{playlistInsights.oldestPlaylist.name.slice(0, 18)}"</div>
                  </div>
                )}
                {playlistInsights.timeOfDay && (
                  <div>
                    <span style={{ color: "#c084fc" }}>Listening habit:</span>
                    <div className="text-gray-300">{playlistInsights.timeOfDay.label}</div>
                    <div className="text-gray-600">{playlistInsights.timeOfDay.pct}% of saves</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Left Panel ─────────────────────────────────────────── */}
      {graph && (
        <div className="absolute top-14 left-4 z-10 flex flex-col gap-2" style={{ fontFamily: "var(--font-space-mono), monospace" }}>
          <button onClick={() => setShowRecordModal(true)} title="Export Video"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                  style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(99,102,241,0.4)", color: "#a5b4fc", minWidth: 36 }}>
            🎬{windowWidth >= 1000 && " Video"}
          </button>
          <button onClick={() => setShowShareModal(true)} title="Share Galaxy"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                  style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(29,185,84,0.4)", color: "#1DB954", minWidth: 36 }}>
            📤{windowWidth >= 1000 && " Share"}
          </button>
          <button onClick={() => setShowMinimap(v => !v)} title="Toggle Minimap"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                  style={{ background: "rgba(2,8,20,0.85)", border: `1px solid rgba(40,80,200,${showMinimap ? "0.7" : "0.3"})`, color: showMinimap ? "#93c5fd" : "#4b5563", minWidth: 36 }}>
            🗺{windowWidth >= 1000 && " Map"}
          </button>
          <button onClick={() => setDiscoverMode(v => !v)} title="Discover Mode"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                  style={{ background: discoverMode ? "rgba(29,185,84,0.15)" : "rgba(2,8,20,0.85)", border: `1px solid rgba(29,185,84,${discoverMode ? "0.6" : "0.2"})`, color: discoverMode ? "#1DB954" : "#4b5563", minWidth: 36 }}>
            🔭{windowWidth >= 1000 && (discoverMode ? " Discover ✓" : " Discover")}
          </button>

          {/* Playlists */}
          <button onClick={handlePlaylistToggle}
                  disabled={!showPlaylistMode && !!(playlistData && !playlistData.playlists?.length)}
                  title={!showPlaylistMode && playlistData && !playlistData.playlists?.length
                    ? "No personal playlists found. Create playlists on Spotify to unlock this feature."
                    : "Playlist Mode"}
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: showPlaylistMode ? "rgba(168,85,247,0.15)" : "rgba(2,8,20,0.85)", border: `1px solid rgba(168,85,247,${showPlaylistMode ? "0.6" : "0.3"})`, color: showPlaylistMode ? "#c084fc" : "#4b5563", minWidth: 36 }}>
            {playlistLoading ? "⟳" : "📋"}{windowWidth >= 1000 && (showPlaylistMode ? " Playlists ✓" : playlistLoading ? " Loading…" : playlistData && !playlistData.playlists?.length ? " No playlists" : " Playlists")}
          </button>

          {/* Mood Journey */}
          <button onClick={() => setShowMoodJourney(v => !v)} title="Mood Journey"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                  style={{ background: showMoodJourney ? "rgba(168,85,247,0.2)" : "rgba(2,8,20,0.85)", border: `1px solid rgba(168,85,247,${showMoodJourney ? "0.6" : "0.3"})`, color: showMoodJourney ? "#c084fc" : "#4b5563", minWidth: 36 }}>
            🎭{windowWidth >= 1000 && " Mood"}
          </button>

          {/* Sign out */}
          <button onClick={() => signOut({ callbackUrl: "/" })} title="Sign out"
                  className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md mt-2"
                  style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280", minWidth: 36 }}>
            ↩{windowWidth >= 1000 && " Sign out"}
          </button>

          {/* Playlist TM button (only when playlists loaded + playlist mode on) */}
          {showPlaylistMode && playlistTimeline.length > 0 && (
            <button onClick={() => { setShowPlaylistTM(v => !v); if (!showPlaylistTM) setTmSessionIdx(0) }} title="Playlist History"
                    className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                    style={{ background: showPlaylistTM ? "rgba(29,185,84,0.2)" : "rgba(2,8,20,0.85)", border: `1px solid rgba(29,185,84,${showPlaylistTM ? "0.6" : "0.3"})`, color: showPlaylistTM ? "#1DB954" : "#4b5563", minWidth: 36 }}>
              ⏳{windowWidth >= 1000 && " History"}
            </button>
          )}

          {/* Inline panels */}
          {showMoodJourney && (
            <MoodJourneyPanel
              nodes={graph.nodes}
              moodPos={moodPos}
              setMoodPos={setMoodPos}
              onClose={() => setShowMoodJourney(false)}
              galaxyRef={galaxyRef}
            />
          )}

          {showPlaylistTM && playlistTimeline.length > 0 && (
            <PlaylistTMPanel
              timeline={playlistTimeline}
              sessionIdx={tmSessionIdx}
              setSessionIdx={setTmSessionIdx}
              autoPlay={tmAutoPlay}
              setAutoPlay={setTmAutoPlay}
              speed={tmSpeed}
              setSpeed={setTmSpeed}
              onClose={() => { setShowPlaylistTM(false); setTmAutoPlay(false); galaxyRef.current?.setTmVisibleIds?.(null) }}
            />
          )}
        </div>
      )}

      {/* ── Recording indicator ──────────────────────────────────── */}
      {isRecording && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-4 py-2 rounded-full font-mono text-xs" style={{ background: "rgba(5,0,0,0.9)", border: "1px solid rgba(220,38,38,0.5)", color: "#f87171" }}>
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          REC {Math.round(recordProgress * recordDuration)}s / {recordDuration}s
          <div className="w-24 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full bg-red-500 transition-all" style={{ width: `${recordProgress * 100}%` }} />
          </div>
        </div>
      )}
      {recordDone && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full font-mono text-xs" style={{ background: "rgba(2,20,10,0.9)", border: "1px solid rgba(29,185,84,0.5)", color: "#1DB954" }}>
          ✅ Video saved! Share it on social media 🚀
        </div>
      )}

      {/* ── Discover mode banner ────────────────────────────────── */}
      {discoverMode && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full font-mono text-xs whitespace-nowrap" style={{ background: "rgba(2,20,10,0.9)", border: "1px solid rgba(29,185,84,0.4)", color: "#1DB954" }}>
          🔭 Discover Mode — dim outer stars are artists you might love
        </div>
      )}

      {/* ── Playlist mode transition banner ──────────────────────── */}
      {showPlaylistMode && playlistLoading && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full font-mono text-xs whitespace-nowrap animate-pulse" style={{ background: "rgba(2,8,20,0.9)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc" }}>
          📋 Loading your playlists…
        </div>
      )}
      {showPlaylistMode && !playlistLoading && playlistPositions && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-full font-mono text-xs whitespace-nowrap pointer-events-none" style={{ background: "rgba(2,8,20,0.9)", border: "1px solid rgba(168,85,247,0.4)", color: "#c084fc", opacity: 0.8 }}>
          📋 Playlist Mode — reorganizing by your playlists
        </div>
      )}

      {/* ── Bottom stats bar ────────────────────────────────────── */}
      {meta && graph && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10" style={{ fontFamily: "var(--font-space-mono), monospace" }}>
          <div className="rounded-xl flex items-stretch backdrop-blur-md overflow-hidden" style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.35)", boxShadow: "0 0 28px rgba(20,60,180,0.2)", height: 64 }}>
            {showMoodJourney ? (
              <>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>MATCHING</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#c084fc" }}>{moodMatchCount ?? 0}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>artists</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>TOP MATCH</div>
                  <div className="text-xs font-bold text-white truncate max-w-[110px]">{moodTopMatch || "—"}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>closest vibe</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>MOOD ZONE</div>
                  <div className="text-xs font-bold text-white">{getMoodLabel(moodPos.x, moodPos.y)}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>current</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>ENERGY</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#facc15" }}>{Math.round(moodPos.x * 100)}%</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>valence {Math.round(moodPos.y * 100)}%</div>
                </div>
              </>
            ) : showPlaylistMode && playlistData ? (
              <>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>PLAYLISTS</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#c084fc" }}>{playlistData.playlists?.length || 0}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>your playlists</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>TRACKS</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#c084fc" }}>{playlistData.playlists?.reduce((s, pl) => s + (pl.tracks?.length || 0), 0) || 0}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>total saved</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>CROSS</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#c084fc" }}>{playlistData.crossPlaylistTracks?.length || 0}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>multi-playlist</div>
                </div>
                <div className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(168,85,247,0.7)", letterSpacing: "0.12em" }}>HISTORY</div>
                  <div className="text-base font-bold tabular-nums" style={{ color: "#c084fc" }}>{playlistTimeline.length || 0}</div>
                  <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>sessions</div>
                </div>
              </>
            ) : (
              <>
                {[
                  { label: "ARTISTS",  value: meta.totalArtists, sub: "your top" },
                  { label: "RELATED",  value: meta.totalRelatedArtists || 0, sub: "discovered" },
                  { label: "TRACKS",   value: meta.totalTracks, sub: "tracked" },
                  { label: "NODES",    value: displayNodes.length, sub: "in galaxy" },
                  ...(meta.topRecentTrack
                    ? [{ label: "TOP SONG", value: meta.topRecentTrack.name.slice(0, 20) + (meta.topRecentTrack.name.length > 20 ? "…" : ""), sub: meta.topRecentTrack.artist || "", url: meta.topRecentTrack.url }]
                    : []),
                ].map(({ label, value, sub, url }) => (
                  url
                    ? <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                         className="flex flex-col items-center justify-center px-4 transition-colors hover:bg-white/[0.04]"
                         style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                        <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>{label}</div>
                        <div className="text-xs font-bold text-white leading-tight text-center max-w-[120px] truncate">{value}</div>
                        <div className="text-xs text-gray-600 truncate max-w-[120px]">{sub}</div>
                      </a>
                    : <div key={label} className="flex flex-col items-center justify-center px-4" style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                        <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>{label}</div>
                        <div className="text-base font-bold tabular-nums text-white">{value}</div>
                        <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>{sub}</div>
                      </div>
                ))}
              </>
            )}
            <div className="flex flex-col items-center justify-center px-4">
              <button onClick={() => setShowShareModal(true)} className="text-xs px-3 py-1.5 rounded-lg transition-all" style={{ background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.4)", color: "#1DB954" }}>
                📤 Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────── */}
      {showRecordModal && <RecordingModal onClose={() => setShowRecordModal(false)} onStart={handleStartRecording} />}
      {showShareModal && (
        <ShareModal meta={meta} timeRange={timeRange} galaxyRef={galaxyRef}
                    playlistData={playlistData} showPlaylistMode={showPlaylistMode}
                    onClose={() => setShowShareModal(false)} onExportVideo={() => setShowRecordModal(true)} />
      )}
    </div>
  )
}

export default function SpotifyGalaxyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-green-400 font-mono text-sm animate-pulse">Loading…</div>
      </div>
    }>
      <SpotifyGalaxyInner />
    </Suspense>
  )
}
