import { Sidebar } from "@/components/layout/Sidebar"
import { MainContent } from "@/components/layout/MainContent"
import { AgentProvider } from "@/lib/agent/AgentProvider"
import { ExtractionProvider } from "@/components/providers/ExtractionProvider"
import { FocusAreaProvider } from "@/components/providers/FocusAreaProvider"
import { PersonaStatusProvider } from "@/components/providers/PersonaStatusProvider"
import { SidebarProvider } from "@/components/providers/SidebarProvider"
import { SidebarDataProvider } from "@/components/providers/SidebarDataProvider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ChatHubDrawer } from "@/components/personas/ChatHubDrawer"

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <AgentProvider>
      <ExtractionProvider>
        <SidebarProvider>
          <SidebarDataProvider>
            <PersonaStatusProvider>
              <FocusAreaProvider>
                <TooltipProvider>
                  <Sidebar />
                  <MainContent>{children}</MainContent>
                  <ChatHubDrawer />
                </TooltipProvider>
              </FocusAreaProvider>
            </PersonaStatusProvider>
          </SidebarDataProvider>
        </SidebarProvider>
      </ExtractionProvider>
    </AgentProvider>
  )
}
