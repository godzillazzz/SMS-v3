import React, { createContext, useContext, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import './styles.css';

type User = { id: string; email: string; displayName: string; role: string };
type Auth = { token?: string; user?: User; loading: boolean; error?: string; login(email: string, password: string): Promise<void>; logout(): Promise<void> };
const AuthContext = createContext<Auth | undefined>(undefined);
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string>(); const [user, setUser] = useState<User>(); const [loading, setLoading] = useState(true); const [error, setError] = useState<string>();
  const refresh = async () => { const result = await api.refresh(); setToken(result.accessToken); setUser(result.user); };
  useEffect(() => { refresh().catch(() => undefined).finally(() => setLoading(false)); }, []);
  const login = async (email: string, password: string) => { setError(undefined); try { const result = await api.login(email, password); setToken(result.accessToken); setUser(result.user); } catch (error) { setError(error instanceof Error ? error.message : 'Invalid email or password.'); throw error; } };
  const logout = async () => { await api.logout(); setToken(undefined); setUser(undefined); };
  return <AuthContext.Provider value={{ token, user, loading, error, login, logout }}>{children}</AuthContext.Provider>;
}
function Login() { const auth = useContext(AuthContext)!; const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const submit = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); try { await auth.login(email, password); } catch { } finally { setBusy(false); } }; return <main><form onSubmit={submit}><h1>smsv3</h1><p>Sign in to the sample dashboard.</p><label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required /></label><label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required /></label>{auth.error && <p role="alert">Invalid email or password.</p>}<button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form></main>; }
function Dashboard() { const auth = useContext(AuthContext)!; return <main><section><h1>Sample dashboard</h1><p>Signed in as {auth.user?.displayName}.</p><p>Protected sample content only.</p><button onClick={() => auth.logout()}>Sign out</button></section></main>; }
function App() { const auth = useContext(AuthContext)!; if (auth.loading) return <main>Loading…</main>; return auth.token ? <Dashboard /> : <Login />; }
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthProvider><App /></AuthProvider></React.StrictMode>);
