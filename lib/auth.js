import GithubProvider from "next-auth/providers/github"
import SpotifyProvider from "next-auth/providers/spotify"

// Allow HTTP cookies in local development (prevents "State cookie was missing" errors)
const useSecureCookies = process.env.NEXTAUTH_URL?.startsWith("https://") ?? false
const cookiePrefix  = useSecureCookies ? "__Secure-" : ""
const cookieDomain  = undefined  // let NextAuth infer from request

export const authOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: {
        params: { scope: "read:user user:email repo" },
      },
    }),
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
      authorization: {
        params: {
          scope: "user-top-read user-read-recently-played user-read-private",
        },
      },
    }),
  ],
  cookies: {
    pkceCodeVerifier: {
      name: `${cookiePrefix}next-auth.pkce.code_verifier`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
    state: {
      name: `${cookiePrefix}next-auth.state`,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: useSecureCookies },
    },
  },
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider
        if (account.provider === "spotify") {
          token.spotifyAccessToken = account.access_token
        } else if (account.provider === "github") {
          token.accessToken = account.access_token
        }
      }
      return token
    },
    async session({ session, token }) {
      session.provider = token.provider
      if (token.provider === "spotify") {
        session.spotifyAccessToken = token.spotifyAccessToken
      } else {
        session.accessToken = token.accessToken
      }
      return session
    },
  },
  pages: {
    signIn: "/",
  },
}

