"use client"
import { useEffect, useState, useRef } from "react"

const STEPS = [
  {
    cx: 0.50, cy: 0.46, r: 88,
    title: "Your Galactic Core",
    body: "This is your galactic core — the most\nimported file in your entire codebase.\nEverything orbits around it.",
  },
  {
    cx: 0.30, cy: 0.34, r: 110,
    title: "Spiral Arms = Folders",
    body: "Each spiral arm is a top-level folder.\nFiles cluster together by where they\nlive in the repository.",
  },
  {
    cx: 0.60, cy: 0.54, r: 72,
    title: "Planet Size = File Size",
    body: "Bigger planets = bigger files.\nSpot your largest files instantly —\nthey might need some trimming.",
  },
  {
    cx: 0.48, cy: 0.43, r: 130,
    title: "Arcs = Import Dependencies",
    body: "These arcs are import connections.\nThe more lines touching a planet,\nthe more your code depends on it.",
  },
  {
    cx: 0.87, cy: 0.36, r: 115,
    title: "Explore & Analyze",
    body: "Use Health Mode, Activity Mode, and\nSearch to explore your codebase.\nPress ? anytime for keyboard shortcuts.",
  },
]

export default function GalaxyTour({ onDone }) {
  const [step,       setStep]       = useState(0)
  const [visible,    setVisible]    = useState(false)
  const [noMore,     setNoMore]     = useState(false)
  const [spotPos,    setSpotPos]    = useState({ cx: 0, cy: 0, r: 88 })
  const animRef = useRef(null)

  // Mount after a 1.2s delay (let cinematic intro finish)
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 1200)
    return () => clearTimeout(t)
  }, [])

  // Update spotlight position whenever step changes
  useEffect(() => {
    if (!visible) return
    const s = STEPS[step]
    const cx = s.cx * window.innerWidth
    const cy = s.cy * window.innerHeight
    setSpotPos({ cx, cy, r: s.r })
  }, [step, visible])

  // Recalculate on resize
  useEffect(() => {
    const handler = () => {
      const s = STEPS[step]
      setSpotPos({ cx: s.cx * window.innerWidth, cy: s.cy * window.innerHeight, r: s.r })
    }
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [step])

  const cur = STEPS[step]
  const isLast = step === STEPS.length - 1

  const finish = () => {
    if (noMore) localStorage.setItem("galaxy_toured", "1")
    setVisible(false)
    onDone?.()
  }

  const next = () => {
    if (isLast) { finish(); return }
    setStep(s => s + 1)
  }

  const prev = () => setStep(s => Math.max(0, s - 1))

  if (!visible) return null

  const { cx, cy, r } = spotPos

  return (
    <>
      {/* Click-blocker backdrop (prevents galaxy interaction during tour) */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 8998 }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Spotlight circle — box-shadow creates the dark overlay outside */}
      <div
        style={{
          position: "fixed",
          zIndex: 8999,
          pointerEvents: "none",
          width:  r * 2,
          height: r * 2,
          borderRadius: "50%",
          top:  cy - r,
          left: cx - r,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.72)",
          border: "1.5px solid rgba(99,179,237,0.3)",
          transition: "top 0.6s cubic-bezier(0.4,0,0.2,1), left 0.6s cubic-bezier(0.4,0,0.2,1), width 0.6s ease, height 0.6s ease",
        }}
      />

      {/* Step info panel — bottom centre */}
      <div
        style={{
          position: "fixed",
          bottom: 90,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 9000,
          width: 380,
          maxWidth: "calc(100vw - 32px)",
          background: "rgba(2,8,20,0.97)",
          border: "1px solid rgba(40,80,200,0.5)",
          borderRadius: 14,
          boxShadow: "0 8px 40px rgba(10,30,120,0.5)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: "18px 20px 16px",
          fontFamily: "monospace",
        }}
      >
        {/* Step counter */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {STEPS.map((_, i) => (
              <div key={i} style={{
                width: i === step ? 18 : 6, height: 6, borderRadius: 3,
                background: i === step ? "#3b82f6" : i < step ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.1)",
                transition: "all 0.3s ease",
              }} />
            ))}
          </div>
          <span style={{ color: "#4b5563", fontSize: 11 }}>{step + 1} / {STEPS.length}</span>
        </div>

        {/* Content */}
        <div style={{ color: "#93c5fd", fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
          {cur.title}
        </div>
        <div style={{ color: "#9ca3af", fontSize: 12, lineHeight: 1.7, whiteSpace: "pre-line", marginBottom: 14 }}>
          {cur.body}
        </div>

        {/* "Don't show again" on final step */}
        {isLast && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={noMore}
              onChange={e => setNoMore(e.target.checked)}
              style={{ accentColor: "#3b82f6", width: 13, height: 13 }}
            />
            <span style={{ color: "#6b7280", fontSize: 11 }}>Don't show this tour again</span>
          </label>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          {step > 0 && (
            <button
              onClick={prev}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 8, fontSize: 12, cursor: "pointer",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#6b7280",
              }}
            >
              ← Prev
            </button>
          )}
          <button
            onClick={next}
            style={{
              flex: 2, padding: "7px 0", borderRadius: 8, fontSize: 12, fontWeight: 600,
              cursor: "pointer",
              background: "rgba(37,99,235,0.3)",
              border: "1px solid rgba(59,130,246,0.5)",
              color: "#93c5fd",
            }}
          >
            {isLast ? "Start Exploring →" : "Next →"}
          </button>
          <button
            onClick={finish}
            style={{
              padding: "7px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#4b5563",
            }}
          >
            Skip
          </button>
        </div>
      </div>
    </>
  )
}
