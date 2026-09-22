'use client';

import {
  Activity,
  Bell,
  CalendarClock,
  ChevronUp,
  Cpu,
  LayoutDashboard,
  LogOut,
  Pill,
  Settings,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { clearStoredToken, getStoredUser } from '@/lib/client/auth';

const navMain = [
  { title: 'Overview', url: '/dashboard', icon: LayoutDashboard },
  { title: 'My Devices', url: '/dashboard/devices', icon: Cpu },
  { title: 'Medications', url: '/dashboard/pills', icon: Pill },
  { title: 'Daily Schedule', url: '/dashboard/schedule', icon: CalendarClock },
  { title: 'Adherence', url: '/dashboard/adherence', icon: Activity },
];

const navSecondary = [
  { title: 'Settings', url: '/dashboard/settings', icon: Settings },
  { title: 'Profile', url: '/dashboard/profile', icon: User },
  { title: 'Notifications', url: '/dashboard/settings#notifications', icon: Bell },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user] = useState(() => getStoredUser() ?? { name: 'User', email: '' });
  const userName = user.name;
  const userEmail = user.email;

  function logout() {
    clearStoredToken();
    router.push('/auth');
  }

  const initials = userName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'ML';

  return (
    <Sidebar variant="inset">
      {/* ── Logo ── */}
      <SidebarHeader>
        <div className="flex items-center gap-3 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-lg glow-cyan">
            <Pill className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-foreground">MediLink</p>
            <p className="text-xs text-muted-foreground">Smart Pill Monitor</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator />

      {/* ── Main Nav ── */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {navMain.map((item) => {
              const active =
                pathname === item.url ||
                (item.url !== '/dashboard' && pathname.startsWith(item.url));
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={active}
                    tooltip={item.title}
                    render={<Link href={item.url} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarMenu>
            {navSecondary.map((item) => {
              const active = pathname === item.url;
              return (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={active}
                    tooltip={item.title}
                    size="sm"
                    render={<Link href={item.url} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      {/* ── User Profile Footer ── */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    size="lg"
                    className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                  />
                }
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/20 text-primary text-xs font-bold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{userName}</span>
                  <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                </div>
                <ChevronUp className="ml-auto size-4" />
              </DropdownMenuTrigger>

              <DropdownMenuContent side="bottom" align="end" sideOffset={4}>
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5">
                    <Avatar className="h-8 w-8 rounded-lg">
                      <AvatarFallback className="rounded-lg bg-primary/20 text-primary text-xs font-bold">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{userName}</span>
                      <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/dashboard/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/dashboard/settings')}>
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={logout}
                  className="text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
