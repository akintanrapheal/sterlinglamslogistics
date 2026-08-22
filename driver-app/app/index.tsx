import { useState, useEffect } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image, ScrollView,
} from "react-native"
import { router } from "expo-router"
import { useDriver } from "@/context/DriverContext"
import { API_BASE } from "@/lib/api"

export default function LoginScreen() {
  const { session, loadingSession, login } = useDriver()
  const [phone, setPhone] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Already logged in → go to tabs
  useEffect(() => {
    if (!loadingSession && session) router.replace("/(tabs)/dashboard")
  }, [loadingSession, session])

  async function handleLogin() {
    if (!phone.trim() || !password.trim()) {
      setError("Please enter your phone number and password.")
      return
    }
    setError("")
    setLoading(true)
    try {
      // Login predates having a token, so it can't use driverFetch — but it
      // must use the same origin, or a driver could fail to sign in at all
      // while the apex is returning 403s.
      const res = await fetch(`${API_BASE}/api/driver/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), password }),
      })
      const data = await res.json() as {
        ok: boolean
        error?: string
        driver?: { id: string; name: string; phone: string }
        token?: string
      }
      if (!res.ok || !data.ok || !data.driver || !data.token) {
        setError("Invalid phone number or password.")
        return
      }
      await login({ id: data.driver.id, name: data.driver.name, phone: data.driver.phone, token: data.token })
      router.replace("/(tabs)/dashboard")
    } catch (err) {
      const msg = err instanceof Error ? err.message : ""
      if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch") || msg.includes("abort")) {
        setError("Connection error. Check your internet and try again.")
      } else {
        setError("Login failed. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  if (loadingSession) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GREEN} />
      </View>
    )
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>S</Text>
          </View>
          <Text style={styles.appName}>Sterlin Driver</Text>
          <Text style={styles.subtitle}>Sign in to start delivering</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="+234 801 234 5678"
            placeholderTextColor="#9ca3af"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your password"
            placeholderTextColor="#9ca3af"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.btn, loading && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Sign In</Text>
            }
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const GREEN = "#16a34a"

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  logoWrap: { alignItems: "center", marginBottom: 40 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: GREEN, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  logoText: { color: "#fff", fontSize: 36, fontWeight: "800" },
  appName: { fontSize: 24, fontWeight: "700", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 14, color: "#6b7280" },
  form: { width: "100%", maxWidth: 360 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: "#d1d5db", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 13, fontSize: 16, color: "#111827",
    backgroundColor: "#f9fafb",
  },
  error: { color: "#ef4444", fontSize: 13, marginTop: 12, textAlign: "center" },
  btn: {
    marginTop: 24, backgroundColor: GREEN, borderRadius: 12,
    paddingVertical: 15, alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
})
