# Codebase Galaxy

Codebase Galaxy is an open-source Next.js app by **Solvor Private Limited**.
It turns GitHub repositories and Spotify listening data into interactive galaxy-style visualizations.

## What This Project Is For

Use Codebase Galaxy to:

- Explore repository structure in a visual, intuitive way.
- Understand dependencies and activity patterns faster than reading raw files.
- Compare two repositories side-by-side as separate galaxies.
- Visualize Spotify taste, top artists, genres, and playlist-driven patterns.
- Share generated galaxy views with others.

## Features

- 🌌 **3D Galaxy Visualization**: Files/folders (or artists/genres) shown as a navigable universe.
- 💻 **GitHub OAuth + Repo Discovery**: Sign in and visualize your repositories or public repos.
- ♫ **Spotify OAuth + Music Galaxy**: Generate a personal music galaxy from Spotify data.
- 🔀 **Repository Compare Mode**: Compare two repos in dedicated galaxy views.
- 🖼️ **Gallery + Sharing**: Save and browse previously generated galaxies.
- ⚡ **Session Caching**: Faster repeated analysis using in-memory cache flows.

## Minimal Local Setup

1. Clone the repository.
2. Install dependencies:

```bash
npm install
```

3. Create `.env.local` in the project root and add the variables below.
4. Start the app:

```bash
npm run dev
```

5. Open `http://localhost:3100`.

## Environment Variables (`.env.local`)

Add this file in the root:

```env
NEXTAUTH_URL=http://localhost:3100

GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret

SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
```

Recommended for production:

```env
NEXTAUTH_SECRET=your_long_random_secret
```

## OAuth App Callback URLs

Configure these in provider dashboards:

- GitHub callback URL: `http://localhost:3100/api/auth/callback/github`
- Spotify redirect URI: `http://localhost:3100/api/auth/callback/spotify`

For production, replace `http://localhost:3100` with your deployed domain.

## Scripts

- `npm run dev` - Runs Next.js dev server on port `3100`.
- `npm run build` - Creates production build.
- `npm run start` - Starts production server on port `3100`.
- `npm run lint` - Runs ESLint checks.

## Open Source and License

This project is open source and released under the **MIT License**.

Copyright (c) Solvor Private Limited.
