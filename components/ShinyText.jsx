"use client"

export default function ShinyText({
  text,
  speed = 2,
  delay = 0,
  color = "#b5b5b5",
  shineColor = "#ffffff",
  spread = 120,
  direction = "left",
  yoyo = false,
  pauseOnHover = false,
  disabled = false,
  className = "",
}) {
  const animationName = direction === "right" ? "shiny-text-right" : "shiny-text-left"

  if (disabled) {
    return <span className={className} style={{ color }}>{text}</span>
  }

  return (
    <span
      className={`shiny-text ${pauseOnHover ? "shiny-text-pause" : ""} ${className}`.trim()}
      style={{
        backgroundImage: `linear-gradient(120deg, ${color} 0%, ${color} 40%, ${shineColor} 50%, ${color} 60%, ${color} 100%)`,
        backgroundSize: `${spread}% 100%`,
        animationName,
        animationDuration: `${speed}s`,
        animationDelay: `${delay}s`,
        animationTimingFunction: "linear",
        animationIterationCount: "infinite",
        animationDirection: yoyo ? "alternate" : "normal",
      }}
    >
      {text}
    </span>
  )
}
