"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { KnowledgeUser } from "@/lib/types";
import {
  DEFAULT_KNOWLEDGE_USER_ID,
  getDefaultKnowledgeUser,
  getKnowledgeUser,
  KNOWLEDGE_USERS,
} from "@/lib/knowledge/permissions";
import { canUseDeveloperTools } from "@/lib/knowledge/navigation";

interface KnowledgeUserContextValue {
  currentUser: KnowledgeUser;
  setCurrentUserId: (userId: string) => void;
  isDeveloper: boolean;
  canUseDeveloperTools: boolean;
}

const KnowledgeUserContext = createContext<KnowledgeUserContextValue | null>(
  null
);

export function KnowledgeUserProvider({ children }: { children: ReactNode }) {
  const [currentUserId, setCurrentUserIdState] = useState(
    DEFAULT_KNOWLEDGE_USER_ID
  );

  function setCurrentUserId(userId: string) {
    const next = getKnowledgeUser(userId);
    if (!next) return;
    setCurrentUserIdState(next.id);
  }

  const currentUser =
    getKnowledgeUser(currentUserId) ?? getDefaultKnowledgeUser();
  const developerTools = canUseDeveloperTools(currentUser);
  const value = useMemo(
    () => ({
      currentUser,
      setCurrentUserId,
      isDeveloper: currentUser.role === "developer",
      canUseDeveloperTools: developerTools,
    }),
    [currentUser, developerTools]
  );

  return (
    <KnowledgeUserContext.Provider value={value}>
      {children}
    </KnowledgeUserContext.Provider>
  );
}

export function useKnowledgeUser() {
  const ctx = useContext(KnowledgeUserContext);
  if (!ctx) {
    throw new Error("useKnowledgeUser must be used within KnowledgeUserProvider");
  }
  return ctx;
}
