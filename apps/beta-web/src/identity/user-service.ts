// Korisnici (ADR-0014): every operation on members, checked here on the server
// for both identity back ends. The browser only shows what this allows.
import {
  DEFAULT_USER_PERMISSIONS,
  effectivePermissions,
  PERMISSION_KEYS,
  permissionLabel,
  permissionSetErrors,
  ROLES,
} from '../../public/app/js/core/permissions.js';
import { passwordErrors, validateUserProfile } from '../../public/app/js/core/validation.js';
import {
  CrmConflictError,
  CrmForbiddenError,
  CrmNotFoundError,
  CrmValidationError,
} from '../crm/errors.ts';
import type { MemberAccess, MemberRole, MemberStatus } from '../crm/types.ts';
import type { AccountStore, PasswordLink, PasswordState, SessionPolicy } from './accounts.ts';
import type {
  ProfileInput,
  UserDirectory,
  UserListFilter,
  UserRecord,
  UserSortKey,
} from './directory.ts';
import {
  accessChangeCheck,
  changePasswordDenial,
  DENIED,
  manageDenial,
  statusChangeDenial,
  type Actor,
} from './rules.ts';

export interface ServiceActor extends Actor {
  readonly organizationId: string;
}

export const SERVER_PASSWORD =
  'Lozinka ovog računa postavljena je u postavkama poslužitelja (RENVARA_BETA_PASSWORD).';
export const WRONG_CURRENT_PASSWORD = 'Vaša trenutna lozinka nije ispravna.';
export const NO_PASSWORDS = 'U demo verziji nema prijave lozinkom ni poveznica za lozinku.';
const SORTS: UserSortKey[] = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'status',
  'lastLoginAt',
  'createdAt',
];
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const displayName = (u: { firstName: string; lastName: string; email?: string }) =>
  `${u.firstName} ${u.lastName}`.trim() || u.email || 'Korisnik';

/** What the screens may offer for `target` (the server checks again on every action). */
export function abilities(actor: ServiceActor, target: Pick<UserRecord, 'id' | 'role' | 'status'>) {
  return {
    edit: manageDenial(actor, target, 'edit') === null,
    deactivate:
      target.status === 'active' && statusChangeDenial(actor, target, 'inactive', 1) === null,
    activate:
      target.status === 'inactive' && statusChangeDenial(actor, target, 'active', 1) === null,
    changePassword: changePasswordDenial(actor, target) === null,
    manageAccess: manageDenial(actor, target, 'manage_permissions') === null,
    changeRole: actor.role === 'owner' && actor.id !== target.id,
  };
}

export interface UserServiceOptions {
  readonly directory: UserDirectory;
  readonly accounts: AccountStore;
  readonly sessions: SessionPolicy;
  readonly now?: () => Date;
}

export function createUserService({
  directory,
  accounts,
  sessions,
  now = () => new Date(),
}: UserServiceOptions) {
  const nowSeconds = () => Math.floor(now().getTime() / 1000);
  /** Every session issued up to and including this second stops working. */
  const endSessions = (userId: string) => sessions.revokeAll(userId, nowSeconds() + 1);

  async function target(actor: ServiceActor, id: string) {
    const user = await directory.get(actor.organizationId, id);
    if (!user) throw new CrmNotFoundError();
    return user;
  }

  /** Refused: logged (the attempt, never its data) and answered 403. */
  async function deny(
    actor: ServiceActor,
    targetUserId: string | null,
    action: Parameters<UserDirectory['log']>[0]['action'],
    message: string,
  ): Promise<never> {
    await directory.log({
      organizationId: actor.organizationId,
      actorUserId: actor.id,
      targetUserId,
      action,
      result: 'denied',
      details: { reason: message },
    });
    throw new CrmForbiddenError(message);
  }

  function require(actor: ServiceActor, permission: string) {
    if (!actor.permissions.has(permission)) throw new CrmForbiddenError(DENIED.forbidden);
  }

  function profileInput(input: Record<string, unknown>): ProfileInput {
    return {
      firstName: text(input.firstName),
      lastName: text(input.lastName),
      oib: text(input.oib),
      email: text(input.email).toLowerCase(),
      phone: text(input.phone),
    };
  }

  async function validateProfile(
    actor: ServiceActor,
    input: ProfileInput,
    exceptId: string | null,
  ) {
    const other = input.email
      ? await directory.findByEmail(actor.organizationId, input.email)
      : null;
    const errors = validateUserProfile(
      { ...input },
      {
        emailTaken: () => Boolean(other && other.id !== exceptId),
      },
    );
    if (Object.keys(errors).length) throw new CrmValidationError(errors);
  }

  /** A clean set of rights: known keys, catalog order. */
  const normalizeKeys = (value: unknown): string[] =>
    Array.isArray(value) ? PERMISSION_KEYS.filter((key) => value.includes(key)) : [];

  const roleOf = (value: unknown): MemberRole | null =>
    ROLES.some((r) => r.value === value) ? (value as MemberRole) : null;

  return {
    /**
     * The member's role and rights for this request, or null when they may not
     * use the app (unknown, deactivated). Never cached in the session cookie.
     */
    async access(
      organizationId: string,
      userId: string,
    ): Promise<{ user: UserRecord; access: MemberAccess } | null> {
      const user = await directory.get(organizationId, userId);
      if (!user || user.status !== 'active') return null;
      return {
        user,
        access: { role: user.role, permissions: effectivePermissions(user) },
      };
    },

    /**
     * Sign-in: the provider checks the password, then the member must be
     * active in this organization. `notice`: the password was changed by an
     * administrator since the last sign-in.
     */
    async authenticate(organizationId: string, identifier: string, password: string) {
      const userId = await accounts.verify(identifier, password);
      if (!userId) return null;
      const user = await directory.get(organizationId, userId);
      if (!user || user.status !== 'active') return null;
      const since = user.lastLoginAt ?? user.createdAt;
      const changes = await directory.auditFor(organizationId, userId, 20);
      const changedByAdmin = changes.find(
        (e) =>
          e.action === 'user.password_change' &&
          e.result === 'success' &&
          e.actorUserId !== userId &&
          e.at > since,
      );
      await directory.touchLogin(organizationId, userId, now());
      return { user, notice: changedByAdmin ? { passwordChangedAt: changedByAdmin.at } : null };
    },

    sessionsValidAfter: (userId: string) => sessions.validAfter(userId),

    async list(actor: ServiceActor, query: URLSearchParams) {
      require(actor, 'users.view');
      const status = ['active', 'inactive', 'all'].includes(query.get('status') ?? '')
        ? (query.get('status') as UserListFilter['status'])
        : 'active';
      const sort = SORTS.includes(query.get('sort') as UserSortKey)
        ? (query.get('sort') as UserSortKey)
        : 'lastName';
      const pageSize = Math.min(100, Math.max(5, Number(query.get('pageSize')) || 20));
      const filter: UserListFilter = {
        status,
        q: (query.get('q') ?? '').slice(0, 100),
        sort,
        dir: query.get('dir') === 'desc' ? 'desc' : 'asc',
        page: Math.max(1, Math.floor(Number(query.get('page')) || 1)),
        pageSize,
      };
      const { items, total } = await directory.list(actor.organizationId, filter);
      return {
        filter,
        total,
        users: items.map((u) => {
          const can = abilities(actor, u);
          return {
            ...u,
            can: {
              view: actor.permissions.has('users.view_details'),
              deactivate: can.deactivate,
              activate: can.activate,
            },
          };
        }),
      };
    },

    async get(actor: ServiceActor, id: string) {
      require(actor, 'users.view_details');
      const user = await target(actor, id);
      return {
        user: {
          ...user,
          permissions: user.role === 'owner' ? [...PERMISSION_KEYS] : user.permissions,
        },
        passwordState: await accounts.passwordState(id),
        can: abilities(actor, user),
        self: actor.id === id,
      };
    },

    async create(actor: ServiceActor, input: Record<string, unknown>, origin: string) {
      if (!actor.permissions.has('users.create')) {
        return deny(actor, null, 'user.create', DENIED.forbidden);
      }
      const profile = profileInput(input);
      await validateProfile(actor, profile, null);
      const role = roleOf(input.role ?? 'user');
      if (!role) throw new CrmValidationError({ role: 'Odaberite ulogu.' });
      if (role !== 'user' && actor.role !== 'owner') {
        return deny(actor, null, 'user.create', DENIED.roleOwnerOnly);
      }
      let permissions: string[];
      if (input.permissions !== undefined) {
        if (!actor.permissions.has('users.manage_permissions')) {
          return deny(actor, null, 'user.create', DENIED.forbidden);
        }
        permissions = normalizeKeys(input.permissions);
      } else {
        permissions = DEFAULT_USER_PERMISSIONS.filter(
          (k) => actor.role === 'owner' || actor.permissions.has(k),
        );
      }
      // Rights of the new member: consistent for the role, none the creator lacks.
      if (role !== 'owner') {
        const errors = permissionSetErrors(permissions, role);
        if (Object.keys(errors).length) {
          throw new CrmValidationError(errors, 'Provjerite prava pristupa.');
        }
        const beyond = permissions.filter((k) => !actor.permissions.has(k));
        if (beyond.length) {
          return deny(
            actor,
            null,
            'user.create',
            `Ne možete dodijeliti pravo koje sami nemate: ${beyond.map(permissionLabel).join(', ')}.`,
          );
        }
      }

      const { userId, link } = await accounts.create(
        { email: profile.email, firstName: profile.firstName, lastName: profile.lastName },
        origin,
      );
      try {
        const user = await directory.insert(
          actor.organizationId,
          { ...profile, id: userId, role, permissions },
          {
            actorUserId: actor.id,
            details: { role, rights: role === 'owner' ? 'all' : permissions.length },
          },
        );
        return { user, link };
      } catch (error) {
        await accounts.remove(userId).catch(() => {});
        await directory
          .log({
            organizationId: actor.organizationId,
            actorUserId: actor.id,
            targetUserId: null,
            action: 'user.create',
            result: 'failed',
            details: {},
          })
          .catch(() => {});
        throw error;
      }
    },

    async update(actor: ServiceActor, id: string, input: Record<string, unknown>) {
      const user = await target(actor, id);
      const denial = manageDenial(actor, user, 'edit');
      if (denial) return deny(actor, id, 'user.update', denial);
      const profile = profileInput(input);
      await validateProfile(actor, profile, id);
      const updated = await directory.updateProfile(actor.organizationId, id, profile, {
        actorUserId: actor.id,
      });
      // The sign-in address follows; if the identity provider refuses it, the
      // profile goes back to what it was (and that is logged too).
      if (profile.email !== user.email) {
        try {
          await accounts.setEmail(id, profile.email);
        } catch (error) {
          const { firstName, lastName, oib, email, phone } = user;
          await directory
            .updateProfile(
              actor.organizationId,
              id,
              { firstName, lastName, oib, email, phone },
              {
                actorUserId: actor.id,
                details: { reverted: true },
              },
            )
            .catch(() => {});
          throw error;
        }
      }
      return updated;
    },

    async setStatus(actor: ServiceActor, id: string, status: MemberStatus) {
      const user = await target(actor, id);
      const action = status === 'inactive' ? 'user.deactivate' : 'user.activate';
      if (user.status === status) {
        throw new CrmConflictError(
          status === 'inactive' ? 'Korisnik je već deaktiviran.' : 'Korisnik je već aktivan.',
          {},
        );
      }
      const owners = await directory.activeOwnerCount(actor.organizationId);
      const after =
        owners -
        (user.role === 'owner' && user.status === 'active' && status === 'inactive' ? 1 : 0);
      const denial = statusChangeDenial(actor, user, status, after);
      if (denial) return deny(actor, id, action, denial);
      const updated = await directory.setStatus(actor.organizationId, id, status, {
        actorUserId: actor.id,
      });
      await accounts.setBlocked(id, status === 'inactive');
      if (status === 'inactive') endSessions(id);
      return updated;
    },

    async changePassword(actor: ServiceActor, id: string, input: Record<string, unknown>) {
      const user = await target(actor, id);
      const denial = changePasswordDenial(actor, user);
      if (denial) return deny(actor, id, 'user.password_change', denial);
      const state = await accounts.passwordState(id);
      if (state === 'server') throw new CrmConflictError(SERVER_PASSWORD, {});
      if (state === 'unavailable') throw new CrmConflictError(NO_PASSWORDS, {});
      // The administrator confirms who they are with their own current password.
      const actorUser = await directory.get(actor.organizationId, actor.id);
      const current = typeof input.currentPassword === 'string' ? input.currentPassword : '';
      if (!current) {
        throw new CrmValidationError({ currentPassword: 'Unesite svoju trenutnu lozinku.' });
      }
      if (!actorUser || !(await accounts.confirm(actor.id, actorUser.email, current))) {
        await directory.log({
          organizationId: actor.organizationId,
          actorUserId: actor.id,
          targetUserId: id,
          action: 'user.password_change',
          result: 'denied',
          details: { reason: 'reauthentication' },
        });
        throw new CrmValidationError({ currentPassword: WRONG_CURRENT_PASSWORD });
      }
      const errors = passwordErrors(input.password, input.confirm, {
        email: user.email,
        names: [user.firstName, user.lastName],
      });
      if (Object.keys(errors).length) throw new CrmValidationError(errors);
      await accounts.setPassword(id, input.password as string);
      endSessions(id);
      await directory.log({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        targetUserId: id,
        action: 'user.password_change',
        result: 'success',
        details: { by: actor.id === id ? 'self' : 'administrator' },
      });
      return { self: actor.id === id };
    },

    async passwordLink(actor: ServiceActor, id: string, origin: string): Promise<PasswordLink> {
      const user = await target(actor, id);
      const denial = changePasswordDenial(actor, user);
      if (denial) return deny(actor, id, 'user.password_link', denial);
      const state = await accounts.passwordState(id);
      if (state === 'server') throw new CrmConflictError(SERVER_PASSWORD, {});
      if (state === 'unavailable') throw new CrmConflictError(NO_PASSWORDS, {});
      if (user.status !== 'active') {
        throw new CrmConflictError('Korisnik je deaktiviran.', {});
      }
      const link = await accounts.passwordLink(id, user.email, origin);
      await directory.log({
        organizationId: actor.organizationId,
        actorUserId: actor.id,
        targetUserId: id,
        action: 'user.password_link',
        result: 'success',
        details: { delivery: link.delivery },
      });
      return link;
    },

    async setAccess(actor: ServiceActor, id: string, input: Record<string, unknown>) {
      const user = await target(actor, id);
      const role = roleOf(input.role ?? user.role);
      if (!role) throw new CrmValidationError({ role: 'Odaberite ulogu.' });
      const permissions = role === 'owner' ? [] : normalizeKeys(input.permissions);
      const current = {
        role: user.role,
        permissions: user.role === 'owner' ? [...PERMISSION_KEYS] : [...user.permissions],
      };
      const next = { role, permissions: role === 'owner' ? [...PERMISSION_KEYS] : permissions };
      const owners = await directory.activeOwnerCount(actor.organizationId);
      const after =
        owners - (user.role === 'owner' && user.status === 'active' && role !== 'owner' ? 1 : 0);
      const check = accessChangeCheck(actor, user, current, next, after);
      if (check.denial) return deny(actor, id, 'user.access', check.denial);
      if (Object.keys(check.errors).length) {
        throw new CrmValidationError(check.errors, 'Provjerite prava pristupa.');
      }
      return directory.setAccess(actor.organizationId, id, role, permissions, {
        actorUserId: actor.id,
        details: {
          ...(role !== user.role ? { role: { from: user.role, to: role } } : {}),
          granted: check.granted,
          revoked: check.revoked,
        },
      });
    },

    /** The member's administration history, newest first, with who did it. */
    async audit(actor: ServiceActor, id: string) {
      require(actor, 'users.view_details');
      await target(actor, id);
      const entries = await directory.auditFor(actor.organizationId, id, 30);
      const names = new Map<string, string>();
      for (const actorId of new Set(entries.map((e) => e.actorUserId).filter(Boolean))) {
        const who = await directory.get(actor.organizationId, actorId as string);
        names.set(actorId as string, who ? displayName(who) : 'Nepoznat korisnik');
      }
      return entries.map((e) => ({
        id: e.id,
        action: e.action,
        result: e.result,
        at: e.at,
        details: e.details,
        actor: e.actorUserId
          ? { id: e.actorUserId, name: names.get(e.actorUserId) ?? 'Nepoznat korisnik' }
          : null,
      }));
    },

    /** The member an invitation or reset link is for (to check the password against). */
    async completeLink(organizationId: string, token: string, input: Record<string, unknown>) {
      const userId = await accounts.linkUser(token);
      const user = userId ? await directory.get(organizationId, userId) : null;
      if (!user || user.status !== 'active') {
        throw new CrmConflictError(
          'Poveznica nije valjana ili je istekla. Zatražite novu od administratora.',
          {},
        );
      }
      const errors = passwordErrors(input.password, input.confirm, {
        email: user.email,
        names: [user.firstName, user.lastName],
      });
      if (Object.keys(errors).length) throw new CrmValidationError(errors);
      const done = await accounts.completeLink(token, input.password as string);
      if (done !== user.id) {
        throw new CrmConflictError(
          'Poveznica nije valjana ili je istekla. Zatražite novu od administratora.',
          {},
        );
      }
      endSessions(user.id);
      await directory.log({
        organizationId,
        actorUserId: user.id,
        targetUserId: user.id,
        action: 'user.password_change',
        result: 'success',
        details: { by: 'link' },
      });
      return { email: user.email };
    },
  };
}

export type UserService = ReturnType<typeof createUserService>;
