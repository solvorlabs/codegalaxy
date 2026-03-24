"use client"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, use } from "react"
import dynamic from "next/dynamic"

const GalaxyCanvas = dynamic(() => import("@/components/GalaxyCanvas"), { ssr: false })

const TIME_RANGE_LABELS = {
  short_term:  "Last Month",
  medium_term: "6 Months",
  long_term:   "All Time",
}

export default function PublicSpotifyGalaxy({ params }) {
  const { userId } = use(params)
  const router = useRouter()
  const galaxyRef = useRef(null)
  const [graph, setGraph] = useState(null)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/spotify/public?userId=${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setGraph({ nodes: data.nodes, edges: data.edges })
        setMeta(data.meta)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [userId])

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-green-400 text-sm animate-pulse">Loading galaxy…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center font-mono">
        <div className="text-center">
          <div className="text-4xl mb-4">🌌</div>
          <div className="text-gray-400 text-sm mb-2">
            {error === "Galaxy not found or expired"
              ? `This galaxy has expired. Ask ${userId} to regenerate it.`
              : error}
          </div>
          <button onClick={() => router.push("/")}
                  className="mt-4 text-xs text-gray-600 hover:text-white border border-gray-800 hover:border-gray-600 px-4 py-2 rounded-lg transition-colors">
            ← Home
          </button>
        </div>
      </div>
    )
  }

  const topGenres = meta?.topGenres || []

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 pointer-events-none"
           style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
        <button onClick={() => router.push("/")}
                className="pointer-events-auto text-xs text-gray-500 hover:text-white transition-colors font-mono">
          ← home
        </button>
        <div className="flex items-center gap-2 pointer-events-none font-mono">
          {meta?.userAvatar && (
            <img src={meta.userAvatar} alt="" className="w-6 h-6 rounded-full object-cover"
                 style={{ border: "1.5px solid #1DB954" }} />
          )}
          <span className="text-white text-sm font-semibold">
            {meta?.userName}&apos;s Music Galaxy
          </span>
        </div>
        <div className="text-xs px-2 py-1 rounded-full pointer-events-none font-mono"
             style={{ background: "rgba(29,185,84,0.15)", border: "1px solid rgba(29,185,84,0.3)", color: "#1DB954" }}>
          {TIME_RANGE_LABELS[meta?.timeRange] || meta?.timeRange || ""}
        </div>
      </div>

      {/* Galaxy */}
      {graph && (
        <GalaxyCanvas
          ref={galaxyRef}
          nodes={graph.nodes}
          edges={graph.edges}
          pinnedFolders={[]}
          showMinimap={false}
          musicMode={true}
          musicMeta={meta}
        />
      )}

      {/* Screenshot button (read-only — no export/share for public view) */}
      {graph && (
        <div className="absolute top-14 left-4 z-10 font-mono">
          <button
            onClick={async () => {
              if (!galaxyRef.current) return
              const dataUrl = galaxyRef.current.captureScreenshot?.()
              if (!dataUrl) return
              const a = document.createElement("a")
              a.href = dataUrl; a.download = `music-galaxy-${meta?.userName || userId}.png`
              document.body.appendChild(a); a.click(); document.body.removeChild(a)
            }}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
            style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(40,80,200,0.4)", color: "#8bb8ff" }}>
            📸 Screenshot
          </button>
        </div>
      )}

      {/* Bottom stats */}
      {meta && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 font-mono">
          <div className="rounded-xl flex items-stretch backdrop-blur-md overflow-hidden"
               style={{ background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.35)",
                        boxShadow: "0 0 28px rgba(20,60,180,0.2)", height: 64 }}>
            {[
              { label: "ARTISTS",  value: meta.totalArtists, sub: "tracked" },
              { label: "TRACKS",   value: meta.totalTracks,  sub: "tracked" },
              { label: "GENRES",   value: topGenres.length,  sub: "found" },
            ].map(({ label, value, sub }) => (
              <div key={label} className="flex flex-col items-center justify-center px-5"
                   style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)" }}>{label}</div>
                <div className="text-base font-bold tabular-nums text-white">{value}</div>
                <div className="text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>{sub}</div>
              </div>
            ))}
            <div className="flex flex-col items-center justify-center px-5">
              <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)" }}>VIEW ONLY</div>
              <div className="text-xs" style={{ color: "#1DB954" }}>public galaxy</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
