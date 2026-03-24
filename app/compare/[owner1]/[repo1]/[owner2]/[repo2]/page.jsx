"use client"
import { useSession } from "next-auth/react"
import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import GalaxyCanvas from "@/components/GalaxyCanvas"

async function fetchGraph(owner, repo) {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner, repo }),
  })
  const data = await res.json()
  if (!res.ok || !data.nodes?.length) return null
  return data
}

function StatCell({ label, a, b }) {
  const aNum = typeof a === "number" ? a : null
  const bNum = typeof b === "number" ? b : null
  const aWins = aNum !== null && bNum !== null && aNum > bNum
  const bWins = aNum !== null && bNum !== null && bNum > aNum
  return (
    <div className="text-center">
      <div className="text-gray-600 text-xs mb-1">{label}</div>
      <div className="flex items-center gap-2 justify-center">
        <span className="text-sm font-bold" style={{ color: aWins ? "#4ade80" : "#e2e8f0" }}>{a ?? "—"}</span>
        <span className="text-gray-700 text-xs">vs</span>
        <span className="text-sm font-bold" style={{ color: bWins ? "#4ade80" : "#e2e8f0" }}>{b ?? "—"}</span>
      </div>
    </div>
  )
}

export default function ComparePage() {
  const params = useParams()
  const { owner1, repo1, owner2, repo2 } = params
  const { data: session, status } = useSession()
  const router = useRouter()

  const [graph1, setGraph1] = useState(null)
  const [graph2, setGraph2] = useState(null)
  const [loading1, setLoading1] = useState(true)
  const [loading2, setLoading2] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/")
  }, [status, router])

  useEffect(() => {
    if (!session) return
    fetchGraph(owner1, repo1).then(g => { setGraph1(g); setLoading1(false) })
    fetchGraph(owner2, repo2).then(g => { setGraph2(g); setLoading2(false) })
  }, [session, owner1, repo1, owner2, repo2])

  const loading = loading1 || loading2

  // Stats for each repo
  const stats1 = graph1 ? {
    files:   graph1.nodes.length,
    folders: new Set(graph1.nodes.map(n => n.folder)).size,
    deps:    graph1.edges.length,
  } : null
  const stats2 = graph2 ? {
    files:   graph2.nodes.length,
    folders: new Set(graph2.nodes.map(n => n.folder)).size,
    deps:    graph2.edges.length,
  } : null

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center font-mono gap-4">
        <div className="relative w-16 h-16">
          <div className="absolute inset-0 rounded-full border-2 border-blue-950" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 animate-spin" />
        </div>
        <div className="text-blue-400 text-sm">
          {loading1 && loading2 ? "Loading both repositories…" : loading1 ? `Loading ${owner1}/${repo1}…` : `Loading ${owner2}/${repo2}…`}
        </div>
      </div>
    )
  }

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex flex-col font-mono">

      {/* ── Top stats bar ────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center justify-between px-6 py-3 z-20"
        style={{
          background: "rgba(2,8,20,0.95)",
          borderBottom: "1px solid rgba(40,80,200,0.35)",
          boxShadow: "0 2px 20px rgba(10,30,120,0.3)",
        }}
      >
        {/* Back button */}
        <button
          onClick={() => router.push("/dashboard")}
          className="text-gray-600 hover:text-gray-400 text-xs transition-colors mr-6"
        >
          ← dashboard
        </button>

        {/* Repo 1 label */}
        <div className="text-blue-300 text-sm font-bold min-w-0 truncate flex-1 text-right pr-4">
          {owner1}/{repo1}
        </div>

        {/* Stats comparison */}
        <div className="flex items-center gap-6 flex-shrink-0 px-4"
             style={{ borderLeft: "1px solid rgba(40,80,200,0.2)", borderRight: "1px solid rgba(40,80,200,0.2)" }}>
          <StatCell label="Files"   a={stats1?.files}   b={stats2?.files} />
          <StatCell label="Folders" a={stats1?.folders} b={stats2?.folders} />
          <StatCell label="Deps"    a={stats1?.deps}    b={stats2?.deps} />
        </div>

        {/* Repo 2 label */}
        <div className="text-purple-300 text-sm font-bold min-w-0 truncate flex-1 text-left pl-4">
          {owner2}/{repo2}
        </div>
      </div>

      {/* ── Side-by-side galaxies ─────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left galaxy */}
        <div
          className="relative overflow-hidden"
          style={{ width: "50%", borderRight: "1px solid rgba(40,80,200,0.25)" }}
        >
          {/* Left header overlay */}
          <div className="absolute top-3 left-3 z-10 pointer-events-none">
            <div className="text-blue-300 text-xs font-bold backdrop-blur-sm px-2 py-1 rounded"
                 style={{ background: "rgba(2,8,20,0.7)", border: "1px solid rgba(40,80,200,0.3)" }}>
              {owner1} / {repo1}
            </div>
          </div>
          {graph1 ? (
            <GalaxyCanvas
              nodes={graph1.nodes}
              edges={graph1.edges}
              owner={owner1}
              repo={repo1}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-gray-700 text-sm">Failed to load {repo1}</span>
            </div>
          )}
        </div>

        {/* Right galaxy */}
        <div className="relative overflow-hidden" style={{ width: "50%" }}>
          {/* Right header overlay */}
          <div className="absolute top-3 right-3 z-10 pointer-events-none">
            <div className="text-purple-300 text-xs font-bold backdrop-blur-sm px-2 py-1 rounded"
                 style={{ background: "rgba(2,8,20,0.7)", border: "1px solid rgba(80,40,200,0.3)" }}>
              {owner2} / {repo2}
            </div>
          </div>
          {graph2 ? (
            <GalaxyCanvas
              nodes={graph2.nodes}
              edges={graph2.edges}
              owner={owner2}
              repo={repo2}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-gray-700 text-sm">Failed to load {repo2}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
