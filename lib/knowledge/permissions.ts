import type {
  Chunk,
  Document,
  KnowledgeRole,
  KnowledgeRoleId,
  KnowledgeUser,
  PermissionLevel,
} from "@/lib/types";

export const KNOWLEDGE_ROLES: Record<KnowledgeRoleId, KnowledgeRole> = {
  employee: {
    id: "employee",
    label: "普通员工",
    maxPermissionLevel: 1,
  },
  project_manager: {
    id: "project_manager",
    label: "项目负责人",
    maxPermissionLevel: 2,
  },
  admin: {
    id: "admin",
    label: "管理员",
    maxPermissionLevel: 3,
  },
  developer: {
    id: "developer",
    label: "开发人员",
    maxPermissionLevel: 3,
  },
};

export const KNOWLEDGE_USERS: KnowledgeUser[] = [
  {
    id: "user-employee-riverfront",
    name: "张明",
    role: "employee",
    department: "规划一所",
    projectIds: ["project-riverfront"],
    ownedProjectIds: [],
  },
  {
    id: "user-employee-industrial",
    name: "陈珊",
    role: "employee",
    department: "城市设计中心",
    projectIds: ["project-industrial"],
    ownedProjectIds: [],
  },
  {
    id: "user-manager-riverfront",
    name: "李婷",
    role: "project_manager",
    department: "规划一所",
    projectIds: [],
    ownedProjectIds: ["project-riverfront"],
  },
  {
    id: "user-manager-tod",
    name: "周航",
    role: "project_manager",
    department: "交通规划所",
    projectIds: [],
    ownedProjectIds: ["project-tod"],
  },
  {
    id: "user-admin",
    name: "王磊",
    role: "admin",
    department: "知识管理部",
    projectIds: [],
    ownedProjectIds: [],
  },
  {
    id: "user-developer",
    name: "赵工",
    role: "developer",
    department: "数字化研发组",
    projectIds: [],
    ownedProjectIds: [],
  },
];

export function getKnowledgeUser(userId?: string): KnowledgeUser | undefined {
  if (userId) {
    const user = KNOWLEDGE_USERS.find((u) => u.id === userId);
    if (user) return user;
  }
  return KNOWLEDGE_USERS[0];
}

export function getKnowledgeUserByRole(
  role?: KnowledgeRoleId
): KnowledgeUser | undefined {
  if (!role) return getKnowledgeUser();
  return KNOWLEDGE_USERS.find((u) => u.role === role) ?? getKnowledgeUser();
}

export function canAccessDocument(user: KnowledgeUser, doc: Document): boolean {
  if (!doc.enabled || doc.status !== "indexed") return false;
  const role = KNOWLEDGE_ROLES[user.role];
  if (!role) return false;

  const level: PermissionLevel = doc.permissionLevel ?? 1;
  if (role.id === "admin" || role.id === "developer") return true;
  if (level <= 1 && !doc.projectId) return true;

  const projectId = doc.projectId;
  if (projectId) {
    if (user.projectIds.includes(projectId)) return true;
    if (user.ownedProjectIds.includes(projectId)) return true;
  }

  return level <= role.maxPermissionLevel && !projectId;
}

export function resolveKnowledgeUser(input?: {
  userId?: string;
  userRole?: KnowledgeRoleId;
}): KnowledgeUser {
  return (
    (input?.userId ? getKnowledgeUser(input.userId) : undefined) ??
    getKnowledgeUserByRole(input?.userRole) ??
    KNOWLEDGE_USERS[0]
  );
}

export function splitChunksByUserAccess(
  chunks: Chunk[],
  documents: Document[],
  userId?: string,
  userRole?: KnowledgeRoleId
): { accessible: Chunk[]; denied: Chunk[] } {
  const user = resolveKnowledgeUser({ userId, userRole });
  const docsById = new Map(documents.map((d) => [d.id, d]));
  const accessible: Chunk[] = [];
  const denied: Chunk[] = [];

  for (const chunk of chunks) {
    const doc = docsById.get(chunk.documentId);
    if (!doc) continue;
    if (canAccessDocument(user, doc)) accessible.push(chunk);
    else denied.push(chunk);
  }

  return { accessible, denied };
}

export function userLabel(user: KnowledgeUser): string {
  return `${user.name} · ${KNOWLEDGE_ROLES[user.role].label}`;
}
