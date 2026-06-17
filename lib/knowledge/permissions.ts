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

export const DEFAULT_KNOWLEDGE_USER_ID = "user-admin";

export function getDefaultKnowledgeUser(): KnowledgeUser {
  return (
    KNOWLEDGE_USERS.find((u) => u.id === DEFAULT_KNOWLEDGE_USER_ID) ??
    KNOWLEDGE_USERS[0]
  );
}

export function getSelectableKnowledgeUsers(): KnowledgeUser[] {
  return KNOWLEDGE_USERS.filter((u) => u.role !== "developer");
}

export function getKnowledgeUser(userId?: string): KnowledgeUser | undefined {
  if (userId) {
    const user = KNOWLEDGE_USERS.find((u) => u.id === userId);
    if (user) return user;
  }
  return getDefaultKnowledgeUser();
}

export function getKnowledgeUserByRole(
  role?: KnowledgeRoleId
): KnowledgeUser | undefined {
  if (!role) return getKnowledgeUser();
  return KNOWLEDGE_USERS.find((u) => u.role === role) ?? getKnowledgeUser();
}

export function canAccessDocument(user: KnowledgeUser, doc: Document): boolean {
  if (!doc.enabled || doc.status !== "indexed") return false;
  return canViewDocumentByAcl(user, doc);
}

export function canViewDocumentInManagement(
  user: KnowledgeUser,
  doc: Document
): boolean {
  return canViewDocumentByAcl(user, doc);
}

export function canManageDocumentInManagement(
  user: KnowledgeUser,
  doc: Document
): boolean {
  const role = KNOWLEDGE_ROLES[user.role];
  if (!role) return false;
  if (role.id === "admin" || role.id === "developer") return true;
  if (role.id !== "project_manager") return false;

  if (doc.projectOwnerId === user.id) return true;
  if (
    !doc.projectOwnerId &&
    doc.projectId &&
    user.ownedProjectIds.includes(doc.projectId)
  ) {
    return true;
  }
  return false;
}

function canViewDocumentByAcl(user: KnowledgeUser, doc: Document): boolean {
  const role = KNOWLEDGE_ROLES[user.role];
  if (!role) return false;

  const level: PermissionLevel = doc.permissionLevel ?? 1;
  if (role.id === "admin" || role.id === "developer") return true;

  const isProjectScoped = Boolean(
    doc.projectId || doc.projectOwnerId || doc.category === "项目资料"
  );
  const projectId = doc.projectId;

  if (isProjectScoped) {
    const hasExplicitOwner = Boolean(doc.projectOwnerId);
    const hasExplicitAccessList = Array.isArray(doc.accessibleUserIds);

    if (doc.projectOwnerId === user.id) return true;
    if (doc.accessibleUserIds?.includes(user.id)) return true;
    if (
      projectId &&
      !hasExplicitAccessList &&
      user.projectIds.includes(projectId)
    ) {
      return true;
    }
    if (
      projectId &&
      !hasExplicitOwner &&
      user.ownedProjectIds.includes(projectId)
    ) {
      return true;
    }
    return false;
  }

  return level <= role.maxPermissionLevel;
}

export function resolveKnowledgeUser(input?: {
  userId?: string;
  userRole?: KnowledgeRoleId;
}): KnowledgeUser {
  return (
    (input?.userId ? getKnowledgeUser(input.userId) : undefined) ??
    getKnowledgeUserByRole(input?.userRole) ??
    getDefaultKnowledgeUser()
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
