// Members, rights and the administration log in the BETA store (one document,
// CrmRepository). Every change and its log entry are saved together. The rules
// (who may do what) are checked by the user service before anything is called.
import type { CrmRepository } from '../crm/repository.ts';
import type { AuditEntry, MemberRole, MemberStatus, UserProfile } from '../crm/types.ts';
import type {
  AuditNote,
  ProfileInput,
  UserDirectory,
  UserListFilter,
  UserRecord,
  UserSummary,
} from './directory.ts';

const PROFILE_FIELDS = ['firstName', 'lastName', 'oib', 'email', 'phone'] as const;

const fold = (text: string) => text.toLocaleLowerCase('hr').normalize('NFD').replace(/[̀-ͯ]/g, '');

export function createLocalDirectory(repo: CrmRepository): UserDirectory {
  const members = (organizationId: string) =>
    repo.data().users.filter((u) => u.organizationId === organizationId);
  const find = (organizationId: string, userId: string) =>
    members(organizationId).find((u) => u.id === userId) ?? null;
  const rightsOf = (organizationId: string, userId: string) =>
    repo
      .data()
      .userPermissions.filter(
        (p) => p.organizationId === organizationId && p.userId === userId && p.allowed,
      )
      .map((p) => p.key);
  const record = (u: UserProfile): UserRecord => {
    const { organizationId, ...rest } = u;
    return { ...rest, permissions: u.role === 'owner' ? [] : rightsOf(organizationId, u.id) };
  };
  const summary = (u: UserProfile): UserSummary => ({
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    phone: u.phone,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  });
  const required = (organizationId: string, userId: string) => {
    const u = find(organizationId, userId);
    if (!u) throw new Error('member not found');
    return u;
  };
  function appendLog(
    organizationId: string,
    targetUserId: string | null,
    action: AuditEntry['action'],
    note: AuditNote,
    result: AuditEntry['result'] = 'success',
  ) {
    repo.data().auditLog.push({
      id: globalThis.crypto.randomUUID(),
      organizationId,
      actorUserId: note.actorUserId,
      targetUserId,
      action,
      result,
      details: note.details ?? {},
      at: new Date().toISOString(),
    });
  }
  function writeRights(
    organizationId: string,
    userId: string,
    keys: readonly string[],
    actorUserId: string | null,
  ) {
    const data = repo.data();
    const now = new Date().toISOString();
    data.userPermissions = data.userPermissions.filter(
      (p) => !(p.organizationId === organizationId && p.userId === userId),
    );
    for (const key of keys) {
      data.userPermissions.push({
        organizationId,
        userId,
        key,
        allowed: true,
        updatedAt: now,
        updatedBy: actorUserId,
      });
    }
  }

  return {
    async list(organizationId, filter: UserListFilter) {
      const needle = fold(filter.q.trim());
      const rows = members(organizationId).filter(
        (u) =>
          (filter.status === 'all' || u.status === filter.status) &&
          (!needle ||
            [u.firstName, u.lastName, `${u.firstName} ${u.lastName}`, u.email, u.phone].some((t) =>
              fold(t).includes(needle),
            )),
      );
      const key = filter.sort;
      const value = (u: UserProfile) => fold(String(u[key] ?? ''));
      rows.sort((a, b) => {
        const order =
          value(a).localeCompare(value(b), 'hr') ||
          fold(a.lastName).localeCompare(fold(b.lastName), 'hr');
        return filter.dir === 'desc' ? -order : order;
      });
      const start = (filter.page - 1) * filter.pageSize;
      return { items: rows.slice(start, start + filter.pageSize).map(summary), total: rows.length };
    },

    async get(organizationId, userId) {
      const u = find(organizationId, userId);
      return u ? record(u) : null;
    },

    async findByEmail(organizationId, email) {
      const u = members(organizationId).find((m) => m.email === email.toLowerCase());
      return u ? record(u) : null;
    },

    async activeOwnerCount(organizationId) {
      return members(organizationId).filter((u) => u.role === 'owner' && u.status === 'active')
        .length;
    },

    async insert(organizationId, user, note) {
      return repo.transaction(() => {
        const now = new Date().toISOString();
        const profile: UserProfile = {
          id: user.id,
          organizationId,
          firstName: user.firstName,
          lastName: user.lastName,
          oib: user.oib,
          email: user.email.toLowerCase(),
          phone: user.phone,
          role: user.role,
          status: 'active',
          createdAt: now,
          createdBy: note.actorUserId,
          updatedAt: now,
          deactivatedAt: null,
          deactivatedBy: null,
          lastLoginAt: null,
        };
        repo.data().users.push(profile);
        writeRights(
          organizationId,
          user.id,
          user.role === 'owner' ? [] : user.permissions,
          note.actorUserId,
        );
        appendLog(organizationId, user.id, 'user.create', note);
        repo.commit();
        return record(profile);
      });
    },

    async updateProfile(organizationId, userId, patch: ProfileInput, note) {
      return repo.transaction(() => {
        const u = required(organizationId, userId);
        const next = { ...patch, email: patch.email.toLowerCase() };
        const changed = PROFILE_FIELDS.filter((f) => u[f] !== next[f]);
        if (changed.length) {
          Object.assign(u, next, { updatedAt: new Date().toISOString() });
          appendLog(organizationId, userId, 'user.update', {
            ...note,
            details: { ...note.details, fields: changed },
          });
          repo.commit();
        }
        return record(u);
      });
    },

    async setStatus(organizationId, userId, status: MemberStatus, note) {
      return repo.transaction(() => {
        const u = required(organizationId, userId);
        const now = new Date().toISOString();
        u.status = status;
        u.updatedAt = now;
        u.deactivatedAt = status === 'inactive' ? now : null;
        u.deactivatedBy = status === 'inactive' ? note.actorUserId : null;
        appendLog(
          organizationId,
          userId,
          status === 'inactive' ? 'user.deactivate' : 'user.activate',
          note,
        );
        repo.commit();
        return record(u);
      });
    },

    async setAccess(organizationId, userId, role: MemberRole, permissions, note) {
      return repo.transaction(() => {
        const u = required(organizationId, userId);
        u.role = role;
        u.updatedAt = new Date().toISOString();
        writeRights(organizationId, userId, role === 'owner' ? [] : permissions, note.actorUserId);
        appendLog(organizationId, userId, 'user.access', note);
        repo.commit();
        return record(u);
      });
    },

    async touchLogin(organizationId, userId, at) {
      const u = find(organizationId, userId);
      if (!u) return;
      u.lastLoginAt = at.toISOString();
      repo.commit();
    },

    async log(entry) {
      repo.data().auditLog.push({
        ...entry,
        id: globalThis.crypto.randomUUID(),
        at: entry.at ?? new Date().toISOString(),
      });
      repo.commit();
    },

    async auditFor(organizationId, userId, limit) {
      return repo
        .data()
        .auditLog.filter((e) => e.organizationId === organizationId && e.targetUserId === userId)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, limit);
    },
  };
}
