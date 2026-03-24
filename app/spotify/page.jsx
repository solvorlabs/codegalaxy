"use client"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import InfoButton from "@/components/InfoButton"

const TIME_RANGES = [
  { id: "short_term",  label: "Last Month",  sub: "~4 weeks" },
  { id: "medium_term", label: "6 Months",    sub: "~6 months" },
  { id: "long_term",   label: "All Time",    sub: "lifetime" },
]

function GenreBar({ genreArtistCounts, topGenres }) {
  const total = Object.values(genreArtistCounts || {}).reduce((s, v) => s + v, 0) || 1
  const GENRE_COLORS = [
    "#1DB954","#1ed760","#17a349","#52b788","#74c69d",
    "#95d5b2","#b7e4c7","#a7c957","#6a994e","#386641",
  ]
  return (
    <div className="w-full h-3 rounded-full overflow-hidden flex mt-2" title="Genre distribution">
      {topGenres.map((genre, i) => {
        const pct = ((genreArtistCounts[genre] || 0) / total) * 100
        return (
          <div key={genre} style={{ width: `${pct}%`, background: GENRE_COLORS[i % GENRE_COLORS.length] }}
               title={`${genre}: ${genreArtistCounts[genre]}`} />
        )
      })}
      {/* remainder */}
      <div className="flex-1" style={{ background: "#1a1a1a" }} />
    </div>
  )
}

export default function SpotifyDashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [timeRange, setTimeRange] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)

  useEffect(() => {
    if (status === "loading") return
    if (!session) { router.replace("/"); return }
    if (session.provider !== "spotify") { router.replace("/dashboard"); return }
  }, [session, status, router])

  // Fetch preview of top artists when time range is selected
  useEffect(() => {
    if (!timeRange || !session?.spotifyAccessToken) return
    setPreviewLoading(true)
    setPreviewError(null)
    fetch(`https://api.spotify.com/v1/me/top/artists?limit=5&time_range=${timeRange}`, {
      headers: { Authorization: `Bearer ${session.spotifyAccessToken}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error.message)
        setPreview(data.items || [])
      })
      .catch(err => setPreviewError(err.message))
      .finally(() => setPreviewLoading(false))
  }, [timeRange, session?.spotifyAccessToken])

  if (status === "loading" || !session) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-green-400 font-mono text-sm animate-pulse">Connecting to Spotify…</div>
      </div>
    )
  }

  const userAvatar = session?.user?.image
  const userName   = session?.user?.name || "Listener"

  return (
    <main className="min-h-screen bg-black text-white font-mono">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-black/90 backdrop-blur px-6 sm:px-10 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => router.push("/")} className="text-gray-600 hover:text-gray-400 text-xs transition-colors">
            ← home
          </button>
          <span className="font-bold text-base tracking-tight" style={{ color: "#1DB954" }}>
            ♫ Music Galaxy
          </span>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })}
                className="text-xs text-gray-600 hover:text-white border border-gray-800 hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors">
          Sign out
        </button>
      </header>

      <div className="max-w-3xl mx-auto px-6 sm:px-10 py-10">
        {/* User profile card */}
        <div className="rounded-2xl p-6 mb-10 flex items-center gap-5"
             style={{ background: "rgba(29,185,84,0.06)", border: "1px solid rgba(29,185,84,0.2)" }}>
          {userAvatar && (
            <img src={userAvatar} alt={userName} className="w-16 h-16 rounded-full object-cover flex-shrink-0"
                 style={{ boxShadow: "0 0 0 3px #1DB954, 0 0 20px rgba(29,185,84,0.3)" }} />
          )}
          <div>
            <div className="text-white font-bold text-xl">{userName}</div>
            <div className="text-xs mt-0.5" style={{ color: "#1DB954" }}>Your Music Galaxy</div>
          </div>
        </div>

        {/* Time range selector */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm text-gray-400 uppercase tracking-widest">Select Time Range</h2>
            <InfoButton title="Time Ranges">
              {`Last Month — your recent listening\n6 Months — your current phase\nAll Time — your complete taste DNA\n\nDifferent ranges show how your\ntaste has evolved over time.`}
            </InfoButton>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {TIME_RANGES.map(tr => {
              const active = timeRange === tr.id
              return (
                <button key={tr.id} onClick={() => setTimeRange(tr.id)}
                        className="rounded-xl p-4 text-center transition-all"
                        style={{
                          background: active ? "#1DB954" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${active ? "#1DB954" : "rgba(29,185,84,0.25)"}`,
                          color: active ? "#fff" : "#9ca3af",
                          boxShadow: active ? "0 0 16px rgba(29,185,84,0.3)" : "none",
                        }}>
                  <div className={`font-semibold text-sm ${active ? "text-white" : ""}`}>{tr.label}</div>
                  <div className={`text-xs mt-1 ${active ? "text-white/70" : "text-gray-600"}`}>{tr.sub}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Top artists preview */}
        {timeRange && (
          <div className="mb-8">
            {previewLoading && (
              <div className="text-xs text-gray-600 animate-pulse">Loading your top artists…</div>
            )}
            {previewError && (
              <div className="text-xs text-red-400">{previewError}</div>
            )}
            {preview && !previewLoading && (
              <>
                <div className="text-xs text-gray-500 mb-3 uppercase tracking-widest">Top Artists Preview</div>
                <div className="flex items-center gap-3 flex-wrap">
                  {preview.map(artist => (
                    <div key={artist.id} className="flex flex-col items-center gap-1">
                      {artist.images?.[0]?.url ? (
                        <img src={artist.images[0].url} alt={artist.name}
                             className="w-10 h-10 rounded-full object-cover"
                             style={{ border: "2px solid rgba(29,185,84,0.4)" }} />
                      ) : (
                        <div className="w-10 h-10 rounded-full" style={{ background: "rgba(29,185,84,0.2)" }} />
                      )}
                      <span className="text-xs text-gray-400 max-w-[48px] text-center truncate">{artist.name}</span>
                    </div>
                  ))}
                  <div className="text-xs text-gray-600 ml-1">…and 45 more</div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Generate button */}
        {timeRange && (
          <button
            onClick={() => router.push(`/spotify/galaxy?timeRange=${timeRange}`)}
            className="w-full py-4 rounded-xl font-bold text-base text-white transition-all"
            style={{
              background: "#1DB954",
              boxShadow: "0 0 24px rgba(29,185,84,0.3)",
            }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 32px rgba(29,185,84,0.5)" }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 24px rgba(29,185,84,0.3)" }}
          >
            🌌 Generate My Galaxy
          </button>
        )}
      </div>
    </main>
  )
}
