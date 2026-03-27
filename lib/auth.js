import GithubProvider from "next-auth/providers/github"

export const authOptions = {
  providers: [
    GithubProvider({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      authorization: {
        params: { scope: "read:user user:email repo" },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.provider = account.provider
        token.accessToken = account.access_token
      }
      return token
    },
    async session({ session, token }) {
      session.provider = token.provider
      session.accessToken = token.accessToken
      return session
    },
  },
  pages: {
    signIn: "/",
  },
}
