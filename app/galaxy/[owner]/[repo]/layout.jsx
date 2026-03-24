// Server Component — provides dynamic OG meta tags for the galaxy viewer
export async function generateMetadata({ params }) {
  const { owner, repo } = await params
  return {
    title: `${repo} — Codebase Galaxy`,
    description: `Explore ${repo} by ${owner} as an interactive 3D galaxy`,
    openGraph: {
      title: `${repo} — Codebase Galaxy`,
      description: `Explore ${repo} by ${owner} as an interactive 3D galaxy`,
      images: [{ url: `/api/og?owner=${owner}&repo=${repo}`, width: 1200, height: 630 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${repo} — Codebase Galaxy`,
      description: `Explore ${repo} by ${owner} as an interactive 3D galaxy`,
      images: [`/api/og?owner=${owner}&repo=${repo}`],
    },
  }
}

export default function GalaxyLayout({ children }) {
  return children
}
