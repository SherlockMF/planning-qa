"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { KnowledgeUser } from "@/lib/types";
import {
  getKnowledgeUser,
  KNOWLEDGE_USERS,
} from "@/lib/knowledge/permissions";
import { canUseDeveloperTools } from "@/lib/knowledge/navigation";

const STORAGE_KEY = "qa-current-user-v1";

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
  const [currentUserId, setCurrentUserIdState] = useState(KNOWLEDGE_USERS[0].id);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && getKnowledgeUser(stored)) setCurrentUserIdState(stored);
    } catch {
      // localStorage 不可用时保持默认账号。
    }
  }, []);

  function setCurrentUserId(userId: string) {
    const next = getKnowledgeUser(userId);
    if (!next) return;
    setCurrentUserIdState(next.id);
    try {
      localStorage.setItem(STORAGE_KEY, next.id);
    } catch {
      // 忽略本地存储失败，不影响问答链路。
    }
  }

  const currentUser = getKnowledgeUser(currentUserId) ?? KNOWLEDGE_USERS[0];
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
