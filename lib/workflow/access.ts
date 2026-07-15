import type { KnowledgeUser } from "../types.ts";
import { KNOWLEDGE_USERS } from "../knowledge/permissions.ts";
import { canUseDeveloperTools } from "../knowledge/navigation.ts";

export function resolveWorkflowAuditActor(actorUserId?: string): KnowledgeUser {
  const actor = KNOWLEDGE_USERS.find((user) => user.id === actorUserId);
  if (!actor || !canUseDeveloperTools(actor)) {
    throw new Error("当前账号无权访问工作流审计");
  }
  return actor;
}

export function resolveWorkflowSimulatedUser(
  actor: KnowledgeUser,
  simulatedUserId?: string
): KnowledgeUser {
  if (!simulatedUserId) return actor;
  const simulatedUser = KNOWLEDGE_USERS.find(
    (user) => user.id === simulatedUserId
  );
  if (!simulatedUser) throw new Error("模拟用户不存在");
  return simulatedUser;
}
