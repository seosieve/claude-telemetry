import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

interface LayoutProps {
  children: ReactNode;
  title: string;
  activePage: string;
  onNavigate: (page: string) => void;
  alertCount?: number;
}

export function Layout({ children, title, activePage, onNavigate, alertCount }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar activePage={activePage} onNavigate={onNavigate} alertCount={alertCount} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header title={title} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
