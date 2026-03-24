"use client"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import Galaxy from "@/component/Galaxy"
import ShinyText from "@/component/ShinyText"

const FEATURES = [
  {
    icon: "◈",
    title: "Any Public Repo",
    desc: "Enter any owner/repo and explore it instantly — no cloning required.",
  },
  {
    icon: "⬡",
    title: "3D Galaxy Layout",
    desc: "Folders form star clusters. Files orbit as planets sized by byte count.",
  },
  {
    icon: "⤳",
    title: "Dependency Mapping",
    desc: "Import statements drawn as glowing blue lines between planets.",
  },
]

export default function LandingPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (!session) return
    if (session.provider === "spotify") {
      router.replace("/spotify")
    } else {
      router.replace("/dashboard")
    }
  }, [session, router])

  return (
    <main className="min-h-screen bg-black overflow-hidden relative flex flex-col">
      {/* OGL galaxy fills the entire page background */}
      <div className="absolute inset-0">
        <Galaxy
          mouseRepulsion
          mouseInteraction={false}
          density={1}
          glowIntensity={0.3}
          saturation={0}
          hueShift={140}
          twinkleIntensity={0.3}
          rotationSpeed={0.1}
          repulsionStrength={2}
          autoCenterRepulsion={0}
          starSpeed={0.5}
          speed={1}
          style={{ width: "100%", height: "100%", position: "relative", pointerEvents: "none" }}
        />
      </div>

      {/* Subtle perspective grid */}
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#4488ff 1px, transparent 1px), linear-gradient(90deg, #4488ff 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      {/* Radial center glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_45%,rgba(59,130,246,0.07)_0%,transparent_70%)] pointer-events-none" />

      {/* Hero — vertically centered, bottom-padded to make room for feature strip */}
      <div className="relative z-10 flex-1 flex items-center justify-center pb-32">
        <div className="text-center px-6 max-w-2xl">
          <div className="mb-5 text-xs tracking-[0.4em] uppercase font-mono font-bold">
            <ShinyText
              text="GitHub · Spotify · Visualization · Explorer"
              speed={2.8}
              delay={0}
              color="#4472b7"
              shineColor="#8ec5ff"
              spread={180}
              direction="left"
              yoyo={false}
              className="font-bold"
              pauseOnHover={false}
              disabled={false}
            />
          </div>

          <h1 className="text-[5.5rem] leading-none font-extrabold tracking-tight mb-6">
            <ShinyText
              text="Codebase"
              speed={2.2}
              delay={0}
              color="#d6e7ff"
              shineColor="#ffffff"
              spread={150}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
            />
            <br />
            <ShinyText
              text="Galaxy"
              speed={2.5}
              delay={0.1}
              color="#69a8ff"
              shineColor="#e7f2ff"
              spread={170}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
            />
          </h1>

          <p className="text-gray-500 text-lg font-mono leading-relaxed mb-12 max-w-lg mx-auto">
            <ShinyText
              text="Explore your GitHub codebase or Spotify music taste"
              speed={3.2}
              delay={0.1}
              color="#7c8798"
              shineColor="#d2d8e2"
              spread={220}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
              className="font-bold"
            />
            <br />
            <ShinyText
              className="font-bold"
              text="as an interactive 3D universe."
              speed={3.2}
              delay={0.25}
              color="#7c8798"
              shineColor="#d2d8e2"
              spread={220}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
            />
          </p>

          {/* Dual login buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-6">
            {/* GitHub button */}
            <button
              onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
              disabled={status === "loading"}
              className="btn-glow inline-flex items-center gap-3 bg-white text-black font-semibold
                         px-9 py-4 rounded-full text-base transition-all active:scale-[0.97]
                         disabled:opacity-50 disabled:pointer-events-none shadow-lg
                         hover:bg-gray-50 w-full sm:w-auto justify-center"
            >
              {/* GitHub mark */}
              <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>

            {/* "or" divider */}
            <span className="text-gray-400 text-xs font-bold font-mono hidden sm:block">or</span>
            <span className="text-gray-400 text-xs font-mono font-bold sm:hidden">— or —</span>

            {/* Spotify button */}
            <button
              onClick={() => signIn("spotify", { callbackUrl: "/spotify" })}
              disabled={status === "loading"}
              className="inline-flex items-center gap-3 font-semibold
                         px-9 py-4 rounded-full text-base transition-all active:scale-[0.97]
                         disabled:opacity-50 disabled:pointer-events-none
                         w-full sm:w-auto justify-center text-white"
              style={{
                background: "#1DB954",
                boxShadow: "0 0 0 0 rgba(29,185,84,0)",
                transition: "box-shadow 0.25s ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 20px rgba(29,185,84,0.4)" }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 0 0 rgba(29,185,84,0)" }}
            >
              {/* Spotify logo */}
              <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
              Continue with Spotify
            </button>
          </div>

          {/* Descriptive subtitles */}
          <div className="flex flex-col gap-1 items-center mb-4">
            <p className="text-xs font-mono">
              <ShinyText
                text="GitHub -> visualize your codebase"
                speed={3.8}
                delay={0.15}
                color="#6d7480"
                shineColor="#b8c0cc"
                spread={180}
                direction="left"
                yoyo={false}
                pauseOnHover={false}
                disabled={false}
              />
            </p>
            <p className="text-xs font-mono">
              <ShinyText
                text="Spotify -> visualize your music taste"
                speed={3.8}
                delay={0.3}
                color="#6d7480"
                shineColor="#b8c0cc"
                spread={180}
                direction="left"
                yoyo={false}
                pauseOnHover={false}
                disabled={false}
              />
            </p>
          </div>

          <p className="text-xs font-mono">
            <ShinyText
              text="OAuth only · no data stored · access token lives in-session"
              speed={4}
              delay={0.2}
              color="#575f6b"
              shineColor="#a6afbc"
              spread={190}
              direction="left"
              yoyo={false}
              pauseOnHover={false}
              disabled={false}
            />
          </p>
        </div>
      </div>

      {/* Feature strip — pinned to bottom */}
      <div className="relative z-10 border-t border-white/6 bg-black/50 backdrop-blur-md px-8 py-7">
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex flex-col sm:items-start items-center text-center sm:text-left gap-1">
              <span className="text-blue-500 text-2xl font-mono leading-none mb-1">{f.icon}</span>
              <span className="text-sm font-semibold">
                <ShinyText
                  text={f.title}
                  speed={2.6}
                  delay={0}
                  color="#d3deee"
                  shineColor="#ffffff"
                  spread={150}
                  direction="left"
                  yoyo={false}
                  pauseOnHover={true}
                  disabled={false}
                />
              </span>
              <span className="text-xs font-mono leading-relaxed">
                <ShinyText
                  text={f.desc}
                  speed={4.2}
                  delay={0}
                  color="#5f6671"
                  shineColor="#9aa3b0"
                  spread={220}
                  direction="left"
                  yoyo={false}
                  pauseOnHover={true}
                  disabled={false}
                />
              </span>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
