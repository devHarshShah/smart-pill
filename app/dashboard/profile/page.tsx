'use client';

import { useEffect, useState } from 'react';
import { User, Mail, Lock, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { getStoredToken } from '@/lib/client/auth';

async function apiFetch<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...((init.headers as Record<string, string>) ?? {}) },
  });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Error ${res.status}`);
  return data;
}

export default function ProfilePage() {
  const [token, setToken] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingPw, setChangingPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    if (!t) return;
    try {
      const payload = JSON.parse(atob(t.split('.')[1])) as { email?: string; name?: string };
      setEmail(payload.email ?? '');
      setName(payload.name ?? '');
    } catch { /* ignore */ }
  }, []);

  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'ML';

  async function saveProfile() {
    setSaving(true); setMsg('');
    try {
      await apiFetch('/api/auth/profile', token, { method: 'PATCH', body: JSON.stringify({ name }) });
      setMsg('✓ Profile updated successfully');
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setSaving(false); }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) { setPwMsg('Passwords do not match'); return; }
    if (newPassword.length < 6) { setPwMsg('Password must be at least 6 characters'); return; }
    setChangingPw(true); setPwMsg('');
    try {
      await apiFetch('/api/auth/change-password', token, { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setPwMsg('✓ Password changed successfully');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e) { setPwMsg(e instanceof Error ? e.message : 'Error'); }
    finally { setChangingPw(false); }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your account information.</p>
      </div>

      {/* Avatar */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 rounded-2xl">
          <AvatarFallback className="rounded-2xl bg-primary/20 text-primary text-xl font-bold">{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-semibold">{name || 'Your Name'}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
      </div>

      {/* Profile info */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="h-4 w-4 text-primary" />
            Personal Information
          </CardTitle>
          <CardDescription>Update your name and display details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profileName">Full name</Label>
            <Input id="profileName" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email address
            </Label>
            <Input value={email} disabled className="opacity-60 cursor-not-allowed" />
            <p className="text-xs text-muted-foreground">Email cannot be changed.</p>
          </div>
          {msg && <p className={`text-sm ${msg.startsWith('✓') ? 'text-emerald-400' : 'text-destructive'}`}>{msg}</p>}
          <Button onClick={saveProfile} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary" />
            Change Password
          </CardTitle>
          <CardDescription>Update your account password. Minimum 6 characters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPw">Current password</Label>
            <Input id="currentPw" type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPw">New password</Label>
            <Input id="newPw" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPw">Confirm new password</Label>
            <Input id="confirmPw" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" />
          </div>
          {pwMsg && <p className={`text-sm ${pwMsg.startsWith('✓') ? 'text-emerald-400' : 'text-destructive'}`}>{pwMsg}</p>}
          <Button onClick={changePassword} disabled={changingPw || !currentPassword || !newPassword} variant="outline" className="gap-2">
            <Lock className="h-4 w-4" />
            {changingPw ? 'Changing…' : 'Change Password'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
