"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { signInWithEmailAndPassword } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"
import { toast } from "@/hooks/use-toast"
import Image from "next/image"

/**
 * Turn a Firebase auth error code into something that points at the actual
 * problem. Several of these are not credential problems at all, and reporting
 * them as one sends you to reset a password that was never wrong.
 */
function describeAuthError(code: string): { title: string; description: string } {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      // Firebase deliberately merges these so an attacker can't enumerate
      // accounts, so this really is "one of the two is wrong".
      return { title: "Login failed", description: "Invalid email or password." }

    case "auth/too-many-requests":
      return {
        title: "Temporarily locked",
        description:
          "Too many failed attempts. Firebase has paused sign-in for this account — wait a few minutes and try again, or reset the password.",
      }

    case "auth/user-disabled":
      return {
        title: "Account disabled",
        description: "This account has been disabled in Firebase Authentication.",
      }

    case "auth/network-request-failed":
      return {
        title: "Can't reach Firebase",
        description: "Check your connection. If you're online, Firebase Auth may be unreachable.",
      }

    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
    case "auth/app-deleted":
    case "auth/configuration-not-found":
      // Nothing to do with the credentials entered — most often a deleted or
      // restricted Google Cloud API key, or missing NEXT_PUBLIC_FIREBASE_* vars.
      return {
        title: "Sign-in is misconfigured",
        description:
          "The Firebase API key is missing, invalid, or restricted. This is a configuration problem, not your password.",
      }

    case "auth/operation-not-allowed":
      return {
        title: "Sign-in method disabled",
        description: "Email/password sign-in is turned off in Firebase Authentication.",
      }

    default:
      return {
        title: "Login failed",
        description: code
          ? `Sign-in failed (${code}). See the browser console for details.`
          : "Invalid email or password.",
      }
  }
}

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password.trim()) {
      toast({
        title: "Error",
        description: "Please enter email and password.",
        variant: "destructive",
      })
      return
    }
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      router.push("/dashboard")
    } catch (err) {
      // This was a bare `catch {}` reporting "Invalid email or password" for
      // every failure, so a throttled account, a disabled account, a network
      // failure and a misconfigured Firebase project were indistinguishable
      // from a typo — and the one message sent you looking in the one place
      // that wasn't the problem.
      const code = (err as { code?: string })?.code ?? ""
      const { title, description } = describeAuthError(code)
      // Keep the raw code in the console: the toast stays human, but there is
      // still something precise to search for when a case isn't covered.
      console.error("Admin sign-in failed", { code, err })
      toast({ title, description, variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-4 text-center">
          <Image
            src="/placeholder-logo.png"
            alt="Sterlinglams"
            width={160}
            height={160}
          />
          <p className="text-sm text-muted-foreground">Admin Portal</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign In
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Authorized personnel only
        </p>
      </div>
    </div>
  )
}
