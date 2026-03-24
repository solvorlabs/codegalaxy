"use client"
import { useEffect, useState, useCallback } from "react"
import { useRouter } from "next/navigation"

const LANG_DOT = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Go: "#00ADD8", Rust: "#dea584", CSS: "#563d7c", HTML: "#e34c26",
  Java: "#b07219", "C++": "#f34b7d", Ruby: "#701516", Shell: "#89e051",
}

const GENRE_COLORS = [
  "#1DB954","#1ed760","#17a349","#52b788","#74c69d",
  "#a7c957","#6a994e","#386641","#95d5b2","#b7e4c7",
]

// Pseudo-random galaxy preview CSS — deterministic from owner/repo string
function galaxyHue(owner, repo) {
  let h = 5381; const s = `${owner}/${repo}`
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) % 360
}

function GalaxyPreview({ owner, repo }) {
  const hue = galaxyHue(owner, repo)
  const hue2 = (hue + 60) % 360
  return (
    <div className="relative w-full" style={{ paddingBottom: "56%", overflow: "hidden" }}>
      <div className="absolute inset-0" style={{
        background: `radial-gradient(ellipse 80% 60% at 50% 50%, hsl(${hue},80%,12%) 0%, #000 100%)`,
      }}>
        {/* Galaxy core glow */}
        <div className="absolute" style={{
          top: "40%", left: "50%", transform: "translate(-50%,-50%)",
          width: "28%", paddingBottom: "28%", borderRadius: "50%",
          background: `radial-gradient(circle, hsl(${hue},90%,70%) 0%, hsl(${hue},80%,30%) 40%, transparent 70%)`,
          animation: "galaxy-glow 3s ease-in-out infinite alternate",
          filter: "blur(2px)",
        }} />
        {/* Spiral arms suggestion */}
        <div className="absolute inset-0" style={{
          background: `conic-gradient(from 0deg at 50% 40%, transparent 0deg, hsl(${hue},60%,20%) 30deg, transparent 60deg, hsl(${hue2},50%,15%) 120deg, transparent 150deg, hsl(${hue},60%,20%) 210deg, transparent 240deg, hsl(${hue2},50%,15%) 300deg, transparent 330deg, transparent 360deg)`,
          opacity: 0.5,
          filter: "blur(4px)",
        }} />
        {/* Stars */}
        {[...Array(18)].map((_, i) => {
          const angle = (i / 18) * Math.PI * 2
          const r = 25 + (i % 4) * 10
          const x = 50 + Math.cos(angle + (i * 0.7)) * r
          const y = 40 + Math.sin(angle + (i * 0.7)) * r * 0.5
          const size = 1 + (i % 3)
          return (
            <div key={i} className="absolute rounded-full" style={{
              left: `${x}%`, top: `${y}%`,
              width: size, height: size,
              background: i % 5 === 0 ? `hsl(${hue2},90%,80%)` : "#ffffff",
              opacity: 0.4 + (i % 3) * 0.2,
              animation: `star-twinkle ${1.5 + (i % 3) * 0.5}s ${i * 0.15}s ease-in-out infinite alternate`,
            }} />
          )
        })}
      </div>
    </div>
  )
}

function MusicPreview({ entry }) {
  const topGenres = entry.topGenres || []
  return (
    <div className="relative w-full" style={{ paddingBottom: "56%", overflow: "hidden" }}>
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(29,185,84,0.15) 0%, #000 100%)",
      }}>
        {/* Green core glow */}
        <div className="absolute" style={{
          top: "40%", left: "50%", transform: "translate(-50%,-50%)",
          width: "28%", paddingBottom: "28%", borderRadius: "50%",
          background: "radial-gradient(circle, #1DB954 0%, rgba(29,185,84,0.3) 40%, transparent 70%)",
          animation: "galaxy-glow 3s ease-in-out infinite alternate",
          filter: "blur(2px)",
        }} />
        {/* Genre-colored conic arms */}
        <div className="absolute inset-0" style={{
          background: topGenres.length > 0
            ? `conic-gradient(from 0deg at 50% 40%, ${topGenres.map((_, i) =>
                `${GENRE_COLORS[i % GENRE_COLORS.length]}33 ${(i / topGenres.length) * 360 + 5}deg, transparent ${(i / topGenres.length) * 360 + 30}deg`
              ).join(", ")})`
            : "conic-gradient(from 0deg, rgba(29,185,84,0.2) 30deg, transparent 60deg, rgba(29,185,84,0.15) 180deg, transparent 210deg)",
          opacity: 0.7,
          filter: "blur(3px)",
        }} />
        {/* Stars */}
        {[...Array(14)].map((_, i) => {
          const angle = (i / 14) * Math.PI * 2
          const r = 22 + (i % 4) * 9
          const x = 50 + Math.cos(angle + (i * 0.8)) * r
          const y = 40 + Math.sin(angle + (i * 0.8)) * r * 0.5
          return (
            <div key={i} className="absolute rounded-full" style={{
              left: `${x}%`, top: `${y}%`,
              width: 1 + (i % 2), height: 1 + (i % 2),
              background: GENRE_COLORS[i % GENRE_COLORS.length],
              opacity: 0.5 + (i % 3) * 0.15,
              animation: `star-twinkle ${1.5 + (i % 3) * 0.5}s ${i * 0.1}s ease-in-out infinite alternate`,
            }} />
          )
        })}
      </div>
    </div>
  )
}

function RepoCard({ entry, onOpen }) {
  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer group transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
      onClick={onOpen}
    >
      <GalaxyPreview owner={entry.owner} repo={entry.repo} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <div className="text-blue-300 font-semibold text-sm truncate group-hover:text-blue-200 transition-colors">
              {entry.repo}
            </div>
            <div className="text-gray-600 text-xs truncate">{entry.owner}</div>
          </div>
          {entry.stars > 0 && (
            <span className="text-yellow-700 text-xs flex-shrink-0">★ {entry.stars}</span>
          )}
        </div>
        {entry.description && (
          <p className="text-gray-600 text-xs leading-relaxed line-clamp-2 mb-2">
            {entry.description}
          </p>
        )}
        <div className="flex items-center justify-between mt-2">
          {entry.language ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: LANG_DOT[entry.language] || "#8b949e" }} />
              {entry.language}
            </span>
          ) : <span />}
          <span className="text-gray-700 text-xs">{entry.viewCount || 0} views</span>
        </div>
      </div>
    </div>
  )
}

function MusicCard({ entry, onOpen }) {
  const topGenres = entry.topGenres || []
  return (
    <div
      className="rounded-xl overflow-hidden cursor-pointer group transition-all duration-200 hover:-translate-y-0.5"
      style={{
        background: "rgba(29,185,84,0.04)",
        border: "1px solid rgba(29,185,84,0.15)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
      }}
      onClick={onOpen}
    >
      <MusicPreview entry={entry} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex items-center gap-2">
            {entry.userAvatar && (
              <img src={entry.userAvatar} alt="" className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                   style={{ border: "1.5px solid #1DB954" }} />
            )}
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate group-hover:transition-colors"
                   style={{ color: "#1DB954" }}>
                {entry.userName || entry.owner}&apos;s Music
              </div>
              <div className="text-gray-600 text-xs">
                {entry.totalArtists || 50} artists · {topGenres.length} genres
              </div>
            </div>
          </div>
          <span className="text-gray-700 text-xs flex-shrink-0">{entry.viewCount || 0} views</span>
        </div>
        {/* Genre pills */}
        <div className="flex flex-wrap gap-1">
          {topGenres.slice(0, 3).map((genre, i) => (
            <span key={genre} className="text-xs px-1.5 py-0.5 rounded-full"
                  style={{ background: `${GENRE_COLORS[i]}22`, color: GENRE_COLORS[i], border: `1px solid ${GENRE_COLORS[i]}44` }}>
              {genre}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-xl overflow-hidden animate-pulse"
         style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="w-full bg-white/[0.04]" style={{ paddingBottom: "56%" }} />
      <div className="p-4 space-y-2">
        <div className="h-3 bg-white/[0.06] rounded w-2/3" />
        <div className="h-2 bg-white/[0.04] rounded w-1/3" />
        <div className="h-2 bg-white/[0.04] rounded w-full mt-2" />
      </div>
    </div>
  )
}

export default function GalleryPage() {
  const router = useRouter()
  const [entries,    setEntries]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [sort,       setSort]       = useState("viewCount")
  const [page,       setPage]       = useState(0)
  const [total,      setTotal]      = useState(0)
  const [filter,     setFilter]     = useState("")
  const [typeFilter, setTypeFilter] = useState("all")

  const PAGE_SIZE = 24

  const fetchGallery = useCallback(async (sortVal, pageVal, typeVal) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/gallery?sort=${sortVal}&page=${pageVal}&type=${typeVal}`)
      const data = await res.json()
      setEntries(data.entries || [])
      setTotal(data.total || 0)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchGallery(sort, page, typeFilter)
  }, [sort, page, typeFilter, fetchGallery])

  const handleSort = (s) => {
    if (s === sort) return
    setSort(s); setPage(0)
  }

  const handleTypeFilter = (t) => {
    if (t === typeFilter) return
    setTypeFilter(t); setPage(0)
  }

  const openGalaxy = (entry) => {
    // Increment view count (fire and forget)
    fetch("/api/gallery/view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner: entry.owner, repo: entry.repo }),
    }).catch(() => {})
    if (entry.type === "spotify") {
      router.push(`/spotify/galaxy/${entry.owner}`)
    } else {
      router.push(`/galaxy/${entry.owner}/${entry.repo}`)
    }
  }

  const textFilter = filter.trim()
  const filtered = textFilter
    ? entries.filter(e => {
        if (e.type === "spotify") {
          return (e.userName || "").toLowerCase().includes(textFilter.toLowerCase()) ||
                 (e.topGenres || []).some(g => g.toLowerCase().includes(textFilter.toLowerCase()))
        }
        return e.repo.toLowerCase().includes(textFilter.toLowerCase()) ||
               e.owner.toLowerCase().includes(textFilter.toLowerCase()) ||
               (e.language || "").toLowerCase().includes(textFilter.toLowerCase())
      })
    : entries

  return (
    <main className="min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-black/90 backdrop-blur px-6 sm:px-10 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">
            ← home
          </button>
          <span className="text-blue-400 font-bold text-base tracking-tight">🌌 Galaxy</span>
          <span className="text-gray-600 text-xs hidden sm:block">
            {total} entries
          </span>
        </div>
        <button onClick={() => router.push("/dashboard")}
                className="text-xs text-gray-600 hover:text-white border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors">
          My repos →
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-6 sm:px-10 py-8">
        {/* Type filter + Sort + text filter row */}
        <div className="flex flex-wrap items-center gap-3 mb-8">
          {/* Type tabs */}
          <div className="flex border border-white/[0.08] rounded-lg overflow-hidden">
            {[
              { id: "all",     label: "All" },
              { id: "github",  label: "💻 Code" },
              { id: "spotify", label: "♫ Music" },
            ].map(({ id, label }) => (
              <button key={id} onClick={() => handleTypeFilter(id)}
                      className={`px-4 py-2 text-xs transition-colors ${
                        typeFilter === id
                          ? id === "spotify"
                            ? "bg-green-950/60 text-green-400 border-r border-white/[0.08] last:border-0"
                            : "bg-blue-950/60 text-blue-300 border-r border-white/[0.08] last:border-0"
                          : "text-gray-600 hover:text-gray-400 border-r border-white/[0.06] last:border-0"
                      }`}>
                {label}
              </button>
            ))}
          </div>

          {/* Sort tabs */}
          <div className="flex border border-white/[0.08] rounded-lg overflow-hidden">
            {[
              { id: "viewCount", label: "Most Viewed" },
              { id: "stars",     label: "Most Starred" },
              { id: "addedAt",   label: "Recent" },
            ].map(({ id, label }) => (
              <button key={id} onClick={() => handleSort(id)}
                      className={`px-4 py-2 text-xs transition-colors ${
                        sort === id
                          ? "bg-blue-950/60 text-blue-300 border-r border-white/[0.08] last:border-0"
                          : "text-gray-600 hover:text-gray-400 border-r border-white/[0.06] last:border-0"
                      }`}>
                {label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter…"
            className="bg-white/[0.04] border border-white/10 focus:border-blue-600/50 outline-none text-white
                       placeholder-gray-700 px-4 py-2 rounded-lg text-xs transition-colors w-40"
          />
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {[...Array(8)].map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <div className="text-4xl mb-4">🌌</div>
            <div className="text-gray-600 text-sm">
              {filter ? "No galaxies match that search." : "No galaxies yet. Visualize a repo to add it!"}
            </div>
            {!filter && (
              <button onClick={() => router.push("/dashboard")}
                      className="mt-4 text-blue-500 hover:text-blue-400 text-xs underline">
                Visualize a repo →
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {filtered.map((e, idx) =>
                e.type === "spotify"
                  ? <MusicCard key={`spotify:${e.owner}:${idx}`} entry={e} onOpen={() => openGalaxy(e)} />
                  : <RepoCard  key={`${e.owner}/${e.repo}`}      entry={e} onOpen={() => openGalaxy(e)} />
              )}
            </div>

            {/* Pagination */}
            {!filter && total > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-4 mt-10">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-500 hover:text-white disabled:opacity-30 transition-colors"
                >
                  ← Prev
                </button>
                <span className="text-gray-600 text-xs">
                  Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}
                </span>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= total}
                  className="text-xs px-4 py-2 rounded-lg border border-white/10 text-gray-500 hover:text-white disabled:opacity-30 transition-colors"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* CSS animation keyframes for galaxy preview (local scope) */}
      <style>{`
        @keyframes galaxy-glow {
          from { opacity: 0.7; transform: translate(-50%,-50%) scale(0.95); }
          to   { opacity: 1;   transform: translate(-50%,-50%) scale(1.05); }
        }
        @keyframes star-twinkle {
          from { opacity: 0.3; }
          to   { opacity: 0.9; }
        }
      `}</style>
    </main>
  )
}
