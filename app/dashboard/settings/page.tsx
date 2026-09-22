'use client';

import { Bell, Moon, Shield, Trash2, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { clearStoredToken } from '@/lib/client/auth';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();

  function logout() {
    clearStoredToken();
    router.push('/auth');
  }

  const sections = [
    {
      id: 'notifications',
      icon: Bell,
      title: 'Notifications',
      desc: 'Configure how MediLink alerts you.',
      items: [
        { label: 'Dose reminders', desc: 'Get notified when a dose is due', enabled: true },
        { label: 'Missed dose alerts', desc: 'Alert when a dose is 5+ minutes overdue', enabled: true },
        { label: 'Device offline', desc: 'Notify when your pill box goes offline', enabled: false },
      ],
    },
    {
      id: 'device',
      icon: Wifi,
      title: 'Device & Connectivity',
      desc: 'Manage WebSocket and device polling settings.',
      items: [
        { label: 'Real-time updates', desc: 'ESP32 connects via WebSocket (port 8080)', enabled: true },
        { label: 'Auto-reconnect', desc: 'Device tries to reconnect every 5 seconds', enabled: true },
      ],
    },
    {
      id: 'privacy',
      icon: Shield,
      title: 'Privacy & Security',
      desc: 'Control your data and security settings.',
      items: [
        { label: 'Session timeout', desc: 'Auto logout after 14 days of inactivity', enabled: true },
      ],
    },
  ];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Customize your MediLink experience.</p>
      </div>

      {sections.map(section => (
        <Card key={section.id} id={section.id} className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <section.icon className="h-4 w-4 text-primary" />
              {section.title}
            </CardTitle>
            <CardDescription>{section.desc}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {section.items.map((item, i) => (
              <div key={i}>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm font-medium">{item.label}</Label>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  {/* Toggle (visual only – no backend yet) */}
                  <div
                    className={`relative h-6 w-11 rounded-full transition-colors cursor-pointer ${item.enabled ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <div
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${item.enabled ? 'translate-x-5' : 'translate-x-1'}`}
                    />
                  </div>
                </div>
                {i < section.items.length - 1 && <Separator className="mt-4" />}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* Appearance */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Moon className="h-4 w-4 text-primary" />
            Appearance
          </CardTitle>
          <CardDescription>MediLink uses a dark theme optimized for medical use.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            {['Dark (recommended)', 'System'].map((t, i) => (
              <div
                key={t}
                className={`flex items-center gap-2 rounded-lg border p-3 cursor-pointer transition-colors ${i === 0 ? 'border-primary/50 bg-primary/10' : 'border-border/50 hover:border-border'}`}
              >
                <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${i === 0 ? 'border-primary' : 'border-border'}`}>
                  {i === 0 && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <span className="text-sm">{t}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <Trash2 className="h-4 w-4" />
            Danger Zone
          </CardTitle>
          <CardDescription>Irreversible actions — proceed with caution.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <div>
              <p className="text-sm font-medium">Sign out</p>
              <p className="text-xs text-muted-foreground">Sign out of your current session.</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3">
            <div>
              <p className="text-sm font-medium text-destructive">Delete account</p>
              <p className="text-xs text-muted-foreground">Permanently delete your account and all data.</p>
            </div>
            <Button variant="destructive" size="sm" disabled>Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
