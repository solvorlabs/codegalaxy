"use client"
import { useEffect, useRef, useState, useId } from "react"

/** Reusable info-tooltip button.
 *  Usage: <InfoButton title="How It Works">Body text here</InfoButton>
 *  Only one panel open at a time (clicks on another auto-close the previous).
 */
export default function InfoButton({ title, children }) {
  const [open, setOpen]       = useState(false)
  const [rawPos, setRawPos]   = useState({ top: 0, left: 0 })
  const [finalPos, setFinalPos] = useState({ top: 0, left: 0 })
  const btnRef   = useRef(null)
  const panelRef = useRef(null)
  const uid      = useId()

  // ── "close all others" broadcast ────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => { if (e.detail?.except !== uid) setOpen(false) }
    window.addEventListener("infopanel-close-all", handler)
    return () => window.removeEventListener("infopanel-close-all", handler)
  }, [uid])

  // ── Escape + outside-click close ────────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
    const onMouse = (e) => {
      if (!btnRef.current?.contains(e.target) && !panelRef.current?.contains(e.target))
        setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onMouse)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onMouse)
    }
  }, [open])

  // ── Smart position: clamp to viewport ───────────────────────────────────
  useEffect(() => {
    if (!open || !panelRef.current) return
    let { left, top } = rawPos
    if (left + 284 > window.innerWidth - 8)  left = window.innerWidth - 292
    if (left < 8) left = 8
    if (top + 320 > window.innerHeight - 8)  top = rawPos.top - panelRef.current.offsetHeight - 14
    setFinalPos({ top, left })
  }, [open, rawPos])

  const handleToggle = () => {
    if (!open) {
      window.dispatchEvent(new CustomEvent("infopanel-close-all", { detail: { except: uid } }))
      const rect = btnRef.current.getBoundingClientRect()
      setRawPos({ top: rect.bottom + 8, left: rect.left - 4 })
    }
    setOpen(o => !o)
  }

  // Arrow horizontal offset (points to btn centre relative to panel left)
  const arrowLeft = Math.max(6, Math.min(260, (rawPos.left + 6) - finalPos.left))

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleToggle() } }}
        aria-label={`Info: ${title}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        tabIndex={0}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 16, height: 16, flexShrink: 0, borderRadius: "50%",
          background: "rgba(2,8,20,0.7)",
          border: `1px solid ${open ? "rgba(59,130,246,0.8)" : "rgba(59,130,246,0.4)"}`,
          color: open ? "rgba(147,197,253,1)" : "rgba(59,130,246,0.8)",
          cursor: "pointer", fontSize: 9, fontFamily: "monospace", fontWeight: 700,
          transform: open ? "scale(1.15)" : "scale(1)",
          boxShadow: open ? "0 0 8px rgba(59,130,246,0.5)" : "none",
          transition: "all 0.15s ease",
          outline: "none",
          lineHeight: 1,
        }}
        onMouseEnter={e => {
          Object.assign(e.currentTarget.style, {
            boxShadow: "0 0 8px rgba(59,130,246,0.5)",
            transform: "scale(1.15)",
            borderColor: "rgba(59,130,246,0.8)",
            color: "rgba(147,197,253,1)",
          })
        }}
        onMouseLeave={e => {
          if (!open) Object.assign(e.currentTarget.style, {
            boxShadow: "none", transform: "scale(1)",
            borderColor: "rgba(59,130,246,0.4)",
            color: "rgba(59,130,246,0.8)",
          })
        }}
      >
        ?
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={title}
          className="fixed z-[9999] font-mono"
          style={{ top: finalPos.top, left: finalPos.left, width: 280 }}
        >
          {/* Arrow cap */}
          <div style={{
            position: "absolute", top: -5, left: arrowLeft,
            width: 0, height: 0,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderBottom: "5px solid rgba(40,80,200,0.65)",
          }} />
          <div style={{
            background: "rgba(2,8,20,0.97)",
            border: "1px solid rgba(40,80,200,0.5)",
            borderRadius: 10,
            boxShadow: "0 8px 32px rgba(10,30,120,0.45), 0 0 0 1px rgba(40,80,200,0.1)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            padding: "12px 14px",
          }}>
            {title && (
              <div style={{ color: "#93c5fd", fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
                {title}
              </div>
            )}
            <div style={{ color: "#9ca3af", fontSize: 11, lineHeight: 1.65, whiteSpace: "pre-line" }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
