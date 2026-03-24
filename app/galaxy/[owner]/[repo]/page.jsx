"use client"
import { useSession } from "next-auth/react"
import { useEffect, useState, useMemo, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { use } from "react"
import GalaxyCanvas from "@/components/GalaxyCanvas"
import InfoButton from "@/components/InfoButton"
import GalaxyTour from "@/components/GalaxyTour"

// ── Community averages for benchmarking ───────────────────────────────────────
const COMMUNITY_AVGS = {
  files: { avg: 180, unit: "files", p5: 500, p95: 30, note: "files" },
  folders: { avg: 18, unit: "folders", p5: 60, p95: 5, note: "folders" },
  deps: { avg: 25, unit: "dependencies", p5: 80, p95: 5, note: "dependencies" },
}
function benchmarkText(label, value) {
  const l = label.toLowerCase()
  if (l === "files") {
    if (value > 500) return `${value} files is large — avg repo has ~180. You're in the top 5% by size. 🏔️`
    if (value > 180) return `${value} files is above average (~180). A healthy mid-sized codebase.`
    if (value < 30) return `${value} files is very small. Great for focus and speed. 🌱`
    return `${value} files is near the average of ~180. A healthy size.`
  }
  if (l === "folders") {
    if (value > 30) return `${value} folders — well structured! Most repos use 10–25 top-level folders.`
    if (value < 5) return `${value} folders is minimal — either flat or a tiny project.`
    return `${value} folders. Average is ~18. Your structure looks organized.`
  }
  if (l === "deps") {
    if (value > 80) return `${value} import links — very dense. Average is ~25. Watch for tight coupling. ⚠️`
    if (value < 5) return `${value} dependencies. Extremely modular — or quite small.  ✅`
    return `${value} dependencies. Average is ~25. ${value < 25 ? "Very modular! ✅" : "Reasonable."}`
  }
  return null
}

// ── Hue formula (must match GalaxyCanvas) ─────────────────────────────────
function folderHsl(fi, total) {
  return `hsl(${Math.round((fi / total) * 360)}, 85%, 58%)`
}
function mostConnectedNode(nodes, edges) {
  const counts = {}
  edges.forEach(({ source, target }) => {
    counts[source] = (counts[source] || 0) + 1
    counts[target] = (counts[target] || 0) + 1
  })
  const topId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
  return nodes.find(n => n.id === topId) ?? null
}
function djb2(v) {
  let h = 5381; const s = String(v)
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
  return Math.abs(h)
}

const ERROR_MSGS = {
  RATE_LIMIT: { text: "GitHub API rate limit reached. Try again in a few minutes.", icon: "⏳" },
  NOT_FOUND: { text: "This repository is private or doesn't exist.", icon: "🔒" },
  NO_FILES: { text: "No parseable files found in this repo. Try a JavaScript or TypeScript repository.", icon: "🌌" },
}
const SCAN_PHASES = [
  "Scanning repository…", "Mapping file structures…", "Plotting star positions…",
  "Computing orbital paths…", "Rendering galactic core…",
]
function StarIcon({ color }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" style={{ flexShrink: 0 }}>
      <path d="M6 0.5 L6.7 5.3 L11.5 6 L6.7 6.7 L6 11.5 L5.3 6.7 L0.5 6 L5.3 5.3 Z" fill={color} />
    </svg>
  )
}
function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  )
}

// ── Typewriter effect hook ────────────────────────────────────────────────
function useTypewriter(text, speed = 28) {
  const [displayed, setDisplayed] = useState("")
  useEffect(() => {
    if (!text) { setDisplayed(""); return }
    setDisplayed(""); let i = 0
    const t = setInterval(() => {
      i++; setDisplayed(text.slice(0, i))
      if (i >= text.length) clearInterval(t)
    }, speed)
    return () => clearInterval(t)
  }, [text, speed])
  return displayed
}

// ── DNA strip component ───────────────────────────────────────────────────
function DnaStrip({ colors }) {
  if (!colors.length) return null
  return (
    <div className="absolute bottom-0 left-0 right-0 h-2 z-10 flex" style={{ bottom: "52px" }}>
      {colors.map((color, i) => (
        <div
          key={i}
          className="flex-1 h-full"
          style={{
            background: color,
            animation: `dna-pulse 2s ${(i * 0.0625).toFixed(2)}s ease-in-out infinite`,
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  )
}

export default function GalaxyPage({ params }) {
  const { owner, repo } = use(params)
  const { data: session, status } = useSession()
  const router = useRouter()

  // ── Core state ────────────────────────────────────────────────────────
  const [graph, setGraph] = useState(null)
  const [loading, setLoading] = useState(true)
  const [errorKey, setErrorKey] = useState(null)
  const [loadingPhase, setLoadingPhase] = useState(0)

  // ── Visualization mode state ──────────────────────────────────────────
  const [hoveredFolder, setHoveredFolder] = useState(null)
  const [pinnedFolders, setPinnedFolders] = useState([])
  const [fileTypeFilter, setFileTypeFilter] = useState(null)
  const [hideUI, setHideUI] = useState(false)
  const [toast, setToast] = useState(null)
  const [screenshotBusy, setScreenshotBusy] = useState(false)
  const [healthMode, setHealthMode] = useState(false)
  const [activityData, setActivityData] = useState(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityOn, setActivityOn] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchCount, setSearchCount] = useState(null)

  // ── Modal / panel state ───────────────────────────────────────────────
  const [roastOpen, setRoastOpen] = useState(false)
  const [roastText, setRoastText] = useState(null)
  const [roastLoading, setRoastLoading] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [badgeOpen, setBadgeOpen] = useState(false)
  const [embedOpen, setEmbedOpen] = useState(false)
  const [starNudge, setStarNudge] = useState(false)
  const [copiedBadge, setCopiedBadge] = useState(null)

  // ── Time Machine + tour + metadata ───────────────────────────────────────
  const [timeMachineOpen, setTimeMachineOpen] = useState(false)
  const [tmData, setTmData] = useState(null)   // { commits, totalCommits, sampled }
  const [tmLoading, setTmLoading] = useState(false)
  const [tmError, setTmError] = useState(null)
  const [commitIndex, setCommitIndex] = useState(0)
  const [tmPlaying, setTmPlaying] = useState(false)
  const [tmSpeed, setTmSpeed] = useState(1)      // 0.5 | 1 | 2 | 4
  const [tmColorByAuthor, setTmColorByAuthor] = useState(false)
  const [tmVisible, setTmVisible] = useState(null)   // Set<string>|null
  const [tmSpawn, setTmSpawn] = useState(null)   // string[]|null
  const [tmModify, setTmModify] = useState(null)   // string[]|null
  const [tmRemove, setTmRemove] = useState(null)   // string[]|null
  const [tmShowIntro, setTmShowIntro] = useState(false)
  const [tmCelebration, setTmCelebration] = useState(null)
  const [tmCardVisible, setTmCardVisible] = useState(false) // transient commit card
  const [repoMeta, setRepoMeta] = useState(null)
  const [benchmarkStat, setBenchmarkStat] = useState(null)   // { label, value, text }
  const [showTour, setShowTour] = useState(false)
  const [eggToast, setEggToast] = useState(null)
  const [showRecordModal, setShowRecordModal] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordProgress, setRecordProgress] = useState(0)
  const [recordDuration, setRecordDuration] = useState(8)
  const [recordDone, setRecordDone] = useState(false)
  const recordTimerRef = useRef(null)
  // ── Responsive + animated stats ─────────────────────────────────────────
  const [windowWidth, setWindowWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1920)
  const [statsCountUpValues, setStatsCountUpValues] = useState({ files: 0, folders: 0, deps: 0 })
  const [statsAnimated, setStatsAnimated] = useState(false)

  const galaxyRef = useRef(null)
  const searchInput = useRef(null)
  const tmPlayRef = useRef(null)
  const tmSnapshotsRef = useRef([])   // precomputed [{ visible: Set, spawn:[], modify:[], remove:[] }]

  const roastDisplayed = useTypewriter(roastText)

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/")
  }, [status, router])

  // Early metadata fetch for loading screen preview
  useEffect(() => {
    if (!session?.accessToken) return
    fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${session.accessToken}` },
    }).then(r => r.json()).then(setRepoMeta).catch(() => { })
  }, [session, owner, repo])

  useEffect(() => {
    if (!session) return
    setLoading(true); setErrorKey(null)
    fetch("/api/analyze", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ owner, repo }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) { setErrorKey(data.error || "UNKNOWN"); setLoading(false); return }
        if (!data.nodes?.length) { setErrorKey("NO_FILES"); setLoading(false); return }
        setGraph(data); setLoading(false)
        // Show guided tour for first-time visitors
        if (typeof localStorage !== "undefined" && !localStorage.getItem("galaxy_toured")) setShowTour(true)
        // Auto-add to public gallery (fire and forget)
        fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: { Authorization: `token ${session.accessToken}` },
        }).then(r2 => r2.json()).then(meta => {
          fetch("/api/gallery/add", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner, repo,
              stars: meta.stargazers_count || 0,
              description: meta.description || "",
              language: meta.language || "",
            }),
          }).catch(() => { })
        }).catch(() => {
          fetch("/api/gallery/add", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, repo, stars: 0, description: "", language: "" }),
          }).catch(() => { })
        })
      })
      .catch((err) => { setErrorKey(err.message); setLoading(false) })
  }, [session, owner, repo])

  useEffect(() => {
    if (!loading) return
    const t = setInterval(() => setLoadingPhase(p => (p + 1) % SCAN_PHASES.length), 1200)
    return () => clearInterval(t)
  }, [loading])

  // Star nudge: show after 30s if graph loaded
  useEffect(() => {
    if (!graph) return
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem("starNudgeShown")) return
    const t = setTimeout(() => {
      setStarNudge(true)
      if (typeof sessionStorage !== "undefined") sessionStorage.setItem("starNudgeShown", "1")
    }, 30000)
    return () => clearTimeout(t)
  }, [graph])

  // ── Derived data ───────────────────────────────────────────────────────
  const folderColors = useMemo(() => {
    if (!graph?.nodes) return []
    const seen = new Set(), ordered = []
    graph.nodes.forEach(n => { if (!seen.has(n.folder)) { seen.add(n.folder); ordered.push(n.folder) } })
    return ordered.slice(0, 12).map((folder, fi) => ({ folder, color: folderHsl(fi, ordered.length) }))
  }, [graph])

  const stats = useMemo(() => {
    if (!graph) return null
    const folderCount = new Set(graph.nodes.map(n => n.folder)).size
    const top = mostConnectedNode(graph.nodes, graph.edges)
    return { files: graph.nodes.length, folders: folderCount, deps: graph.edges.length, topFile: top?.label ?? "—" }
  }, [graph])

  const fileTypes = useMemo(() => {
    if (!graph?.nodes) return []
    const counts = {}
    graph.nodes.forEach(n => {
      const ext = n.id.split(".").pop().toLowerCase()
      if (ext.length <= 5) counts[ext] = (counts[ext] || 0) + 1
    })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ext, count]) => ({ ext, count }))
  }, [graph])
  const maxFileTypeCount = useMemo(() => Math.max(...fileTypes.map(f => f.count), 1), [fileTypes])

  // DNA fingerprint (32 colored segments)
  const dnaColors = useMemo(() => {
    if (!graph?.nodes) return []
    const folders = [...new Set(graph.nodes.map(n => n.folder))]
    const stats32 = [
      graph.nodes.length, folders.length, graph.edges.length,
      ...folders.slice(0, 10).map(f => graph.nodes.filter(n => n.folder === f).length),
      ...graph.nodes.slice(0, 19).map(n => n.lines || 0),
    ].slice(0, 32)
    while (stats32.length < 32) stats32.push(stats32.length)
    return stats32.map((s, i) => `hsl(${djb2(`${s}_${i}`) % 360},70%,60%)`)
  }, [graph])

  // Average health score for roast
  const avgHealthScore = useMemo(() => {
    if (!graph?.nodes) return 50
    const inDeg = {}
    graph.edges.forEach(({ target }) => { inDeg[target] = (inDeg[target] || 0) + 1 })
    const scores = graph.nodes.map(n => {
      let s = 50; const lines = n.lines || 0
      if (lines > 1000) s -= 40; else if (lines > 500) s -= 20
      if (!n.imports || n.imports.length === 0) s -= 15
      if (/\.(test|spec)\./i.test(n.id)) s += 25
      if (/\bindex\./i.test(n.label)) s += 10
      if (/utils|helpers/i.test(n.folder)) s += 10
      if ((inDeg[n.id] || 0) >= 3) s += 15
      return Math.max(0, Math.min(100, s))
    })
    return Math.round(scores.reduce((a, b) => a + b, 0) / Math.max(scores.length, 1))
  }, [graph])

  // ── Time Machine: precompute snapshots when tmData loads ─────────────────
  useEffect(() => {
    if (!tmData?.commits || !graph?.nodes) return
    const graphIds = new Set(graph.nodes.map(n => n.id))
    const visible = new Set()
    tmSnapshotsRef.current = tmData.commits.map(c => {
      ; (c.filesAdded || []).forEach(f => visible.add(f))
        ; (c.filesRemoved || []).forEach(f => visible.delete(f))
      return {
        visible: new Set([...visible].filter(f => graphIds.has(f))),
        spawn: (c.filesAdded || []).filter(f => graphIds.has(f)),
        modify: (c.filesModified || []).filter(f => graphIds.has(f)),
        remove: (c.filesRemoved || []).filter(f => graphIds.has(f)),
      }
    })
    // Apply the current index immediately
    const snap = tmSnapshotsRef.current[commitIndex]
    if (snap) {
      setTmVisible(snap.visible)
      setTmSpawn(snap.spawn)
      setTmModify(snap.modify)
      setTmRemove(snap.remove)
    }
  }, [tmData, graph])

  // ── Time Machine: apply snapshot on commit index change ──────────────────
  useEffect(() => {
    if (!timeMachineOpen || !tmSnapshotsRef.current.length) return
    const snap = tmSnapshotsRef.current[commitIndex]
    if (!snap) return
    setTmVisible(snap.visible)
    setTmSpawn(snap.spawn)
    setTmModify(snap.modify)
    setTmRemove(snap.remove)
  }, [commitIndex, timeMachineOpen])

  // ── Time Machine: author color map ────────────────────────────────────────
  const tmAuthorColors = useMemo(() => {
    if (!tmColorByAuthor || !tmData?.commits || !graph?.nodes) return null
    const MAX_AUTHORS = 8
    const authorHueMemo = {}
    let authorCount = 0
    const getAuthorColor = (author) => {
      if (!authorHueMemo[author]) {
        if (authorCount >= MAX_AUTHORS) return "#666680"
        let h = 5381; const s = author
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff
        authorHueMemo[author] = `hsl(${Math.abs(h) % 360},75%,55%)`
        authorCount++
      }
      return authorHueMemo[author]
    }
    const firstAuthor = {}
    for (const c of tmData.commits) {
      for (const f of (c.filesAdded || [])) { if (!firstAuthor[f]) firstAuthor[f] = c.author }
    }
    const result = {}
    for (const n of graph.nodes) {
      const a = firstAuthor[n.id]
      if (a) result[n.id] = getAuthorColor(a)
    }
    return result
  }, [tmColorByAuthor, tmData, graph])

  // ── Time Machine: author legend ───────────────────────────────────────────
  const tmAuthorLegend = useMemo(() => {
    if (!tmAuthorColors || !graph?.nodes) return []
    const counts = {}
    for (const [nodeId, color] of Object.entries(tmAuthorColors)) {
      counts[color] = (counts[color] || { color, files: 0, author: "" })
      counts[color].files++
    }
    if (!tmData?.commits) return []
    const authorForColor = {}
    for (const c of tmData.commits) {
      for (const f of (c.filesAdded || [])) {
        const col = tmAuthorColors[f]
        if (col && !authorForColor[col]) authorForColor[col] = c.author
      }
    }
    return Object.values(counts)
      .map(entry => ({ ...entry, author: authorForColor[entry.color] ?? "Other" }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 8)
  }, [tmAuthorColors, tmData, graph])

  // ── Time Machine: "big bang" commits (5+ files added) ────────────────────
  const tmBigBangCommits = useMemo(() => {
    if (!tmData?.commits) return []
    return tmData.commits
      .map((c, i) => ({ ...c, index: i, addCount: (c.filesAdded || []).length }))
      .filter(c => c.addCount >= 5)
      .sort((a, b) => b.addCount - a.addCount)
      .slice(0, 10)
  }, [tmData])

  // ── Time Machine: commit density histogram (100 bars) ─────────────────────
  const tmHistogramData = useMemo(() => {
    if (!tmData?.commits?.length) return []
    const commits = tmData.commits
    const BAR_COUNT = 100
    const step = commits.length / BAR_COUNT
    const buckets = []
    for (let i = 0; i < BAR_COUNT; i++) {
      const idx = Math.min(Math.round((i + 0.5) * step), commits.length - 1)
      const c = commits[idx]
      const added = c?.filesAdded?.length ?? 0
      const removed = c?.filesRemoved?.length ?? 0
      buckets.push({ commitIndex: idx, net: added - removed, total: added + removed })
    }
    const maxTotal = Math.max(...buckets.map(b => b.total), 1)
    return buckets.map(b => ({ ...b, heightPct: Math.max((b.total / maxTotal) * 100, 4) }))
  }, [tmData])

  // ── Time Machine: first-commit intro overlay ──────────────────────────
  useEffect(() => {
    if (!timeMachineOpen || !tmData?.commits?.length) return
    const firstCommit = tmData.commits[0]
    const fileCount = (firstCommit?.filesAdded?.length ?? 0)
    if (commitIndex === 0 && fileCount <= 3) {
      setTmShowIntro(true)
      const t = setTimeout(() => setTmShowIntro(false), 2500)
      return () => clearTimeout(t)
    }
  }, [timeMachineOpen, tmData])

  // ── Time Machine: transient commit card (fades 2s after scrubbing stops) ─
  const tmCardHideRef = useRef(null)
  useEffect(() => {
    if (!timeMachineOpen || !tmData) return
    setTmCardVisible(true)
    clearTimeout(tmCardHideRef.current)
    tmCardHideRef.current = setTimeout(() => setTmCardVisible(false), 2000)
    return () => clearTimeout(tmCardHideRef.current)
  }, [commitIndex, timeMachineOpen])

  // ── Responsive: track window width ────────────────────────────────────────
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth)
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [])

  // ── Stats bar: count-up animation on first load ───────────────────────────
  useEffect(() => {
    if (!stats || statsAnimated) return
    setStatsAnimated(true)
    const STEPS = 45, DURATION_MS = 900
    let step = 0
    const timer = setInterval(() => {
      step++
      const eased = 1 - Math.pow(1 - step / STEPS, 3)
      setStatsCountUpValues({
        files: Math.round(stats.files * eased),
        folders: Math.round(stats.folders * eased),
        deps: Math.round(stats.deps * eased),
      })
      if (step >= STEPS) clearInterval(timer)
    }, DURATION_MS / STEPS)
    return () => clearInterval(timer)
  }, [stats, statsAnimated])

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (!galaxyRef.current || screenshotBusy) return
    setScreenshotBusy(true); setHideUI(true)
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const dataUrl = galaxyRef.current.captureScreenshot()
    setHideUI(false); setScreenshotBusy(false)
    if (!dataUrl) return
    const a = document.createElement("a"); a.href = dataUrl
    a.download = `codebase-galaxy-${owner}-${repo}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    try { await navigator.clipboard.writeText(`${window.location.origin}/galaxy/${owner}/${repo}`) } catch { }
    setToast("Screenshot saved + link copied!")
    setTimeout(() => setToast(null), 3000)
  }, [owner, repo, screenshotBusy])

  const handleStartRecording = useCallback((duration, quality) => {
    setShowRecordModal(false)
    if (!galaxyRef.current?.startRecording) return
    setIsRecording(true)
    setRecordProgress(0)
    setRecordDuration(duration)
    setRecordDone(false)
    galaxyRef.current.startRecording(duration, quality)
    const interval = 100
    const steps = (duration * 1000) / interval
    let step = 0
    clearInterval(recordTimerRef.current)
    recordTimerRef.current = setInterval(() => {
      step++
      setRecordProgress(step / steps)
      if (step >= steps) {
        clearInterval(recordTimerRef.current)
        setIsRecording(false)
        setRecordDone(true)
        setTimeout(() => setRecordDone(false), 4000)
      }
    }, interval)
  }, [])

  const togglePinFolder = useCallback((folder) => {
    setPinnedFolders(prev => prev.includes(folder) ? prev.filter(f => f !== folder) : [...prev, folder])
  }, [])

  const fetchActivityData = useCallback(async () => {
    if (!graph || !session?.accessToken || activityLoading) return
    setActivityLoading(true)
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const topNodes = [...graph.nodes].sort((a, b) => b.size - a.size).slice(0, 50)
    const results = {}
    await Promise.allSettled(topNodes.map(async node => {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/commits?path=${encodeURIComponent(node.id)}&per_page=10&since=${since}`,
          { headers: { Authorization: `token ${session.accessToken}` } }
        )
        if (res.ok) { const c = await res.json(); results[node.id] = Array.isArray(c) ? c.length : 0 }
      } catch { }
    }))
    setActivityData(results); setActivityLoading(false)
  }, [graph, session, owner, repo, activityLoading])

  const handleActivityToggle = useCallback(() => {
    if (!activityOn) {
      setHealthMode(false)
      setActivityOn(true)
      if (!activityData) fetchActivityData()
    } else {
      setActivityOn(false)
      setActivityData(null)
    }
  }, [activityOn, activityData, fetchActivityData])

  const handleHealthToggle = useCallback(() => {
    setHealthMode(m => {
      if (!m) { setActivityOn(false); setActivityData(null) }
      return !m
    })
  }, [])

  const handleRoast = useCallback(async () => {
    if (!graph || roastLoading) return
    setRoastOpen(true); setRoastText(null); setRoastLoading(true)
    const inDeg = {}
    graph.edges.forEach(({ target }) => { inDeg[target] = (inDeg[target] || 0) + 1 })
    const totalFiles = graph.nodes.length
    const linesArr = graph.nodes.map(n => n.lines || 0)
    const avgLinesPerFile = Math.round(linesArr.reduce((a, b) => a + b, 0) / Math.max(linesArr.length, 1))
    const isolatedFiles = graph.nodes.filter(n =>
      (!n.imports || n.imports.length === 0) && (inDeg[n.id] || 0) === 0
    ).length
    const mostConnectedFile = graph.nodes.reduce((best, n) => {
      const sc = (n.imports?.length || 0) + (inDeg[n.id] || 0)
      return sc > best.score ? { name: n.label, imports: n.imports?.length || 0, score: sc } : best
    }, { name: "", imports: 0, score: 0 })
    const hasTests = graph.nodes.some(n => /\.(test|spec)\./i.test(n.id))
    const exts = {}
    graph.nodes.forEach(n => { const e = n.id.split(".").pop().toLowerCase(); exts[e] = (exts[e] || 0) + 1 })
    try {
      const res = await fetch("/api/roast", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stats: {
            totalFiles, avgLinesPerFile, isolatedFiles, mostConnectedFile: mostConnectedFile,
            hasTests, cssCount: exts.css || 0,
            jsCount: (exts.js || 0) + (exts.jsx || 0),
            jsonCount: exts.json || 0, avgHealthScore,
          }
        }),
      })
      const { roast } = await res.json()
      setRoastText(roast || "No roast available.")
    } catch { setRoastText("Our roaster broke. Even the roaster has bugs.") }
    setRoastLoading(false)
  }, [graph, roastLoading, avgHealthScore])

  const handleEasterEggToast = useCallback((msg) => {
    setEggToast(msg)
    setTimeout(() => setEggToast(null), 4000)
  }, [])

  // ── Time Machine: fetch commit timeline ───────────────────────────────────
  const fetchTmData = useCallback(async () => {
    if (!session?.accessToken || tmLoading) return
    setTmLoading(true); setTmError(null)
    try {
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner, repo }),
      })
      if (!res.ok) throw new Error("failed")
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setTmData(data)
      setCommitIndex(0)
    } catch (err) {
      setTmError(err.message || "Could not load commit history.")
    }
    setTmLoading(false)
  }, [session, owner, repo, tmLoading])

  const handleTimeMachineOpen = useCallback(() => {
    if (timeMachineOpen) {
      // Close — restore full galaxy
      setTimeMachineOpen(false)
      setTmPlaying(false)
      setTmVisible(null); setTmSpawn(null); setTmModify(null); setTmRemove(null)
      return
    }
    setTimeMachineOpen(true)
    setCommitIndex(0)
    if (!tmData) fetchTmData()
  }, [timeMachineOpen, tmData, fetchTmData])

  // ── Time Machine: auto-play ────────────────────────────────────────────────
  useEffect(() => {
    if (!tmPlaying) {
      if (tmPlayRef.current) { clearInterval(tmPlayRef.current); tmPlayRef.current = null }
      return
    }
    const msPerCommit = { 0.5: 1200, 1: 600, 2: 300, 4: 150 }[tmSpeed] ?? 600
    const total = tmSnapshotsRef.current.length
    if (!total) { setTmPlaying(false); return }
    tmPlayRef.current = setInterval(() => {
      setCommitIndex(prev => {
        const next = prev + 1
        if (next >= total - 1) {
          clearInterval(tmPlayRef.current); tmPlayRef.current = null
          setTmPlaying(false)
          const snap = tmSnapshotsRef.current[total - 1]
          if (snap) {
            const folders = graph ? new Set(graph.nodes.map(n => n.folder)).size : 0
            setTmCelebration(`🌌 Galaxy fully formed! ${snap.visible.size} files across ${folders} folders`)
            setTimeout(() => setTmCelebration(null), 4000)
          }
          return total - 1
        }
        return next
      })
    }, msPerCommit)
    return () => { if (tmPlayRef.current) clearInterval(tmPlayRef.current) }
  }, [tmPlaying, tmSpeed, graph])

  const copyToClipboard = useCallback(async (text, key) => {
    try { await navigator.clipboard.writeText(text); setCopiedBadge(key); setTimeout(() => setCopiedBadge(null), 2000) } catch { }
  }, [])

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    if (!graph) return
    const handler = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return
      if (e.ctrlKey || e.metaKey) return
      switch (e.key) {
        case "/": e.preventDefault(); setSearchOpen(true); setTimeout(() => searchInput.current?.focus(), 50); break
        case "Escape":
          if (searchOpen) { setSearchOpen(false); setSearchQuery("") }
          else if (roastOpen) setRoastOpen(false)
          else if (shortcutsOpen) setShortcutsOpen(false)
          else if (badgeOpen) setBadgeOpen(false)
          else if (embedOpen) setEmbedOpen(false)
          else if (timeMachineOpen) handleTimeMachineOpen()
          break
        case "f": case "F": e.preventDefault()
          document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { })
          break
        case "h": case "H": handleHealthToggle(); break
        case "a": case "A": handleActivityToggle(); break
        case "r": case "R": handleRoast(); break
        case "s": case "S": handleScreenshot(); break
        case "m": case "M": setShowMinimap(v => !v); break
        case "g": case "G": galaxyRef.current?.flyToDefault(); break
        case "t": case "T": handleTimeMachineOpen(); break
        case " ": e.preventDefault(); galaxyRef.current?.toggleRotation(); break
        case "1": case "2": case "3": case "4": case "5": case "6":
          galaxyRef.current?.flyToArm(parseInt(e.key)); break
        case "?": setShortcutsOpen(true); break
        default: break
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [graph, searchOpen, roastOpen, shortcutsOpen, badgeOpen, embedOpen, timeMachineOpen,
    handleHealthToggle, handleActivityToggle, handleRoast, handleScreenshot, handleTimeMachineOpen])

  // ── Constants for badge/embed ───────────────────────────────────────────
  const galleryUrl = typeof window !== "undefined" ? `${window.location.origin}/galaxy/${owner}/${repo}` : `https://yourdomain.com/galaxy/${owner}/${repo}`
  const badgeMd = `[![Codebase Galaxy](https://img.shields.io/badge/View-Codebase%20Galaxy-blueviolet?style=flat&logo=github)](${galleryUrl})`
  const badgeHtml = `<a href="${galleryUrl}"><img src="https://img.shields.io/badge/View-Codebase%20Galaxy-blueviolet?style=flat&logo=github" alt="Codebase Galaxy"></a>`
  const embedCode = `<iframe src="${typeof window !== "undefined" ? window.location.origin : "https://yourdomain.com"}/embed/${owner}/${repo}" width="800" height="500" frameborder="0" allowfullscreen></iframe>`

  // ── Loading ────────────────────────────────────────────────────────────
  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center font-mono gap-6"
        style={{ fontFamily: "var(--font-space-mono), monospace" }}>
        <div className="relative w-20 h-20">
          <div className="absolute inset-0 rounded-full border-2 border-blue-950" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-r-blue-700/50" style={{ animationDuration: "2.5s" }} />
        </div>
        <div className="text-center space-y-2">
          <div key={loadingPhase} className="text-blue-400 text-sm phase-in">{SCAN_PHASES[loadingPhase]}</div>
          <div className="text-gray-700 text-xs">{owner}/{repo}</div>
          {repoMeta?.description && (
            <div className="text-gray-600 text-xs max-w-xs leading-relaxed px-4">{repoMeta.description}</div>
          )}
          {repoMeta && (
            <div className="flex items-center justify-center gap-3 text-gray-700 text-xs mt-1">
              {repoMeta.language && <span>◈ {repoMeta.language}</span>}
              {repoMeta.stargazers_count > 0 && <span>★ {repoMeta.stargazers_count}</span>}
              {repoMeta.forks_count > 0 && <span>⑂ {repoMeta.forks_count}</span>}
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1 h-1 rounded-full bg-blue-700 animate-pulse" style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
      </div>
    )
  }

  // ── Error states ───────────────────────────────────────────────────────
  if (errorKey) {
    const msg = ERROR_MSGS[errorKey] ?? { text: `Error: ${errorKey}`, icon: "⚠️" }
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center font-mono gap-5 px-6">
        <div className="text-5xl">{msg.icon}</div>
        <div className="text-gray-300 text-sm text-center max-w-sm leading-relaxed">{msg.text}</div>
        <button onClick={() => router.push("/dashboard")} className="text-blue-500 hover:text-blue-400 text-xs underline mt-2">← Back to dashboard</button>
      </div>
    )
  }

  // ── Inline modal styles ────────────────────────────────────────────────
  const modalStyle = {
    background: "rgba(2,8,20,0.97)",
    border: "1px solid rgba(40,80,200,0.45)",
    boxShadow: "0 0 40px rgba(20,60,180,0.3)",
  }
  const roastModalStyle = {
    background: "rgba(20,4,4,0.97)",
    border: "1px solid rgba(200,40,40,0.5)",
    boxShadow: "0 0 40px rgba(180,20,20,0.3)",
  }

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">

      {/* ── Top-left breadcrumb ─────────────────────────────────────────── */}
      {!hideUI && (
        <div className="absolute top-4 left-4 z-10 font-mono pointer-events-none">
          <button onClick={() => router.push("/dashboard")}
            className="text-gray-600 hover:text-gray-400 text-xs mb-1.5 block pointer-events-auto transition-colors">
            ← dashboard
          </button>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-blue-400 text-sm font-bold">{owner} / {repo}</div>
            {repoMeta?.language && (
              <span className="text-xs px-1.5 py-0.5 rounded"
                style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.35)", color: "#a5b4fc" }}>
                {repoMeta.language}
              </span>
            )}
          </div>
          {graph?.truncated && (
            <div className="text-yellow-700 text-xs mt-1">Showing 300 of {graph.totalFiles} files (largest by size)</div>
          )}
        </div>
      )}

      {/* ── Top-right panel ─────────────────────────────────────────────── */}
      {!hideUI && (
        <div className="absolute top-4 right-4 z-10 font-mono max-w-[210px]"
          style={{ fontFamily: "var(--font-space-mono), monospace" }}>

          {/* Action buttons row — groups separated by slim dividers */}
          <div className="flex gap-1 mb-2 flex-wrap justify-end items-center">

            {/* Group 1: Screenshot + Video export */}
            <button onClick={handleScreenshot} disabled={screenshotBusy} title="Screenshot (S)"
              aria-label="Take screenshot"
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
              style={{
                background: "rgba(2,8,20,0.85)", border: "1px solid rgba(40,80,200,0.4)",
                color: screenshotBusy ? "#555" : "#8bb8ff"
              }}>
              <CameraIcon />{windowWidth >= 1200 && (screenshotBusy ? " …" : " Shot")}
            </button>

            <button onClick={() => setShowRecordModal(true)} title="Export Video"
              aria-label="Export video"
              disabled={isRecording}
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
              style={{
                background: isRecording ? "rgba(220,38,38,0.15)" : "rgba(2,8,20,0.85)",
                border: isRecording ? "1px solid rgba(220,38,38,0.5)" : "1px solid rgba(99,102,241,0.4)",
                color: isRecording ? "#f87171" : "#a5b4fc"
              }}>
              {isRecording ? "⏺" : "🎬"}{windowWidth >= 1200 && (isRecording ? " REC" : " Video")}
            </button>

            <span className="self-stretch w-px mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

            {/* Group 2: Health + Activity */}
            <div className="flex items-center gap-1">
              <button onClick={handleHealthToggle} title="Health Mode (H)"
                aria-label="Toggle health mode"
                className="px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                style={{
                  background: healthMode ? "rgba(34,197,94,0.15)" : "rgba(2,8,20,0.85)",
                  border: healthMode ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(40,80,200,0.4)",
                  color: healthMode ? "#4ade80" : "#8bb8ff"
                }}>
                🏥{windowWidth >= 1200 && ` ${healthMode ? "ON" : "Health"}`}
              </button>
              {windowWidth >= 1200 && (
                <InfoButton title="How Health Score Works">{`Each file is scored 0–100 based on:\n\n✅ +25  Has test/spec in filename\n✅ +15  Imported by many files\n✅ +10  Is an index barrel file\n✅ +10  Lives in utils/helpers\n❌ -15  No imports (isolated)\n❌ -20  Over 500 lines\n❌ -40  Over 1000 lines\n\nScore reflects code maintainability\nheuristics, not actual linting.`}</InfoButton>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={handleActivityToggle} title="Activity Mode (A)"
                aria-label="Toggle activity mode"
                className="px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
                style={{
                  background: activityOn ? "rgba(249,115,22,0.15)" : "rgba(2,8,20,0.85)",
                  border: activityOn ? "1px solid rgba(249,115,22,0.5)" : "1px solid rgba(40,80,200,0.4)",
                  color: activityOn ? "#fb923c" : "#8bb8ff"
                }}>
                🔥{windowWidth >= 1200 && ` ${activityLoading ? "…" : activityOn ? "ON" : "Activity"}`}
              </button>
              {windowWidth >= 1200 && (
                <InfoButton title="Activity Mode">{`Shows commit frequency over the\nlast 90 days per file.\n\n⚪ Inactive  — 0 recent commits\n🔵 Low       — 1–2 commits\n🟣 Moderate  — 3–5 commits\n🟠 Active    — 6–10 commits\n⚡ Hot       — 10+ commits\n\nData is fetched live from the\nGitHub API for the top 50 files.`}</InfoButton>
              )}
            </div>

            <span className="self-stretch w-px mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

            {/* Group 3: Search + Badge + Embed */}
            <button onClick={() => { setSearchOpen(o => !o); setTimeout(() => searchInput.current?.focus(), 50) }}
              title="Search (/)" aria-label="Open file search"
              className="px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
              style={{
                background: searchOpen ? "rgba(60,120,255,0.15)" : "rgba(2,8,20,0.85)",
                border: searchOpen ? "1px solid rgba(80,140,255,0.5)" : "1px solid rgba(40,80,200,0.4)",
                color: "#8bb8ff"
              }}>
              🔍
            </button>
            <button onClick={() => setBadgeOpen(true)} title="README Badge"
              aria-label="Get README badge"
              className="px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
              style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(40,80,200,0.4)", color: "#8bb8ff" }}>
              🏅
            </button>
            <button onClick={() => setEmbedOpen(true)} title="Embed"
              aria-label="Embed galaxy widget"
              className="px-2.5 h-8 rounded-lg text-xs transition-colors backdrop-blur-md"
              style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(40,80,200,0.4)", color: "#8bb8ff" }}>
              {"</>"}
            </button>

            <span className="self-stretch w-px mx-0.5" style={{ background: "rgba(255,255,255,0.07)" }} />

            {/* Group 4: Time Machine — purple accent */}
            <button onClick={handleTimeMachineOpen} title="Time Machine (T)"
              aria-label={timeMachineOpen ? "Exit time machine" : "Open time machine"}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-xs transition-all backdrop-blur-md"
              style={{
                background: timeMachineOpen ? "rgba(109,40,217,0.35)" : "rgba(60,20,120,0.22)",
                border: timeMachineOpen ? "1px solid rgba(139,92,246,0.8)" : "1px solid rgba(109,40,217,0.55)",
                color: "#c4b5fd",
                boxShadow: timeMachineOpen ? "0 0 16px rgba(139,92,246,0.5)" : "0 0 6px rgba(109,40,217,0.18)"
              }}>
              ⏱{windowWidth >= 1200 && ` ${timeMachineOpen ? "Exit TM" : "Time Machine"}`}
            </button>
          </div>

          {/* Legend panel */}
          {folderColors.length > 0 && (
            <div className="rounded-xl p-3 max-h-[65vh] overflow-y-auto backdrop-blur-md"
              style={{ background: "rgba(2,8,20,0.85)", border: "1px solid rgba(40,80,200,0.35)", boxShadow: "0 0 20px rgba(20,60,180,0.15)" }}>

              {/* Folder legend or health legend or TM author legend */}
              {timeMachineOpen && tmColorByAuthor ? (
                <>
                  <div className="text-gray-600 text-xs uppercase tracking-widest mb-2.5">By Author</div>
                  {tmAuthorLegend.map(({ author, color, files }) => (
                    <div key={author} className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-gray-400 text-xs truncate flex-1">{author}</span>
                      <span className="text-gray-700 text-xs">{files}</span>
                    </div>
                  ))}
                </>
              ) : healthMode ? (
                <>
                  <div className="text-gray-600 text-xs uppercase tracking-widest mb-2.5">Health</div>
                  {[
                    { label: "🟢 Healthy (90–100)", color: "#22c55e" },
                    { label: "🟡 Good (70–89)", color: "#84cc16" },
                    { label: "🟠 Fair (50–69)", color: "#eab308" },
                    { label: "🟠 Needs work (30–49)", color: "#f97316" },
                    { label: "🔴 Critical (0–29)", color: "#ef4444" },
                  ].map(({ label, color }) => (
                    <div key={label} className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-gray-400 text-xs">{label}</span>
                    </div>
                  ))}
                </>
              ) : activityOn ? (
                <>
                  <div className="text-gray-600 text-xs uppercase tracking-widest mb-2.5">Activity (90d)</div>
                  {[
                    { label: "⚪ Inactive (0)", color: "#444466" },
                    { label: "🔵 Low (1–2)", color: "#3b82f6" },
                    { label: "🟣 Moderate (3–5)", color: "#8b5cf6" },
                    { label: "🟠 Active (6–10)", color: "#f97316" },
                    { label: "⚡ Hot (10+)", color: "#ffffff" },
                  ].map(({ label, color }) => (
                    <div key={label} className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-gray-400 text-xs">{label}</span>
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <div className="text-gray-600 text-xs uppercase tracking-widest flex-1">Folders</div>
                    <InfoButton title="Folder Clusters">{`Each color represents a top-level\nfolder in the repository.\n\nFiles cluster together by folder\nalong spiral arms — closer to the\ncore means more interconnected.\n\nHover a folder name to see its\nconstellation outline.`}</InfoButton>
                  </div>
                  <div className="space-y-1">
                    {folderColors.map(({ folder, color }) => (
                      <div key={folder} className="flex items-center gap-2 rounded px-1.5 py-0.5 cursor-pointer transition-colors"
                        style={{ background: pinnedFolders.includes(folder) ? "rgba(40,80,200,0.18)" : hoveredFolder === folder ? "rgba(255,255,255,0.05)" : "transparent" }}
                        onMouseEnter={() => setHoveredFolder(folder)}
                        onMouseLeave={() => setHoveredFolder(null)}
                        onClick={() => togglePinFolder(folder)}
                        title={pinnedFolders.includes(folder) ? "Click to unpin constellation" : "Click to pin constellation"}>
                        <StarIcon color={color} />
                        <span className="text-gray-400 text-xs truncate flex-1">{folder}</span>
                        {pinnedFolders.includes(folder) && <span className="text-blue-400 text-xs">◉</span>}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* File types */}
              {!healthMode && !activityOn && fileTypes.length > 0 && (
                <>
                  <div className="text-gray-600 text-xs uppercase tracking-widest mt-4 mb-2.5 pt-3 border-t border-white/[0.06] flex items-center gap-1.5">
                    <span className="flex-1">File Types</span>
                    <InfoButton title="File Type Filter">{`Click any file type to isolate\nthose files in the galaxy view.\n\nAll other nodes dim to near-invisible\nso you can focus on a specific\nlayer of your codebase.\n\nClick again to reset.`}</InfoButton>
                  </div>
                  <div className="space-y-1.5">
                    {fileTypes.map(({ ext, count }) => (
                      <div key={ext} onClick={() => setFileTypeFilter(prev => prev === ext ? null : ext)}
                        className="cursor-pointer rounded px-1 py-0.5 transition-colors"
                        style={{ background: fileTypeFilter === ext ? "rgba(40,100,200,0.22)" : "transparent" }}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-gray-400 text-xs font-mono">.{ext}</span>
                          <span className="text-gray-600 text-xs">{count}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.07)" }}>
                          <div className="h-full rounded-full transition-all"
                            style={{
                              width: `${(count / maxFileTypeCount) * 100}%`,
                              background: fileTypeFilter === ext ? "rgba(80,160,255,0.9)" : "rgba(60,120,220,0.55)"
                            }} />
                        </div>
                      </div>
                    ))}
                    {fileTypeFilter && (
                      <button onClick={() => setFileTypeFilter(null)} className="text-xs text-gray-600 hover:text-gray-400 mt-1 transition-colors">✕ clear filter</button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      {searchOpen && !hideUI && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 font-mono w-80">
          <div className="rounded-xl overflow-hidden" style={{ ...modalStyle, padding: 0 }}>
            <div className="flex items-center px-4 py-2.5 gap-3">
              <span className="text-gray-600 text-sm">🔍</span>
              <input
                ref={searchInput}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search files and folders…"
                className="flex-1 bg-transparent outline-none text-white placeholder-gray-700 text-sm"
              />
              {searchQuery && (
                <button onClick={() => { setSearchQuery(""); setSearchOpen(false) }}
                  className="text-gray-600 hover:text-gray-400 text-xs transition-colors">✕</button>
              )}
            </div>
            {searchCount !== null && (
              <div className="px-4 pb-2.5 text-gray-600 text-xs">
                {searchCount === 0 ? "No matches" : `${searchCount} file${searchCount !== 1 ? "s" : ""} match`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stats bar: floating instrument panel ──────────────────────────── */}
      {stats && !hideUI && !timeMachineOpen && (
        <div className="absolute top-5 left-1/2 z-10 font-mono stats-bar-entry"
          style={{ fontFamily: "var(--font-space-mono), monospace" }}>

          {/* Benchmark popup */}
          {benchmarkStat && (
            <div className="mb-2 px-4 py-2 rounded-xl text-xs text-center backdrop-blur-md pointer-events-none"
              style={{
                background: "rgba(10,20,60,0.95)", border: "1px solid rgba(60,120,255,0.4)",
                color: "#93c5fd", maxWidth: 340, marginLeft: "auto", marginRight: "auto"
              }}>
              {benchmarkStat.text}
            </div>
          )}

          <div className="relative overflow-hidden rounded-xl flex items-stretch backdrop-blur-md"
            style={{
              background: "rgba(2,8,20,0.88)", border: "1px solid rgba(40,80,200,0.35)",
              boxShadow: "0 0 28px rgba(20,60,180,0.2), inset 0 1px 0 rgba(255,255,255,0.05)",
              height: 64, minWidth: windowWidth >= 900 ? 480 : 280
            }}>

            {/* Animated scanline */}
            <div className="scan-line absolute inset-x-0 h-px pointer-events-none z-10"
              style={{ background: "linear-gradient(to right, transparent, rgba(99,102,241,0.55), transparent)" }} />

            {/* Numeric stat sections */}
            {[
              { label: "FILES", value: statsCountUpValues.files, key: "files", sub: "total" },
              { label: "FOLDERS", value: statsCountUpValues.folders, key: "folders", sub: "total" },
              ...(windowWidth >= 900
                ? [{ label: "DEPS", value: statsCountUpValues.deps, key: "deps", sub: "cross-folder" }]
                : []),
            ].map(({ label, value, key, sub }) => (
              <div key={label}
                className="relative flex flex-col items-center justify-center px-5 cursor-pointer group transition-all"
                style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}
                title="Click to compare to average"
                onClick={() => {
                  const displayLabel = label.charAt(0) + label.slice(1).toLowerCase()
                  const text = benchmarkText(displayLabel, stats[key])
                  if (!text) return
                  setBenchmarkStat({ label: displayLabel, value: stats[key], text })
                  setTimeout(() => setBenchmarkStat(null), 4000)
                }}>
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                  style={{ background: "rgba(255,255,255,0.032)" }} />
                <div className="absolute bottom-0 inset-x-0 h-0.5 origin-center scale-x-0 group-hover:scale-x-100 transition-transform rounded-full pointer-events-none"
                  style={{ background: "rgba(99,102,241,0.75)" }} />
                <div className="relative z-10 text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>{label}</div>
                <div className="relative z-10 text-base font-bold tabular-nums group-hover:text-blue-200 transition-colors" style={{ color: "#fff" }}>{value}</div>
                <div className="relative z-10 text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>{sub}</div>
              </div>
            ))}

            {/* Most linked */}
            <div className="relative flex flex-col items-center justify-center px-5 group cursor-default"
              style={{ borderRight: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                style={{ background: "rgba(255,255,255,0.032)" }} />
              <div className="relative z-10 text-xs uppercase tracking-widest mb-0.5" style={{ color: "rgba(148,163,184,0.7)", letterSpacing: "0.12em" }}>MOST LINKED</div>
              <div className="relative z-10 text-sm font-bold truncate max-w-[110px] group-hover:text-white transition-colors" style={{ color: "#fff" }}>{stats.topFile}</div>
              <div className="relative z-10 flex items-center gap-1 text-xs" style={{ color: "rgba(148,163,184,0.5)" }}>
                <span>load-bearing</span>
                <InfoButton title="Most Linked File">{`This is the file that appears most\noften in import statements across\nyour codebase.\n\nA highly linked file is your\n"load-bearing wall" — changes here\nripple through many other files.\n\nWatch for single-file bottlenecks!`}</InfoButton>
              </div>
            </div>

            {/* Roast button integrated */}
            <div className="flex flex-col items-center justify-center px-4">
              <button onClick={handleRoast}
                className="text-xs px-3 py-1.5 rounded-lg transition-all"
                style={{
                  background: "rgba(80,20,10,0.5)", border: "1px solid rgba(200,60,20,0.4)",
                  color: "#fb923c", boxShadow: "0 0 8px rgba(200,60,20,0.12)"
                }}
                title="Roast My Repo (R)">
                🔥 Roast
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Time Machine panel ──────────────────────────────────────────── */}
      {timeMachineOpen && !hideUI && (
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20 font-mono tm-panel-open"
          style={{ width: "min(880px, calc(100vw - 48px))" }}>
          <div className="mx-4 mb-2 rounded-xl overflow-hidden backdrop-blur-md relative"
            style={{
              background: "rgba(5,0,20,0.93)", border: "1px solid rgba(109,40,217,0.5)",
              boxShadow: "0 -8px 40px rgba(139,92,246,0.2), inset 0 1px 40px rgba(139,92,246,0.1)",
              height: 160
            }}>

            {/* Animated scanline */}
            <div className="scan-line absolute inset-x-0 h-px pointer-events-none z-10"
              style={{ background: "linear-gradient(to right, transparent, rgba(139,92,246,0.6), transparent)" }} />

            {/* Loading */}
            {tmLoading && (
              <div className="flex items-center justify-center gap-3 h-full text-gray-500 text-xs">
                <div className="w-4 h-4 rounded-full border-2 border-purple-800 border-t-purple-400 animate-spin" />
                Fetching commit history…
              </div>
            )}

            {/* Error */}
            {tmError && !tmLoading && (
              <div className="flex flex-col items-center justify-center gap-3 h-full text-center px-6">
                <div className="text-red-400 text-xs leading-relaxed">{tmError}</div>
                <button onClick={fetchTmData}
                  className="text-xs px-3 py-1 rounded-lg"
                  style={{ background: "rgba(109,40,217,0.2)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
                  Retry
                </button>
              </div>
            )}

            {/* Main 3-column layout */}
            {tmData && !tmLoading && !tmError && (() => {
              const total = tmData.commits.length
              const commit = tmData.commits[commitIndex]
              const date = commit?.date
                ? new Date(commit.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                : ""
              const scrubPct = total > 1 ? (commitIndex / (total - 1)) * 100 : 0
              return (
                <div className="h-full"
                  style={{
                    display: "grid",
                    gridTemplateColumns: windowWidth >= 900 ? "280px 1fr 200px" : "1fr"
                  }}>

                  {/* ── LEFT: Commit card ──────────────────────────────────── */}
                  <div className="flex flex-col justify-center px-4 py-3 overflow-hidden"
                    style={{ borderRight: "1px solid rgba(109,40,217,0.2)" }}>
                    <div className="flex items-center gap-2 mb-1 min-w-0">
                      <span className="text-purple-500 text-xs font-mono flex-shrink-0">
                        {(commit?.sha ?? "").slice(0, 7)}
                      </span>
                      <span className="text-white text-xs font-semibold truncate">
                        {(commit?.message ?? "No message").slice(0, 38)}
                        {(commit?.message?.length ?? 0) > 38 ? "…" : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs mb-1.5" style={{ color: "#6b7280" }}>
                      {commit?.author && <span className="truncate max-w-[100px]">{commit.author}</span>}
                      {date && <span className="flex-shrink-0" style={{ color: "#4b5563" }}>{date}</span>}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      {(commit?.filesAdded?.length > 0) && <span className="text-green-500  text-xs">+{commit.filesAdded.length}</span>}
                      {(commit?.filesRemoved?.length > 0) && <span className="text-red-500    text-xs">-{commit.filesRemoved.length}</span>}
                      {(commit?.filesModified?.length > 0) && <span className="text-yellow-600 text-xs">~{commit.filesModified.length}</span>}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: "#4b5563" }}>
                      <span>{commitIndex + 1} / {total}</span>
                      {(commit?.totalFilesAtThisPoint ?? 0) > 0 && (
                        <span style={{ color: "#581c87" }}>{commit.totalFilesAtThisPoint} files</span>
                      )}
                      {tmData.sampled && (
                        <span className="text-xs px-1 rounded"
                          style={{ background: "rgba(109,40,217,0.18)", color: "#7c3aed", fontSize: 10 }}>
                          sampled
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── CENTER: Histogram + Scrubber + Controls ────────────── */}
                  <div className="flex flex-col px-4 py-2.5 min-w-0">

                    {/* Commit density histogram */}
                    {tmHistogramData.length > 0 && (
                      <div className="flex items-end gap-px mb-1.5 flex-shrink-0" style={{ height: 28 }}>
                        {tmHistogramData.map((bar, i) => {
                          const near = Math.abs(commitIndex - bar.commitIndex) < Math.max(total / 100 * 2, 1)
                          return (
                            <div key={i}
                              className="flex-1 cursor-pointer transition-opacity"
                              style={{
                                height: `${bar.heightPct}%`,
                                background: bar.net >= 0 ? "rgba(34,197,94,0.7)" : "rgba(239,68,68,0.7)",
                                opacity: near ? 1 : 0.35,
                                minWidth: 1
                              }}
                              onClick={() => { setCommitIndex(bar.commitIndex); setTmPlaying(false) }}
                              title={`${bar.net >= 0 ? "+" : ""}${bar.net} net files`} />
                          )
                        })}
                      </div>
                    )}

                    {/* Custom scrubber */}
                    <input type="range"
                      min={0} max={Math.max(0, total - 1)} value={commitIndex}
                      onChange={e => { setCommitIndex(Number(e.target.value)); setTmPlaying(false) }}
                      className="tm-scrubber w-full cursor-pointer mb-2 flex-shrink-0"
                      style={{ "--val": `${scrubPct}%` }}
                    />

                    {/* Transport controls */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button onClick={() => { setCommitIndex(0); setTmPlaying(false) }}
                        className="text-xs px-2 h-6 rounded transition-colors"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}
                        title="First commit">|◀</button>
                      <button onClick={() => { setCommitIndex(i => Math.max(0, i - 1)); setTmPlaying(false) }}
                        className="text-xs px-2 h-6 rounded transition-colors"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}
                        title="Previous commit">◀</button>
                      <button onClick={() => setTmPlaying(v => !v)}
                        className="text-xs px-3 h-6 rounded-lg transition-all font-semibold"
                        style={{
                          background: tmPlaying ? "rgba(139,92,246,0.3)" : "rgba(109,40,217,0.2)",
                          border: "1px solid rgba(139,92,246,0.55)", color: "#c4b5fd",
                          boxShadow: tmPlaying ? "0 0 10px rgba(139,92,246,0.4)" : undefined
                        }}>
                        {tmPlaying ? "⏸ Pause" : "▶ Play"}
                      </button>
                      <button onClick={() => { setCommitIndex(i => Math.min(total - 1, i + 1)); setTmPlaying(false) }}
                        className="text-xs px-2 h-6 rounded transition-colors"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}
                        title="Next commit">▶</button>
                      <button onClick={() => { setCommitIndex(total - 1); setTmPlaying(false) }}
                        className="text-xs px-2 h-6 rounded transition-colors"
                        style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}
                        title="Last commit">▶|</button>

                      {/* Speed pills */}
                      <div className="flex gap-0.5 ml-1">
                        {[0.5, 1, 2, 4].map(s => (
                          <button key={s} onClick={() => setTmSpeed(s)}
                            className="text-xs px-1.5 h-6 rounded transition-all"
                            style={{
                              background: tmSpeed === s ? "rgba(139,92,246,0.3)" : "rgba(30,10,60,0.5)",
                              border: tmSpeed === s ? "1px solid rgba(139,92,246,0.65)" : "1px solid rgba(109,40,217,0.3)",
                              color: tmSpeed === s ? "#c4b5fd" : "#7c3aed"
                            }}>
                            {s}×
                          </button>
                        ))}
                      </div>

                      {/* Jump to big bang commits */}
                      {tmBigBangCommits.length > 0 && (
                        <select defaultValue=""
                          onChange={e => { if (e.target.value !== "") { setCommitIndex(Number(e.target.value)); setTmPlaying(false) } }}
                          className="text-xs rounded px-1.5 h-6 ml-1 cursor-pointer"
                          style={{
                            background: "rgba(30,10,60,0.8)", border: "1px solid rgba(109,40,217,0.4)",
                            color: "#a78bfa", outline: "none", maxWidth: 120
                          }}>
                          <option value="">Jump…</option>
                          {tmBigBangCommits.map(c => (
                            <option key={c.sha} value={c.index}>
                              +{c.addCount}: {c.message.slice(0, 22)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  {/* ── RIGHT: Color mode cards (200px) ───────────────────── */}
                  {windowWidth >= 900 && (
                    <div className="flex flex-col justify-center gap-2 px-4 py-3"
                      style={{ borderLeft: "1px solid rgba(109,40,217,0.2)" }}>
                      <div className="text-xs uppercase tracking-widest mb-0.5" style={{ color: "#374151", letterSpacing: "0.15em" }}>Color by</div>
                      {[
                        { key: false, label: "Folder", sub: "by directory" },
                        { key: true, label: "Author", sub: "by committer" },
                      ].map(({ key, label, sub }) => (
                        <button key={String(key)}
                          onClick={() => setTmColorByAuthor(key)}
                          className="flex flex-col items-start px-3 py-2 rounded-lg text-left transition-all"
                          style={{
                            background: tmColorByAuthor === key
                              ? "rgba(109,40,217,0.28)" : "rgba(255,255,255,0.02)",
                            border: tmColorByAuthor === key
                              ? "1px solid rgba(139,92,246,0.55)" : "1px solid rgba(255,255,255,0.06)",
                            boxShadow: tmColorByAuthor === key
                              ? "0 0 10px rgba(109,40,217,0.22)" : undefined
                          }}>
                          <span className="text-xs font-semibold"
                            style={{ color: tmColorByAuthor === key ? "#c4b5fd" : "#6b7280" }}>
                            {label}
                          </span>
                          <span className="text-xs"
                            style={{ color: tmColorByAuthor === key ? "#a78bfa" : "#374151" }}>
                            {sub}
                          </span>
                        </button>
                      ))}

                      {/* Author legend when color-by-author active */}
                      {tmColorByAuthor && tmAuthorLegend.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {tmAuthorLegend.slice(0, 4).map(({ color, author }) => (
                            <div key={author} className="flex items-center gap-1.5 text-xs" style={{ color: "#6b7280" }}>
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                              <span className="truncate" style={{ maxWidth: 120 }}>{author}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Controls hint ───────────────────────────────────────────────── */}
      {!hideUI && (
        <div className="absolute left-4 z-10 font-mono text-gray-700 text-xs pointer-events-none space-y-0.5"
          style={{ bottom: "196px" }}>
          <div>drag to orbit • scroll to zoom</div>
          <div>click for details • double-click to zoom</div>
        </div>
      )}

      {/* ── ? Shortcuts button ───────────────────────────────────────────── */}
      {!hideUI && (
        <button onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)"
          className="absolute bottom-24 right-4 z-20 w-8 h-8 rounded-full font-mono text-sm
                           transition-colors flex items-center justify-center"
          style={{ background: "rgba(2,8,20,0.8)", border: "1px solid rgba(40,80,200,0.35)", color: "#8bb8ff" }}>
          ?
        </button>
      )}

      {/* ── Toast ───────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 font-mono text-xs px-5 py-2.5 rounded-xl backdrop-blur-md pointer-events-none"
          style={{ background: "rgba(10,30,80,0.92)", border: "1px solid rgba(40,120,255,0.5)", boxShadow: "0 0 20px rgba(20,80,200,0.4)", color: "#8bb8ff" }}>
          ✓ {toast}
        </div>
      )}

      {/* ── Easter egg toast ────────────────────────────────────────────── */}
      {eggToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 font-mono text-xs px-5 py-2.5 rounded-xl backdrop-blur-md pointer-events-none"
          style={{ background: "rgba(30,5,50,0.95)", border: "1px solid rgba(160,80,255,0.6)", boxShadow: "0 0 24px rgba(120,40,200,0.5)", color: "#e879f9" }}>
          🎮 {eggToast}
        </div>
      )}

      {/* ── Recording indicator ──────────────────────────────────────────── */}
      {isRecording && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-full font-mono text-xs pointer-events-none"
          style={{ background: "rgba(5,0,0,0.9)", border: "1px solid rgba(220,38,38,0.5)", color: "#f87171" }}>
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          REC {Math.round(recordProgress * recordDuration)}s / {recordDuration}s
          <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-full bg-red-500 transition-all" style={{ width: `${recordProgress * 100}%` }} />
          </div>
        </div>
      )}
      {recordDone && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full font-mono text-xs pointer-events-none"
          style={{ background: "rgba(2,20,10,0.9)", border: "1px solid rgba(34,197,94,0.5)", color: "#4ade80" }}>
          ✅ Video saved! Share it on social media 🚀
        </div>
      )}

      {/* ── Video Export Modal ───────────────────────────────────────────── */}
      {showRecordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowRecordModal(false)}>
          <div className="rounded-2xl p-6 max-w-sm w-full mx-4"
            style={{
              background: "rgba(5,10,25,0.98)", border: "1px solid rgba(40,80,200,0.4)",
              boxShadow: "0 0 40px rgba(20,60,180,0.3)", fontFamily: "var(--font-space-mono),monospace"
            }}
            onClick={e => e.stopPropagation()}>
            <div className="text-white font-bold text-lg mb-1">🎬 Export Your Galaxy Video</div>
            <div className="text-gray-500 text-xs mb-5">Perfect for Instagram Reels and TikTok.</div>

            <div className="mb-4">
              <div className="text-gray-400 text-xs mb-2 uppercase tracking-wider">Duration</div>
              <div className="flex gap-2">
                {[5, 8, 12].map(d => (
                  <button key={d} onClick={() => setRecordDuration(d)}
                    className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                    style={{
                      background: recordDuration === d ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.04)",
                      border: `1px solid ${recordDuration === d ? "rgba(99,102,241,0.6)" : "rgba(255,255,255,0.08)"}`,
                      color: recordDuration === d ? "#a5b4fc" : "#6b7280"
                    }}>
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            <p className="text-gray-600 text-xs mb-5 leading-relaxed">
              ℹ️ A rotating view of your galaxy will be recorded at {recordDuration}s.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setShowRecordModal(false)}
                className="flex-1 py-2.5 rounded-lg text-sm text-gray-500 transition-colors hover:text-gray-300"
                style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                Cancel
              </button>
              <button onClick={() => handleStartRecording(recordDuration, "720p")}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
                style={{ background: "rgba(99,102,241,0.7)", border: "1px solid rgba(99,102,241,0.5)" }}>
                🎬 Start Recording
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Time Machine: celebration toast ──────────────────────────────── */}
      {tmCelebration && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 font-mono text-sm px-8 py-5 rounded-2xl backdrop-blur-md text-center pointer-events-none"
          style={{
            background: "rgba(20,5,40,0.97)", border: "1px solid rgba(139,92,246,0.7)",
            boxShadow: "0 0 40px rgba(109,40,217,0.6)", color: "#e9d5ff", maxWidth: 360
          }}>
          {tmCelebration}
        </div>
      )}

      {/* ── Time Machine: first-commit intro overlay ─────────────────────── */}
      {tmShowIntro && tmData?.commits?.[0] && (() => {
        const fc = tmData.commits[0]
        return (
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 font-mono text-center pointer-events-none"
            style={{
              background: "rgba(15,5,30,0.97)", border: "1px solid rgba(139,92,246,0.8)",
              boxShadow: "0 0 60px rgba(109,40,217,0.7)", color: "#e9d5ff",
              borderRadius: 16, padding: "28px 36px", maxWidth: 380,
              animation: "tmIntroFade 2.5s ease forwards"
            }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>🌱</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#c084fc", marginBottom: 6 }}>
              In the beginning…
            </div>
            <div style={{ fontSize: 12, color: "#d8b4fe", marginBottom: 10, lineHeight: 1.5 }}>
              {fc.message}
            </div>
            <div style={{ fontSize: 11, color: "#a78bfa", marginBottom: 4 }}>
              by {fc.author}
            </div>
            <div style={{ fontSize: 11, color: "#7c3aed" }}>
              {fc.date ? new Date(fc.date).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}
            </div>
            {(fc.filesAdded?.length ?? 0) > 0 && (
              <div style={{ marginTop: 10, fontSize: 11, color: "#86efac" }}>
                +{fc.filesAdded.length} file{fc.filesAdded.length !== 1 ? "s" : ""} born
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Time Machine: transient commit card (top-center) ─────────────── */}
      {timeMachineOpen && tmCardVisible && tmData?.commits?.[commitIndex] && (() => {
        const c = tmData.commits[commitIndex]
        const added = c.filesAdded?.length ?? 0
        const modified = c.filesModified?.length ?? 0
        const removed = c.filesRemoved?.length ?? 0
        return (
          <div className="fixed z-40 font-mono pointer-events-none"
            style={{
              top: 16, left: "50%", transform: "translateX(-50%)",
              background: "rgba(10,5,25,0.88)", border: "1px solid rgba(139,92,246,0.45)",
              boxShadow: "0 2px 20px rgba(80,30,160,0.35)", borderRadius: 10,
              padding: "9px 18px", minWidth: 280, maxWidth: 420,
              opacity: tmCardVisible ? 1 : 0,
              transition: "opacity 0.4s ease"
            }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ color: "#7c3aed", fontSize: 10 }}>{c.sha?.slice(0, 7)}</span>
              <span style={{
                color: "#c084fc", fontSize: 11, flex: 1, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap"
              }}>
                {c.message?.slice(0, 60)}{(c.message?.length ?? 0) > 60 ? "…" : ""}
              </span>
            </div>
            <div style={{ display: "flex", gap: 12, fontSize: 10, color: "#a78bfa" }}>
              <span>{c.author}</span>
              <span style={{ color: "#6d28d9" }}>
                {c.date ? new Date(c.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}
              </span>
              {added > 0 && <span style={{ color: "#4ade80" }}>+{added}</span>}
              {modified > 0 && <span style={{ color: "#facc15" }}>~{modified}</span>}
              {removed > 0 && <span style={{ color: "#f87171" }}>-{removed}</span>}
            </div>
          </div>
        )
      })()}

      {/* ── Star nudge ──────────────────────────────────────────────────── */}
      {starNudge && (
        <div className="fixed bottom-8 right-4 z-50 font-mono text-xs rounded-xl p-4 backdrop-blur-md max-w-[240px]"
          style={{ background: "rgba(10,15,30,0.92)", border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
          <button onClick={() => setStarNudge(false)} className="absolute top-2 right-2 text-gray-600 hover:text-gray-400">✕</button>
          <div className="text-yellow-400 mb-1.5">✨ Enjoying your galaxy?</div>
          <div className="text-gray-400 text-xs mb-2.5 leading-relaxed">Star Codebase Galaxy on GitHub</div>
          <a href="https://github.com/search?q=codebase+galaxy&type=repositories" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: "rgba(30,40,70,0.8)", border: "1px solid rgba(255,255,255,0.15)", color: "#e2e8f0" }}>
            ⭐ Star on GitHub
          </a>
        </div>
      )}

      {/* ── DNA strip ───────────────────────────────────────────────────── */}
      {!hideUI && dnaColors.length > 0 && (
        <>
          <DnaStrip colors={dnaColors} />
          <div className="absolute z-20 right-2" style={{ bottom: "58px" }}>
            <InfoButton title="DNA Fingerprint">{`This 32-segment color bar is your\nrepo's unique DNA fingerprint.\n\nEach segment encodes a structural\nproperty: file count, folder count,\nlargest files, and folder sizes.\n\nTwo repos with similar architecture\nwill have similar DNA patterns.`}</InfoButton>
          </div>
        </>
      )}

      {/* ── ROAST MODAL ──────────────────────────────────────────────────── */}
      {roastOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm">
          <div className="relative font-mono max-w-lg w-full rounded-2xl p-6" style={roastModalStyle}>
            <button onClick={() => setRoastOpen(false)}
              className="absolute top-4 right-4 text-gray-600 hover:text-gray-400 text-xs transition-colors">✕</button>
            <div className="text-red-400 font-bold text-lg mb-4">🔥 Repo Roasted</div>
            {roastLoading ? (
              <div className="text-gray-600 text-sm animate-pulse">Preparing the roast…</div>
            ) : (
              <div className="text-gray-300 text-sm leading-loose whitespace-pre-wrap">{roastDisplayed}</div>
            )}
            {!roastLoading && roastText && (
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => copyToClipboard(`${roastText}\n\n🌌 Visualize: ${galleryUrl}`, "roast")}
                  className="flex-1 text-xs py-2 rounded-lg transition-colors"
                  style={{ background: "rgba(80,20,10,0.4)", border: "1px solid rgba(200,60,20,0.4)", color: "#fb923c" }}>
                  {copiedBadge === "roast" ? "Copied!" : "Share Roast 🔥"}
                </button>
                <button onClick={() => setRoastOpen(false)}
                  className="flex-1 text-xs py-2 rounded-lg transition-colors text-gray-500 hover:text-gray-300"
                  style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                  I survived the roast
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SHORTCUTS MODAL ──────────────────────────────────────────────── */}
      {shortcutsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm">
          <div className="relative font-mono max-w-md w-full rounded-2xl p-6" style={modalStyle}>
            <button onClick={() => setShortcutsOpen(false)}
              className="absolute top-4 right-4 text-gray-600 hover:text-gray-400 text-xs">✕</button>
            <div className="text-blue-300 font-bold mb-5">⌨️ Keyboard Shortcuts</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                ["/", "Open search"],
                ["Esc", "Close / deselect"],
                ["H", "Toggle Health Mode"],
                ["A", "Toggle Activity Mode"],
                ["T", "Time Machine"],
                ["S", "Screenshot"],
                ["R", "Roast my repo"],
                ["G", "Fly to galaxy center"],
                ["Space", "Pause/resume rotation"],
                ["M", "Toggle minimap"],
                ["F", "Toggle fullscreen"],
                ["1–6", "Fly to spiral arm"],
                ["?", "This help screen"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2">
                  <kbd className="text-xs px-1.5 py-0.5 rounded font-mono"
                    style={{ background: "rgba(40,80,200,0.2)", border: "1px solid rgba(40,80,200,0.4)", color: "#8bb8ff", minWidth: "36px", textAlign: "center" }}>
                    {key}
                  </kbd>
                  <span className="text-gray-500 text-xs">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── BADGE MODAL ──────────────────────────────────────────────────── */}
      {badgeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm">
          <div className="relative font-mono max-w-lg w-full rounded-2xl p-6" style={modalStyle}>
            <button onClick={() => setBadgeOpen(false)}
              className="absolute top-4 right-4 text-gray-600 hover:text-gray-400 text-xs">✕</button>
            <div className="text-blue-300 font-bold mb-5">🏅 README Badge</div>
            <div className="mb-4">
              <img src={`https://img.shields.io/badge/View-Codebase%20Galaxy-blueviolet?style=flat&logo=github`} alt="Badge preview" className="mb-3" />
              <div className="text-gray-600 text-xs mb-1.5">Markdown</div>
              <div className="text-xs p-3 rounded-lg mb-2 break-all text-green-400 font-mono leading-relaxed"
                style={{ background: "rgba(0,20,10,0.5)", border: "1px solid rgba(40,160,80,0.2)" }}>
                {badgeMd}
              </div>
              <button onClick={() => copyToClipboard(badgeMd, "md")}
                className="w-full text-xs py-1.5 rounded-lg transition-colors mb-4"
                style={{ background: "rgba(10,30,60,0.6)", border: "1px solid rgba(40,80,200,0.35)", color: copiedBadge === "md" ? "#4ade80" : "#8bb8ff" }}>
                {copiedBadge === "md" ? "✓ Copied!" : "Copy Markdown"}
              </button>
              <div className="text-gray-600 text-xs mb-1.5">HTML</div>
              <div className="text-xs p-3 rounded-lg mb-2 break-all text-blue-300 font-mono leading-relaxed"
                style={{ background: "rgba(0,10,30,0.5)", border: "1px solid rgba(40,80,200,0.2)" }}>
                {badgeHtml}
              </div>
              <button onClick={() => copyToClipboard(badgeHtml, "html")}
                className="w-full text-xs py-1.5 rounded-lg transition-colors"
                style={{ background: "rgba(10,30,60,0.6)", border: "1px solid rgba(40,80,200,0.35)", color: copiedBadge === "html" ? "#4ade80" : "#8bb8ff" }}>
                {copiedBadge === "html" ? "✓ Copied!" : "Copy HTML"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EMBED MODAL ───────────────────────────────────────────────────── */}
      {embedOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/60 backdrop-blur-sm">
          <div className="relative font-mono max-w-lg w-full rounded-2xl p-6" style={modalStyle}>
            <button onClick={() => setEmbedOpen(false)}
              className="absolute top-4 right-4 text-gray-600 hover:text-gray-400 text-xs">✕</button>
            <div className="text-blue-300 font-bold mb-5">&lt;/&gt; Embed Galaxy</div>
            <div className="text-gray-600 text-xs mb-2">Copy this iframe into your README or blog:</div>
            <div className="text-xs p-3 rounded-lg mb-3 break-all text-blue-300 font-mono leading-relaxed"
              style={{ background: "rgba(0,10,30,0.5)", border: "1px solid rgba(40,80,200,0.2)" }}>
              {embedCode}
            </div>
            <button onClick={() => copyToClipboard(embedCode, "embed")}
              className="w-full text-xs py-1.5 rounded-lg transition-colors"
              style={{ background: "rgba(10,30,60,0.6)", border: "1px solid rgba(40,80,200,0.35)", color: copiedBadge === "embed" ? "#4ade80" : "#8bb8ff" }}>
              {copiedBadge === "embed" ? "✓ Copied!" : "Copy iframe code"}
            </button>
            <div className="mt-4 pt-4 border-t border-white/[0.06] text-gray-700 text-xs leading-relaxed">
              The embedded view works as a standalone fullscreen galaxy with minimal UI.
            </div>
          </div>
        </div>
      )}

      {graph && (
        <GalaxyCanvas
          ref={galaxyRef}
          nodes={graph.nodes}
          edges={graph.edges}
          owner={owner}
          repo={repo}
          hoveredFolder={hoveredFolder}
          pinnedFolders={pinnedFolders}
          fileTypeFilter={fileTypeFilter}
          hideUI={hideUI}
          healthMode={healthMode}
          activityData={activityOn ? activityData : null}
          searchQuery={searchOpen ? searchQuery : ""}
          onSearchResults={setSearchCount}
          showMinimap={showMinimap && windowWidth >= 900}
          onEasterEggToast={handleEasterEggToast}
          timeMachineVisible={tmVisible}
          timeMachineSpawn={tmSpawn}
          timeMachineModify={tmModify}
          timeMachineRemove={tmRemove}
          timeMachineAuthorColors={tmColorByAuthor ? tmAuthorColors : null}
        />
      )}

      {/* ── Guided tour (first-time visitors) ───────────────────────────── */}
      {showTour && graph && (
        <GalaxyTour onDone={() => setShowTour(false)} />
      )}
    </div>
  )
}
