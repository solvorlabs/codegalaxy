import { Geist_Mono, Space_Mono } from "next/font/google"
import "./globals.css"
import SessionProvider from "@/components/SessionProvider"

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const spaceMono = Space_Mono({
  variable: "--font-space-mono",
  subsets: ["latin"],
  weight: ["400", "700"],
})

export const metadata = {
  title: "Codebase Galaxy",
  description: "Visualize any GitHub repository as an interactive 3D galaxy",
  icons: {
    icon: [{ url: "/codegalaxy.png?v=2", type: "image/png" }],
    shortcut: "/codegalaxy.png?v=2",
    apple: "/codegalaxy.png?v=2",
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${geistMono.variable} ${spaceMono.variable} font-mono bg-black text-white antialiased`}
      >
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
