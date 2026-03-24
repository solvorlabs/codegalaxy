import { NextResponse } from "next/server"

// Deterministic roast based on repo stats — no external AI
function generateRoast(stats) {
  const {
    totalFiles = 0,
    avgLinesPerFile = 0,
    isolatedFiles = 0,
    mostConnectedFile = {},
    hasTests = false,
    cssCount = 0,
    jsCount = 0,
    jsonCount = 0,
    avgHealthScore = 50,
  } = stats

  const lines = []

  // Opening based on health score
  if (avgHealthScore >= 80) {
    lines.push(`Okay, "${mostConnectedFile.name || "your repo"}" — I've seen worse. Much worse.`)
  } else if (avgHealthScore >= 60) {
    lines.push(`Let's talk about "${mostConnectedFile.name || "this codebase"}". Pull up a chair. This may take a while.`)
  } else if (avgHealthScore >= 40) {
    lines.push(`I opened your repo. My linter filed for emotional support.`)
  } else {
    lines.push(`I've seen archaeological digs with better structure than this codebase.`)
  }

  // File size roast
  if (avgLinesPerFile > 800) {
    lines.push(`Average file: ${avgLinesPerFile} lines. At what point do files become novels? Asking for a friend.`)
  } else if (avgLinesPerFile > 400) {
    lines.push(`Your files average ${avgLinesPerFile} lines each. The Geneva Convention has opinions about this.`)
  } else if (avgLinesPerFile < 20) {
    lines.push(`${avgLinesPerFile} lines per file on average. Either you're a genius of decomposition or you just love creating files.`)
  }

  // Isolated files
  const isolatedPct = totalFiles > 0 ? Math.round((isolatedFiles / totalFiles) * 100) : 0
  if (isolatedPct > 50) {
    lines.push(`${isolatedPct}% of files are isolated — no imports, no one imports them. They're screaming into the void. Like your git commits at 2am.`)
  } else if (isolatedPct > 30) {
    lines.push(`${isolatedFiles} files exist in complete social isolation. They have never touched another file. Truly the introverts of your codebase.`)
  } else if (isolatedPct > 0) {
    lines.push(`${isolatedFiles} lone-wolf files found. They import nothing and are imported by nothing. Very mysterious. Very unemployable.`)
  }

  // No tests
  if (!hasTests) {
    lines.push(`Tests: none. Zero. Not a single describe(), it(), or expect(). Your future self just burst into tears.`)
  } else {
    lines.push(`Oh — you have tests. Incredible. I didn't expect that. I'm genuinely moved.`)
  }

  // Most connected file
  if (mostConnectedFile.name && mostConnectedFile.score > 10) {
    lines.push(`"${mostConnectedFile.name}" is connected to everything. Delete it and your entire project collapses like a city built on one load-bearing meme.`)
  } else if (mostConnectedFile.name && mostConnectedFile.imports > 5) {
    lines.push(`"${mostConnectedFile.name}" imports ${mostConnectedFile.imports} things. It has commitment issues — can't stop collecting dependencies.`)
  }

  // JSON files
  if (jsonCount > 20) {
    lines.push(`${jsonCount} JSON files. I respect the commitment to config-driven development. The therapy bills must be substantial.`)
  } else if (jsonCount > 10) {
    lines.push(`${jsonCount} JSON files detected. At some point this stops being config and starts being a lifestyle.`)
  }

  // CSS vs JS ratio
  if (cssCount > 0 && jsCount > 0) {
    const ratio = Math.round(jsCount / cssCount)
    if (ratio > 10) {
      lines.push(`${ratio}x more JS than CSS. Either you're 100% Tailwind or this app looks like a terminal from 1994. No judgment.`)
    }
  } else if (cssCount === 0) {
    lines.push(`Zero CSS files. Bold choice. Either CSS-in-JS or pure chaos. Both are valid. One is painful.`)
  }

  // Total files roast
  if (totalFiles > 500) {
    lines.push(`${totalFiles} files total. I didn't know JavaScript could do that to a person.`)
  } else if (totalFiles > 200) {
    lines.push(`${totalFiles} files. A respectable sprawl. Your next.config.js and I need a word.`)
  } else if (totalFiles < 10) {
    lines.push(`Only ${totalFiles} files. Either this is a microservice or a weekend project you told your boss is "almost done."`)
  }

  // Closing
  const closings = [
    `In conclusion: ship it. What's the worst that could happen? (Don't answer that.)`,
    `Overall verdict: it compiles. That puts you in the top 40%.`,
    `The good news: it exists. That's more than most ideas ever achieve.`,
    `You made something. That's genuinely more than most people do. Even if${avgHealthScore < 40 ? " it looks like this" : " it could use some love"}.`,
  ]
  lines.push(closings[Math.abs(totalFiles + avgLinesPerFile) % closings.length])

  return lines.join("\n\n")
}

export async function POST(request) {
  try {
    const { stats } = await request.json()
    if (!stats) return NextResponse.json({ error: "stats required" }, { status: 400 })
    const roast = generateRoast(stats)
    return NextResponse.json({ roast })
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
