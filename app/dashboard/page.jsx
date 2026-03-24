"use client"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useState, useMemo } from "react"
import { useRouter } from "next/navigation"
import RepoSearch from "@/components/RepoSearch"

// ── Helpers ───────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return ""
  const d = Date.now() - new Date(iso).getTime()
  const min = Math.floor(d / 60000)
  if (min < 1)  return "just now"
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24)   return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  const mo = Math.floor(days / 30)
  if (mo < 12)   return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

const LANG_DOT = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  Go: "#00ADD8",         Rust: "#dea584",        CSS: "#563d7c",
  HTML: "#e34c26",       Java: "#b07219",         "C++": "#f34b7d",
  Ruby: "#701516",       Shell: "#89e051",        Vue: "#41b883",
  Svelte: "#ff3e00",     Kotlin: "#A97BFF",       Swift: "#F05138",
}

function SkeletonCard() {
  return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] h-44 animate-pulse" />
}

function RepoCard({ repo, onClick, onCompareToggle, isCompareSelected, compareDisabled }) {
  return (
    <div
      className="group rounded-xl border backdrop-blur-sm hover:-translate-y-0.5 transition-all duration-200
                 p-5 flex flex-col gap-3 shadow-lg relative"
      style={{
        borderColor: isCompareSelected ? "rgba(80,160,255,0.6)" : "rgba(255,255,255,0.10)",
        background: isCompareSelected ? "rgba(20,50,120,0.18)" : "rgba(255,255,255,0.03)",
      }}
    >
      {/* Compare checkmark badge */}
      {isCompareSelected && (
        <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold z-10">
          ✓
        </div>
      )}

      <div
        className="cursor-pointer flex-1 flex flex-col gap-3"
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-blue-300 font-semibold text-sm truncate group-hover:text-blue-200 transition-colors">
              {repo.name}
            </div>
            <div className="text-gray-600 text-xs mt-0.5 truncate">{repo.owner.login}</div>
          </div>
          {repo.private && (
            <span className="flex-shrink-0 text-yellow-800 border border-yellow-900/50 px-1.5 py-0.5 rounded text-xs leading-none">
              private
            </span>
          )}
        </div>

        {repo.description && (
          <p className="text-gray-500 text-xs leading-relaxed line-clamp-2 flex-1">
            {repo.description}
          </p>
        )}

        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-3 text-xs text-gray-700">
            {repo.language && (
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: LANG_DOT[repo.language] || "#8b949e" }} />
                {repo.language}
              </span>
            )}
            <span className="flex items-center gap-1">★ {repo.stargazers_count}</span>
            <span className="flex items-center gap-1">⑂ {repo.forks_count}</span>
          </div>
          <span className="text-gray-700 text-xs">{timeAgo(repo.updated_at)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onClick}
          className="flex-1 text-center text-xs font-mono bg-blue-950/50 hover:bg-blue-900/60
                     border border-blue-900/40 hover:border-blue-700/50 text-blue-400
                     hover:text-blue-300 py-1.5 rounded-lg transition-colors"
        >
          Visualize →
        </button>
        <button
          onClick={e => { e.stopPropagation(); onCompareToggle() }}
          disabled={compareDisabled && !isCompareSelected}
          title={isCompareSelected ? "Remove from compare" : "Add to compare"}
          className="px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors"
          style={{
            background: isCompareSelected ? "rgba(40,100,200,0.25)" : "rgba(255,255,255,0.03)",
            borderColor: isCompareSelected ? "rgba(80,160,255,0.5)" : "rgba(255,255,255,0.08)",
            color: compareDisabled && !isCompareSelected ? "#333" : isCompareSelected ? "#8bb8ff" : "#666",
            cursor: compareDisabled && !isCompareSelected ? "not-allowed" : "pointer",
          }}
        >
          {isCompareSelected ? "✓" : "+"}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [repos,   setRepos]   = useState([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState("mine")
  const [filter,  setFilter]  = useState("")
  const [compareSelection, setCompareSelection] = useState([]) // array of repo objects (max 2)

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/")
  }, [status, router])

  useEffect(() => {
    if (!session?.accessToken) return
    fetch("https://api.github.com/user/repos?sort=updated&per_page=50", {
      headers: { Authorization: `token ${session.accessToken}` },
    })
      .then(r => r.json())
      .then(data => { setRepos(Array.isArray(data) ? data : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [session])

  const goToGalaxy = (owner, repo) => router.push(`/galaxy/${owner}/${repo}`)

  const filteredRepos = useMemo(() => {
    if (!filter.trim()) return repos
    const q = filter.toLowerCase()
    return repos.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q) ||
      (r.language || "").toLowerCase().includes(q)
    )
  }, [repos, filter])

  const toggleCompare = (repo) => {
    setCompareSelection(prev => {
      const idx = prev.findIndex(r => r.id === repo.id)
      if (idx >= 0) return prev.filter((_, i) => i !== idx)
      if (prev.length >= 2) return prev
      return [...prev, repo]
    })
  }

  const goToCompare = () => {
    if (compareSelection.length !== 2) return
    const [r1, r2] = compareSelection
    router.push(`/compare/${r1.owner.login}/${r1.name}/${r2.owner.login}/${r2.name}`)
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-blue-500 font-mono text-sm">
        Loading…
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-black text-white font-mono">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-black/90 backdrop-blur px-8 py-4
                         flex items-center justify-between">
        <span className="text-blue-400 font-bold text-lg tracking-tight">Codebase Galaxy</span>
        <div className="flex items-center gap-4">
          {/* Compare Galaxies button */}
          {compareSelection.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-600 text-xs">
                {compareSelection.length}/2 selected
              </span>
              {compareSelection.length === 2 && (
                <button
                  onClick={goToCompare}
                  className="text-xs font-mono px-4 py-1.5 rounded-lg transition-colors"
                  style={{
                    background: "rgba(40,80,200,0.3)",
                    border: "1px solid rgba(80,140,255,0.5)",
                    color: "#8bb8ff",
                  }}
                >
                  Compare Galaxies →
                </button>
              )}
              <button
                onClick={() => setCompareSelection([])}
                className="text-gray-700 hover:text-gray-400 text-xs transition-colors"
              >
                ✕ clear
              </button>
            </div>
          )}
          <button
            onClick={() => router.push("/gallery")}
            className="text-xs text-gray-600 hover:text-blue-400 border border-gray-800
                       hover:border-blue-900 px-3 py-1.5 rounded-lg transition-colors"
          >
            🌌 Gallery
          </button>
          {session?.user?.image && (
            <img src={session.user.image} alt={session.user.name}
                 className="w-7 h-7 rounded-full border border-white/10" />
          )}
          <span className="text-gray-500 text-sm hidden sm:block">{session?.user?.name}</span>
          <button
            onClick={() => signOut()}
            className="text-xs text-gray-600 hover:text-white border border-gray-800
                       hover:border-gray-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-8 py-10">
        {/* ── Tab switcher ──────────────────────────────────────────── */}
        <div className="flex border-b border-white/[0.08] mb-8">
          {[
            { id: "mine",   label: "My Repos" },
            { id: "search", label: "Search Public Repos" },
          ].map(({ id, label }) => (
            <button key={id} onClick={() => setTab(id)}
                    className={`px-5 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                      tab === id ? "text-white border-blue-500" : "text-gray-600 border-transparent hover:text-gray-400"
                    }`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "search" && (
          <section className="mb-10">
            <p className="text-gray-600 text-xs mb-4">
              Enter any public repository in <span className="text-gray-400">owner/repo</span> format.
            </p>
            <RepoSearch onSearch={goToGalaxy} />
          </section>
        )}

        {tab === "mine" && (
          <section>
            <div className="mb-6">
              <input
                type="text"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter repositories…"
                className="w-full max-w-sm bg-white/[0.04] border border-white/10
                           focus:border-blue-600/50 outline-none text-white placeholder-gray-700
                           px-4 py-2 rounded-lg text-sm transition-colors"
              />
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[...Array(6)].map((_, i) => <SkeletonCard key={i} />)}
              </div>
            ) : filteredRepos.length === 0 ? (
              <p className="text-gray-700 text-sm">
                {filter ? `No repos matching "${filter}".` : "No repositories found."}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredRepos.map(r => (
                  <RepoCard
                    key={r.id}
                    repo={r}
                    onClick={() => goToGalaxy(r.owner.login, r.name)}
                    onCompareToggle={() => toggleCompare(r)}
                    isCompareSelected={compareSelection.some(s => s.id === r.id)}
                    compareDisabled={compareSelection.length >= 2}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
